import QueryBuilder from "../../../util/queryBuilder";
import { Match } from "./match.model";
import { LeagueTeam } from "../leagueTeam/leagueTeam.model";
import { User } from "../user/user.model";
import { Team } from "../team/team.model";
import { League } from "../league/league.model";
import mongoose from "mongoose";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { NotificationQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";
import { socketService } from "../../../helpers/socket/service";
import { VenueCategory } from "../venueCategory/venueCategory.model";
import ApiError from "../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import { ClubEconomy } from "../coinAndBudget/clubEconomySchema.model";
import { MatchResult } from "../matchResult/matchResult.model";
import { MatchResultService } from "../matchResult/matchResult.service";
import { MatchEvaluation } from "../refereeRating/refereeRating.model";
import { PlayerStats } from "../playerStats/playerStats.model";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";
import { MatchPlayerSelection } from "../matchPlayerSelection/matchPlayerSelection.model";
import { isUserPremiumPlayer } from "../../../helpers/packageHelper";
import { getEffectiveMatchSetting, IMatchSetting } from "./matchSetting.model";
import {
  awardMatchCleanSheets,
  revokeMatchCleanSheets,
  manualAwardCleanSheet,
  manualRevokeCleanSheet,
} from "../../../helpers/matchCleanSheetHelper";
import {
  awardMatchPlayerParticipation,
  revokeMatchPlayerParticipation,
} from "../../../helpers/matchPlayerParticipationHelper";
import { recordCoinTransaction } from "../../../helpers/coinLedgerHelper";
import { recordTeamCoinTransaction } from "../../../helpers/teamCoinLedgerHelper";
import { TEAM_COIN_CATEGORY } from "../teamCoinTransaction/teamCoinTransaction.interface";
import { CoinTransaction } from "../coinTransaction/coinTransaction.model";
import { COIN_TRANSACTION_CATEGORY } from "../coinTransaction/coinTransaction.interface";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const getUKNowInUTC = (): Date => {
  return dayjs().tz("Europe/London").utc().toDate();
};

export const getDynamicMaxClubCoinsPerMatch = async (): Promise<number> => {
  const ce = await ClubEconomy.findOne();
  const attend = Number(ce?.attendMatch?.coin) || 0;
  const win = Math.max(Number(ce?.winMatch?.coin) || 0, Number(ce?.drawMatch?.coin) || 0);
  const conduct = Number(ce?.exceptionalConduct?.coin) || 0;
  return attend + win + conduct;
};

export const getMinFloorCoin = (pe: any, isPro: boolean): number => {
  if (!isPro) return 0;
  const startingCoins = Number(pe?.startingCoins);
  if (startingCoins > 0) return startingCoins;
  const rate = Number(pe?.conversionRate) || 10;
  const startingMV = Number(pe?.startingMarketValue) || 10000000;
  return rate > 0 ? Math.round(startingMV / rate) : 10000;
};

export const awardClubCoinsSafely = async (
  matchId: string | mongoose.Types.ObjectId,
  teamId: string | mongoose.Types.ObjectId,
  coinsToAward: number,
  marketValueToAward: number,
  customCap?: number,
  category: TEAM_COIN_CATEGORY = TEAM_COIN_CATEGORY.ATTEND_MATCH,
  title: string = "Match Coin Reward",
  description?: string,
): Promise<number> => {
  if (!teamId || coinsToAward <= 0) return 0;
  const match = await Match.findById(matchId);
  if (!match) return 0;

  const maxCap =
    customCap !== undefined ? customCap : await getDynamicMaxClubCoinsPerMatch();

  const teamKey = String(teamId);
  const currentAwarded =
    match.clubCoinsAwarded && typeof (match.clubCoinsAwarded as any).get === "function"
      ? (match.clubCoinsAwarded as any).get(teamKey) || 0
      : (match as any).clubCoinsAwarded?.[teamKey] || 0;

  const available = maxCap > 0 ? Math.max(0, maxCap - currentAwarded) : coinsToAward;
  const actualCoins = maxCap > 0 ? Math.min(coinsToAward, available) : coinsToAward;
  if (actualCoins <= 0) return 0;

  const opponentId =
    match.homeTeam?.toString() === teamId.toString()
      ? match.awayTeam
      : match.homeTeam;

  // Record transaction in team coin ledger (updates team.coin and team.marketValue)
  try {
    await recordTeamCoinTransaction({
      teamId,
      amount: actualCoins,
      category,
      title,
      description: description || `Awarded ${actualCoins.toLocaleString()} coins for match`,
      matchId: match._id,
      opponentTeamId: opponentId,
    });
  } catch (err) {
    console.error("Error recording team coin transaction in match:", err);
    const actualMV =
      coinsToAward > 0
        ? Math.round((actualCoins / coinsToAward) * marketValueToAward)
        : marketValueToAward;
    await Team.findByIdAndUpdate(teamId, {
      $inc: { coin: actualCoins, marketValue: actualMV },
    });
  }

  if (!match.clubCoinsAwarded) {
    match.clubCoinsAwarded = new Map() as any;
  }
  if (typeof (match.clubCoinsAwarded as any).set === "function") {
    (match.clubCoinsAwarded as any).set(teamKey, currentAwarded + actualCoins);
  } else {
    (match as any).clubCoinsAwarded[teamKey] = currentAwarded + actualCoins;
  }
  await match.save();
  return actualCoins;
};

export const rollbackClubCoinsSafely = async (
  matchId: string | mongoose.Types.ObjectId,
  teamId: string | mongoose.Types.ObjectId,
  coinsToDeduct: number,
  marketValueToDeduct: number,
): Promise<number> => {
  if (!teamId || coinsToDeduct <= 0) return 0;
  const match = await Match.findById(matchId);
  if (!match) return 0;

  const teamKey = String(teamId);
  const currentAwarded =
    match.clubCoinsAwarded && typeof (match.clubCoinsAwarded as any).get === "function"
      ? (match.clubCoinsAwarded as any).get(teamKey) || 0
      : (match as any).clubCoinsAwarded?.[teamKey] || 0;

  const actualDeductCoins =
    currentAwarded > 0 ? Math.min(coinsToDeduct, currentAwarded) : coinsToDeduct;

  const opponentId =
    match.homeTeam?.toString() === teamId.toString()
      ? match.awayTeam
      : match.homeTeam;

  try {
    await recordTeamCoinTransaction({
      teamId,
      amount: -actualDeductCoins,
      category: TEAM_COIN_CATEGORY.ROLLBACK,
      title: "Match Coin Rollback",
      description: `Deducted ${actualDeductCoins.toLocaleString()} coins due to match modification / rollback`,
      matchId: match._id,
      opponentTeamId: opponentId,
    });
  } catch (err) {
    console.error("Error rolling back team coins:", err);
    const actualDeductMV =
      coinsToDeduct > 0
        ? Math.round((actualDeductCoins / coinsToDeduct) * marketValueToDeduct)
        : marketValueToDeduct;
    const team = await Team.findById(teamId);
    if (team) {
      await Team.findByIdAndUpdate(teamId, {
        $set: {
          coin: Math.max(0, (team.coin ?? 0) - actualDeductCoins),
          marketValue: Math.max(0, (team.marketValue ?? 0) - actualDeductMV),
        },
      });
    }
  }

  if (match.clubCoinsAwarded && currentAwarded > 0) {
    const newAwarded = Math.max(0, currentAwarded - actualDeductCoins);
    if (typeof (match.clubCoinsAwarded as any).set === "function") {
      (match.clubCoinsAwarded as any).set(teamKey, newAwarded);
    } else {
      (match as any).clubCoinsAwarded[teamKey] = newAwarded;
    }
    await match.save();
  }
  return actualDeductCoins;
};

const formatMatchVenue = async (matchItem: any) => {
  if (!matchItem) return matchItem;
  const matchObj = matchItem.toObject ? matchItem.toObject() : { ...matchItem };

  const parts: string[] = [];
  let rawVenueName = matchObj.venueName || "";

  // 1. If rawVenueName is a valid ObjectId, try finding its VenueCategory document
  if (rawVenueName && mongoose.Types.ObjectId.isValid(rawVenueName)) {
    const venueCatDoc = await VenueCategory.findById(rawVenueName).populate(
      "parentCategory",
      "name",
    );
    if (venueCatDoc) {
      if (
        venueCatDoc.parentCategory &&
        (venueCatDoc.parentCategory as any).name
      ) {
        parts.push((venueCatDoc.parentCategory as any).name);
      }
      parts.push(venueCatDoc.name);
      rawVenueName = ""; // reset since resolved
    }
  }

  // 2. Add raw text venueName if not ObjectId and not already included
  if (rawVenueName && !parts.includes(rawVenueName)) {
    parts.push(rawVenueName);
  }

  // 3. Add venueCategory name if present
  const catName = matchObj.venueCategory?.name || "";
  if (catName && !parts.includes(catName)) {
    parts.push(catName);
  }

  // 4. Add venueSubCategory name if present
  const subCatName = matchObj.venueSubCategory?.name || "";
  if (subCatName && !parts.includes(subCatName)) {
    parts.push(subCatName);
  }

  const finalVenueString =
    parts.length > 0 ? parts.join(", ") : matchObj.venueName || "";

  const durationMinutes = parseInt(matchObj.durationMinutes) || 90;
  const halfTimeSeconds = Math.floor((durationMinutes / 2) * 60);

  let liveSeconds = matchObj.elapsedSeconds || 0;
  let timerStatus = matchObj.timerStatus || "stopped";
  let timerStartedAt = matchObj.timerStartedAt || null;
  let status = matchObj.status;

  if (matchObj.timerStatus === "running" && matchObj.timerStartedAt) {
    const diff = Math.floor(
      (Date.now() - new Date(matchObj.timerStartedAt).getTime()) / 1000,
    );
    if (diff > 0) liveSeconds += diff;

    if (liveSeconds >= halfTimeSeconds) {
      liveSeconds = halfTimeSeconds;
      timerStatus = matchObj.period === "second_half" ? "finished" : "paused";
      timerStartedAt = null;
      const isFinishingNow = matchObj.period === "second_half" && matchObj.status !== "finished";
      if (matchObj.period === "second_half") {
        status = "finished";
      } else {
        status = "half_time";
      }

      // Self-healing database write
      if (typeof matchObj.save === "function") {
        if (
          matchObj.elapsedSeconds !== halfTimeSeconds ||
          matchObj.timerStatus !== timerStatus ||
          matchObj.status !== status
        ) {
          matchObj.elapsedSeconds = halfTimeSeconds;
          matchObj.timerStatus = timerStatus;
          matchObj.timerStartedAt = null;
          matchObj.status = status;
          if (isFinishingNow && !matchObj.finishedAt) {
            matchObj.finishedAt = new Date();
          }
          matchObj.save().then(async () => {
            if (isFinishingNow) {
              await processMatchCompletion(matchObj);
            }
          }).catch(() => {});
        }
      }
    }
  }

  let leagueObj = matchObj.league || null;
  if (!leagueObj && matchObj.matchType && matchObj.matchType !== "league") {
    const virtualName = matchObj.matchType === "cup" ? "Cup Match" : "Friendly Match";
    leagueObj = {
      _id: "000000000000000000000000",
      id: "000000000000000000000000",
      leagueName: virtualName,
      season: "N/A",
    };
  }

  return {
    ...matchObj,
    league: leagueObj,
    matchType: matchObj.matchType || null,
    formation: matchObj.formation || null,
    venueName: finalVenueString,
    venue: finalVenueString,
    currentElapsedSeconds: liveSeconds,
    currentElapsedMinutes: Math.floor(liveSeconds / 60),
    totalDurationMinutes: durationMinutes,
    timerStatus,
    timerStartedAt,
    elapsedSeconds: liveSeconds,
    ageGroup:
      matchObj.ageGroup ||
      matchObj.homeTeam?.ageGroup ||
      matchObj.awayTeam?.ageGroup ||
      null,
  };
};

/* ---------------- RATING LOGIC ---------------- */

const VALID_FORMATIONS = ["5 v 5", "7 v 7", "8 v 8", "9 v 9"];

const createMatchToDB = async (payload: any) => {
  // single object হলে array বানাবে
  const matches = Array.isArray(payload) ? payload : [payload];

  const createdMatches: any[] = [];
  for (const matchData of matches) {
    const {
      league,
      homeTeam,
      awayTeam,
      matchDate,
      referee,
      venueName,
      formation,
    } = matchData;

    // formation validation
    if (!formation) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Formation is required");
    }
    if (!VALID_FORMATIONS.includes(formation)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid formation. Must be one of: ${VALID_FORMATIONS.join(", ")}`,
      );
    }

    // same team check
    if (homeTeam === awayTeam) {
      throw new Error("Same team cannot play match");
    }
    // league validation
    const finalMatchType = matchData.matchType || "league";
    if (finalMatchType === "league" && !league) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "League is required for league matches");
    }

    // league team validation
    if (league) {
      const leagueTeams = await LeagueTeam.find({
        league,
      });
      const teamIds = leagueTeams.map((t) => t.team.toString());
      if (!teamIds.includes(homeTeam) || !teamIds.includes(awayTeam)) {
        throw new Error("Both teams must belong to this league");
      }
    }
    // referee check
    if (referee) {
      const refereeExists = await User.findById(referee);
      if (!refereeExists) {
        throw new Error("Referee not found");
      }
    }

    // time range
    const matchTime = new Date(matchDate).getTime();
    const twoHours = 2 * 60 * 60 * 1000;
    // const startWindow = new Date(matchTime - twoHours);

    // const endWindow = new Date(matchTime + twoHours);

    // team conflict

    // const teamConflict = await Match.findOne({
    //   matchDate: {
    //     $gte: startWindow,
    //     $lte: endWindow,
    //   },

    //   $or: [
    //     {
    //       homeTeam,
    //     },
    //     {
    //       awayTeam,
    //     },
    //   ],
    // });

    // if (teamConflict) {
    //   throw new Error("One of the teams already has a match in this time slot");
    // }

    // referee conflict

    // if (referee) {
    //   const refereeConflict = await Match.findOne({
    //     referee,

    //     matchDate: {
    //       $gte: startWindow,
    //       $lte: endWindow,
    //     },
    //   });

    //   if (refereeConflict) {
    //     throw new Error("Referee already assigned in this time slot");
    //   }
    // }

    // create
    if (!matchData.scheduledAt && matchDate) {
      matchData.scheduledAt = new Date(matchDate);
    }
    if (!matchData.ageGroup && homeTeam) {
      const homeTeamDoc = await Team.findById(homeTeam).select("ageGroup");
      if (homeTeamDoc?.ageGroup) {
        matchData.ageGroup = homeTeamDoc.ageGroup;
      }
    }
    if (matchData.venueName && mongoose.Types.ObjectId.isValid(matchData.venueName)) {
      matchData.venueCategory = matchData.venueName;
      const categoryDoc = await VenueCategory.findById(matchData.venueName);
      if (categoryDoc) {
        matchData.venueName = categoryDoc.name;
        
        const subVal = matchData.subVenue || matchData.pitch;
        if (subVal && mongoose.Types.ObjectId.isValid(subVal)) {
          matchData.venueSubCategory = subVal;
          const subCategoryObj = categoryDoc.subCategories?.find(
            (s: any) => s._id?.toString() === subVal.toString() || s.id?.toString() === subVal.toString()
          );
          if (subCategoryObj) {
            matchData.venueName = `${categoryDoc.name}, ${subCategoryObj.name}`;
          }
        }
      }
    } else {
      const subVal = matchData.subVenue || matchData.pitch;
      if (subVal && mongoose.Types.ObjectId.isValid(subVal)) {
        matchData.venueSubCategory = subVal;
      }
    }

    const match = await Match.create(matchData);
    createdMatches.push(match);
  }
  return createdMatches;
};

const getAllMatchesFromDB = async (query: Record<string, any>) => {
  const {
    teamId,
    team,
    teamName,
    leagueId,
    league,
    leagueName,
    status,
    dateStatus,
    matchDate,
    startDate,
    endDate,
    venue,
    venueName,
    venueCategory,
    venueSubCategory,
    subVenue,
    homeMatchesOnly,
    unplayedOnly,
    liveOnly,
    hasNotes,
    searchTerm,
    ageGroup,
    ageGroupCategory,
    page,
    limit,
    sort,
  } = query;

  const andConditions: any[] = [];

  // League Filter (supports leagueId, league, leagueName)
  const targetLeague = leagueId || league || leagueName;
  if (
    targetLeague &&
    targetLeague !== "ALL" &&
    targetLeague !== "null" &&
    targetLeague !== "undefined"
  ) {
    let targetLeagueIds: any[] = [];
    let teamIdsInLeague: any[] = [];

    if (mongoose.Types.ObjectId.isValid(targetLeague)) {
      const objId = new mongoose.Types.ObjectId(targetLeague);

      // Find all LeagueTeams linked to this league
      const matchingLeagueTeams = await LeagueTeam.find({
        $or: [{ league: objId }, { _id: objId }],
      }).select("_id league team");

      const leagueTeamIds = matchingLeagueTeams.map((lt) => lt._id);
      const directLeagueIds = matchingLeagueTeams.map((lt) => lt.league);
      teamIdsInLeague = matchingLeagueTeams
        .map((lt) => lt.team)
        .filter(Boolean);

      const idStrings = Array.from(
        new Set(
          [
            objId.toString(),
            ...leagueTeamIds.map((id) => id.toString()),
            ...directLeagueIds.map((id) => id?.toString()),
          ].filter(Boolean),
        ),
      );

      targetLeagueIds = [
        ...idStrings.map(
          (idStr) => new mongoose.Types.ObjectId(idStr as string),
        ),
        ...idStrings,
      ];
    } else {
      const matchingLeagues = await League.find({
        leagueName: { $regex: targetLeague.trim(), $options: "i" },
      }).select("_id");
      const foundLeagueIds = matchingLeagues.map((l) => l._id);
      const matchingLeagueTeams = await LeagueTeam.find({
        league: { $in: foundLeagueIds },
      }).select("_id team");

      const leagueTeamIds = matchingLeagueTeams.map((lt) => lt._id);
      teamIdsInLeague = matchingLeagueTeams
        .map((lt) => lt.team)
        .filter(Boolean);

      const idStrings = Array.from(
        new Set(
          [
            ...foundLeagueIds.map((id) => id.toString()),
            ...leagueTeamIds.map((id) => id.toString()),
          ].filter(Boolean),
        ),
      );

      targetLeagueIds = [
        ...idStrings.map(
          (idStr) => new mongoose.Types.ObjectId(idStr as string),
        ),
        ...idStrings,
      ];
    }

    const allTeamIdRefs = [
      ...teamIdsInLeague,
      ...teamIdsInLeague.map((id) => id.toString()),
    ];

    andConditions.push({
      $or: [
        { league: { $in: targetLeagueIds } },
        ...(allTeamIdRefs.length > 0
          ? [{ homeTeam: { $in: allTeamIdRefs } }]
          : []),
        ...(allTeamIdRefs.length > 0
          ? [{ awayTeam: { $in: allTeamIdRefs } }]
          : []),
      ],
    });
  }

  // Team Filter (supports teamId, team, teamName, homeTeam, awayTeam)
  const targetTeam =
    teamId || teamName || team || query.homeTeam || query.awayTeam;
  if (
    targetTeam &&
    targetTeam !== "ALL" &&
    targetTeam !== "null" &&
    targetTeam !== "undefined"
  ) {
    let teamObjIds: any[] = [];
    let teamStrIds: string[] = [];

    if (mongoose.Types.ObjectId.isValid(targetTeam)) {
      teamObjIds = [new mongoose.Types.ObjectId(targetTeam)];
      teamStrIds = [targetTeam.toString()];
    } else {
      const matchingTeams = await Team.find({
        teamName: { $regex: targetTeam.trim(), $options: "i" },
      }).select("_id");
      teamObjIds = matchingTeams.map((t) => t._id);
      teamStrIds = matchingTeams.map((t) => t._id.toString());
    }

    const allTeamIds = [...teamObjIds, ...teamStrIds];

    if (homeMatchesOnly === "true" || homeMatchesOnly === true) {
      andConditions.push({ homeTeam: { $in: allTeamIds } });
    } else {
      andConditions.push({
        $or: [
          { homeTeam: { $in: allTeamIds } },
          { awayTeam: { $in: allTeamIds } },
        ],
      });
    }
  }

  // Status Filter (case-insensitive)
  if (status && status !== "ALL") {
    const lowerStatus = (status as string).toLowerCase();
    if (lowerStatus === "live") {
      andConditions.push({
        $or: [
          { status: { $regex: /^live$/i } },
          { status: "half_time" },
          { timerStatus: "running" },
          { timerStatus: "paused" },
        ],
      });
    } else if (lowerStatus === "upcoming" || lowerStatus === "scheduled") {
      andConditions.push({
        $or: [
          { status: { $regex: /^(upcoming|scheduled)$/i } },
          { status: { $ne: "finished" } },
        ],
      });
    } else {
      andConditions.push({
        status: { $regex: new RegExp(`^${lowerStatus}$`, "i") },
      });
    }
  }

  // Unplayed matches only
  if (unplayedOnly === "true" || unplayedOnly === true) {
    andConditions.push({ status: { $ne: "finished" } });
  }

  // Live matches only
  if (liveOnly === "true" || liveOnly === true) {
    andConditions.push({
      $or: [
        { status: { $regex: /^live$/i } },
        { status: "half_time" },
        { timerStatus: "running" },
        { timerStatus: "paused" },
      ],
    });
  }

  // Venue Filter
  const searchVenue = venueName || venue;
  if (searchVenue && searchVenue !== "ALL") {
    if (mongoose.Types.ObjectId.isValid(searchVenue)) {
      const venueDoc = await VenueCategory.findById(searchVenue);
      const subCats = await VenueCategory.find({
        $or: [{ parentCategory: searchVenue }, { _id: searchVenue }],
      });

      const allVenueIds = Array.from(
        new Set([
          searchVenue.toString(),
          ...subCats.map((s) => s._id.toString()),
        ]),
      );
      const allVenueNames = Array.from(
        new Set(
          [venueDoc?.name, ...subCats.map((s) => s.name)].filter(Boolean),
        ),
      );

      const regexConditions = allVenueNames.map((name) => ({
        venueName: { $regex: name, $options: "i" },
      }));

      andConditions.push({
        $or: [
          { venueName: { $in: allVenueIds } },
          { pitch: { $in: allVenueIds } },
          { subVenue: { $in: allVenueIds } },
          { venueCategory: { $in: allVenueIds } },
          { venueSubCategory: { $in: allVenueIds } },
          ...regexConditions,
        ],
      });
    } else {
      const venueDocs = await VenueCategory.find({
        name: { $regex: searchVenue, $options: "i" },
      });
      const venueIds = venueDocs.map((v) => v._id.toString());
      const parentIds = venueDocs.map((v) => v._id);

      const subCats = await VenueCategory.find({
        parentCategory: { $in: parentIds },
      });
      const allVenueIds = Array.from(
        new Set([...venueIds, ...subCats.map((s) => s._id.toString())]),
      );

      andConditions.push({
        $or: [
          { venueName: { $in: allVenueIds } },
          { pitch: { $in: allVenueIds } },
          { subVenue: { $in: allVenueIds } },
          { venueCategory: { $in: allVenueIds } },
          { venueSubCategory: { $in: allVenueIds } },
        ],
      });
    }
  }

  // Venue Category / Subcategory filter
  if (venueCategory || venueSubCategory || subVenue) {
    const venueFilterOr: any[] = [];
    if (venueCategory) {
      venueFilterOr.push({ venueCategory });
    }
    if (venueSubCategory) {
      venueFilterOr.push({ venueSubCategory });
    }
    if (subVenue) {
      venueFilterOr.push({ subVenue });
      venueFilterOr.push({ venueSubCategory: subVenue });
    }
    if (venueFilterOr.length > 0) {
      andConditions.push({ $or: venueFilterOr });
    }
  }

  // Date Status Filter
  const now = new Date();
  if (dateStatus && dateStatus !== "ALL") {
    if (dateStatus === "today") {
      const startOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const endOfDay = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        23,
        59,
        59,
        999,
      );
      andConditions.push({
        $or: [
          { matchDate: { $gte: startOfDay, $lte: endOfDay } },
          { scheduledAt: { $gte: startOfDay, $lte: endOfDay } },
        ],
      });
    } else if (dateStatus === "this_week") {
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      andConditions.push({
        $or: [
          { matchDate: { $gte: startOfWeek, $lte: endOfWeek } },
          { scheduledAt: { $gte: startOfWeek, $lte: endOfWeek } },
        ],
      });
    } else if (dateStatus === "upcoming") {
      andConditions.push({
        $or: [{ matchDate: { $gte: now } }, { scheduledAt: { $gte: now } }],
      });
    } else if (dateStatus === "past") {
      andConditions.push({
        $or: [{ matchDate: { $lt: now } }, { scheduledAt: { $lt: now } }],
      });
    }
  }

  // Specific Day Filter (matchDate) -> Full 24-hour range
  if (matchDate) {
    const dateStr =
      typeof matchDate === "string" ? matchDate.split("T")[0] : "";
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const startOfDay = dayjs.tz(dateStr, "Europe/London").startOf("day").toDate();
      const endOfDay = dayjs.tz(dateStr, "Europe/London").endOf("day").toDate();
      andConditions.push({
        $or: [
          { matchDate: { $gte: startOfDay, $lte: endOfDay } },
          { scheduledAt: { $gte: startOfDay, $lte: endOfDay } },
        ],
      });
    } else {
      const d = new Date(matchDate as string);
      if (!isNaN(d.getTime())) {
        const startOfDay = new Date(d);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(d);
        endOfDay.setUTCHours(23, 59, 59, 999);
        andConditions.push({
          $or: [
            { matchDate: { $gte: startOfDay, $lte: endOfDay } },
            { scheduledAt: { $gte: startOfDay, $lte: endOfDay } },
          ],
        });
      }
    }
  }

  // Date Range Filter (supports startDate, endDate, from, to, start, end)
  const effectiveStartDate = startDate || query.from || query.start;
  const effectiveEndDate = endDate || query.to || query.end;

  if (effectiveStartDate || effectiveEndDate) {
    let startD: Date | null = null;
    let endD: Date | null = null;

    if (effectiveStartDate) {
      const sStr =
        typeof effectiveStartDate === "string"
          ? effectiveStartDate.split("T")[0]
          : "";
      if (sStr && /^\d{4}-\d{2}-\d{2}$/.test(sStr)) {
        startD = new Date(`${sStr}T00:00:00.000Z`);
      } else {
        const d = new Date(effectiveStartDate as string);
        if (!isNaN(d.getTime())) {
          startD = d;
        }
      }
    }

    if (effectiveEndDate) {
      const eStr =
        typeof effectiveEndDate === "string"
          ? effectiveEndDate.split("T")[0]
          : "";
      if (eStr && /^\d{4}-\d{2}-\d{2}$/.test(eStr)) {
        endD = new Date(`${eStr}T23:59:59.999Z`);
      } else {
        const d = new Date(effectiveEndDate as string);
        if (!isNaN(d.getTime())) {
          endD = d;
        }
      }
    }

    const dateQuery: any = {};
    if (startD && !isNaN(startD.getTime())) {
      dateQuery.$gte = startD;
    }
    if (endD && !isNaN(endD.getTime())) {
      dateQuery.$lte = endD;
    }

    if (dateQuery.$gte || dateQuery.$lte) {
      andConditions.push({
        $or: [{ matchDate: dateQuery }, { scheduledAt: dateQuery }],
      });
    }
  }

  // SearchTerm Filter (Regex on teamName, leagueName, venueName, notes, status)
  if (
    searchTerm &&
    typeof searchTerm === "string" &&
    searchTerm.trim() !== ""
  ) {
    const searchRegex = { $regex: searchTerm.trim(), $options: "i" };

    const [matchingTeams, matchingLeagues] = await Promise.all([
      Team.find({ teamName: searchRegex }).select("_id"),
      League.find({ leagueName: searchRegex }).select("_id"),
    ]);

    const teamIds = matchingTeams.map((t) => t._id);
    const leagueIds = matchingLeagues.map((l) => l._id);

    andConditions.push({
      $or: [
        { homeTeam: { $in: teamIds } },
        { awayTeam: { $in: teamIds } },
        { league: { $in: leagueIds } },
        { venueName: searchRegex },
        { status: searchRegex },
        { notes: searchRegex },
      ],
    });
  }

  // Match Type Filter
  if (query.matchType && query.matchType !== "ALL") {
    const targetType = String(query.matchType).toLowerCase().trim();
    if (targetType === "league") {
      andConditions.push({
        $or: [
          { matchType: "league" },
          { matchType: null },
          { matchType: { $exists: false } },
        ],
      });
    } else {
      andConditions.push({ matchType: targetType });
    }
  }

  // Age Group Category Filter
  if (
    ageGroupCategory &&
    ageGroupCategory !== "ALL" &&
    ageGroupCategory !== "null" &&
    ageGroupCategory !== "undefined"
  ) {
    andConditions.push({ ageGroupCategory });
  }

  // Age Group Filter (matches match.ageGroup, homeTeam, awayTeam, and league)
  if (
    ageGroup &&
    ageGroup !== "ALL" &&
    ageGroup !== "null" &&
    ageGroup !== "undefined"
  ) {
    const trimmedAge = (ageGroup as string).trim();
    const exactRegex = new RegExp(`^${trimmedAge}$`, "i");
    const wordRegex = new RegExp(`\\b${trimmedAge}\\b`, "i");

    const numMatch = trimmedAge.match(/\d+/);
    const numPart = numMatch ? numMatch[0] : "";
    const underRegex = numPart
      ? new RegExp(`(u|under\\s*)${numPart}\\b`, "i")
      : wordRegex;

    const [matchingTeams, matchingLeagues] = await Promise.all([
      Team.find({
        $or: [
          { ageGroup: exactRegex },
          { ageGroup: wordRegex },
          { ageGroup: underRegex },
          { teamName: wordRegex },
          { teamName: underRegex },
        ],
      }).select("_id"),
      League.find({
        $or: [
          { ageGroup: exactRegex },
          { ageGroup: wordRegex },
          { ageGroup: underRegex },
          { leagueName: exactRegex },
          { leagueName: wordRegex },
          { leagueName: underRegex },
        ],
      }).select("_id"),
    ]);

    const matchingTeamIds = matchingTeams.map((t) => t._id);
    const matchingLeagueIds = matchingLeagues.map((l) => l._id);

    andConditions.push({
      $or: [
        { ageGroup: exactRegex },
        { ageGroup: wordRegex },
        { ageGroup: underRegex },
        ...(matchingTeamIds.length > 0
          ? [
              { homeTeam: { $in: matchingTeamIds } },
              { awayTeam: { $in: matchingTeamIds } },
            ]
          : []),
        ...(matchingLeagueIds.length > 0
          ? [{ league: { $in: matchingLeagueIds } }]
          : []),
      ],
    });
  }

  const initialFilter = andConditions.length > 0 ? { $and: andConditions } : {};

  // Pagination calculation
  const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNumber = Math.max(1, parseInt(limit as string, 10) || 10);
  const skip = (pageNumber - 1) * limitNumber;

  // Count matching documents for pagination
  const total = await Match.countDocuments(initialFilter);
  const totalPage = Math.ceil(total / limitNumber) || 1;

  // Sorting
  const sortField = (sort as string) || "-createdAt";

  const matches = await Match.find(initialFilter)
    .sort(sortField)
    .skip(skip)
    .limit(limitNumber)
    .populate("league")
    .populate("homeTeam")
    .populate("awayTeam")
    .populate("referee")
    .populate("winnerTeam")
    .populate("venueCategory", "name")
    .populate("venueSubCategory", "name")
    .populate("ageGroupCategory");

  const formattedResult = await Promise.all(
    matches.map((m: any) => formatMatchVenue(m)),
  );

  return {
    meta: {
      total,
      limit: limitNumber,
      page: pageNumber,
      totalPage,
    },
    result: formattedResult,
  };
};

const getMatchesByRefereeFromDB = async (
  refereeId: string,
  query: Record<string, any>,
) => {
  const pageNumber = Math.max(1, parseInt(query.page as string, 10) || 1);
  const limitNumber = Math.max(1, parseInt(query.limit as string, 10) || 10);
  const skip = (pageNumber - 1) * limitNumber;

  const refereeFilter = mongoose.Types.ObjectId.isValid(refereeId)
    ? { $in: [refereeId, new mongoose.Types.ObjectId(refereeId)] }
    : refereeId;

  const filter: Record<string, any> = { referee: refereeFilter };

  // Filter by status if provided (e.g. upcoming, live, finished, or comma-separated list)
  if (query.status) {
    if (typeof query.status === "string" && query.status.includes(",")) {
      filter.status = {
        $in: query.status.split(",").map((s: string) => s.trim().toLowerCase()),
      };
    } else {
      filter.status = (query.status as string).trim().toLowerCase();
    }
  }

  // Filter by league if provided
  if (query.league) {
    filter.league = query.league;
  }

  // Filter by matchDate or date if provided
  if (query.date || query.matchDate) {
    const targetDate = query.date || query.matchDate;
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);
    filter.matchDate = { $gte: startOfDay, $lte: endOfDay };
  }

  const total = await Match.countDocuments(filter);
  const totalPage = Math.ceil(total / limitNumber) || 1;

  const sortOption =
    query.sort ||
    (query.status === "finished" ? "-matchDate" : "matchDate");

  const matches = await Match.find(filter)
    .sort(sortOption)
    .skip(skip)
    .limit(limitNumber)
    .populate("league")
    .populate("homeTeam")
    .populate("awayTeam")
    .populate("referee")
    .populate("winnerTeam")
    .populate("venueCategory", "name")
    .populate("venueSubCategory", "name")
    .populate("ageGroupCategory");

  const formattedResult = await Promise.all(
    matches.map((m: any) => formatMatchVenue(m)),
  );

  return {
    meta: {
      total,
      limit: limitNumber,
      page: pageNumber,
      totalPage,
    },
    result: formattedResult,
  };
};

// Helper to fetch recent 5 finished matches and calculate team form (W/D/L)
const getTeamRecentFormAndMatches = async (
  teamId: string | mongoose.Types.ObjectId,
  excludeMatchId?: string | mongoose.Types.ObjectId,
) => {
  if (!teamId) {
    return { form: [], formString: "N/A", won: 0, drawn: 0, lost: 0, total: 0, recentMatches: [] };
  }

  const teamObjectId =
    typeof teamId === "string" ? new mongoose.Types.ObjectId(teamId) : teamId;

  const matchFilter: any = {
    $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
    status: "finished",
  };

  if (excludeMatchId && mongoose.Types.ObjectId.isValid(excludeMatchId as string)) {
    matchFilter._id = { $ne: new mongoose.Types.ObjectId(excludeMatchId as string) };
  }

  const finishedMatches = await Match.find(matchFilter)
    .sort({ matchDate: -1, createdAt: -1 })
    .limit(5)
    .populate("homeTeam", "teamName teamLogo shortName")
    .populate("awayTeam", "teamName teamLogo shortName")
    .populate("league", "leagueName name")
    .lean();

  let won = 0;
  let drawn = 0;
  let lost = 0;

  const form: string[] = (finishedMatches || [])
    .map((m: any) => {
      const isHome = m.homeTeam?._id?.toString() === teamObjectId.toString();
      const teamGoals = isHome ? Number(m.homeScore) || 0 : Number(m.awayScore) || 0;
      const oppGoals = isHome ? Number(m.awayScore) || 0 : Number(m.homeScore) || 0;
      if (teamGoals > oppGoals) {
        won++;
        return "W";
      }
      if (teamGoals < oppGoals) {
        lost++;
        return "L";
      }
      drawn++;
      return "D";
    })
    .reverse(); // Chronological order: e.g. ['W', 'D', 'L', 'W', 'W']

  const formString = form.length > 0 ? form.join(" - ") : "N/A";

  // Clean lightweight recent matches summary (removes bloated internal matchReview, timers, etc.)
  const cleanRecentMatches = (finishedMatches || []).map((m: any) => ({
    _id: m._id,
    matchDate: m.matchDate,
    homeScore: Number(m.homeScore) || 0,
    awayScore: Number(m.awayScore) || 0,
    status: m.status,
    homeTeam: m.homeTeam
      ? {
          _id: m.homeTeam._id,
          teamName: m.homeTeam.teamName,
          shortName: m.homeTeam.shortName,
          teamLogo: m.homeTeam.teamLogo,
        }
      : null,
    awayTeam: m.awayTeam
      ? {
          _id: m.awayTeam._id,
          teamName: m.awayTeam.teamName,
          shortName: m.awayTeam.shortName,
          teamLogo: m.awayTeam.teamLogo,
        }
      : null,
    league: m.league
      ? {
          _id: m.league._id,
          leagueName: m.league.leagueName || m.league.name,
        }
      : null,
  }));

  return {
    form,
    formString,
    won,
    drawn,
    lost,
    total: form.length,
    recentMatches: cleanRecentMatches,
  };
};

// SINGLE
const getSingleMatchFromDB = async (id: string) => {
  const match = await Match.findById(id)
    .populate("league")
    .populate("homeTeam")
    .populate("awayTeam")
    .populate("referee")
    .populate("winnerTeam")
    .populate("manOfTheMatch", "firstName lastName profile jerseyNumber")
    .populate("venueCategory", "name")
    .populate("venueSubCategory", "name")
    .populate("ageGroupCategory");

  if (!match) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");
  }

  // Use the existing formatMatchVenue helper to ensure all dynamic fields (venueName, liveSeconds, etc.) are correctly formatted
  const baseMatch = await formatMatchVenue(match);

  // Fetch match events, referee report, managers, and recent matches/form for home and away teams in parallel
  const [
    matchEvents,
    evaluation,
    homeManagerDoc,
    awayManagerDoc,
    homeFormAndMatches,
    awayFormAndMatches,
  ] = await Promise.all([
    MatchResult.find({ match: id })
      .populate("player", "firstName lastName profile")
      .populate("eventMeta.assist", "firstName lastName"),
    MatchEvaluation.findOne({ match: id }).populate(
      "manOfTheMatch",
      "firstName lastName profile",
    ),
    match.homeTeam?._id
      ? ManagerTeam.findOne({ team: match.homeTeam._id }).populate(
          "manager",
          "firstName lastName userName profile",
        )
      : Promise.resolve(null),
    match.awayTeam?._id
      ? ManagerTeam.findOne({ team: match.awayTeam._id }).populate(
          "manager",
          "firstName lastName userName profile",
        )
      : Promise.resolve(null),
    match.homeTeam?._id
      ? getTeamRecentFormAndMatches(match.homeTeam._id, id)
      : Promise.resolve({ form: [], formString: "N/A", won: 0, drawn: 0, lost: 0, total: 0, recentMatches: [] }),
    match.awayTeam?._id
      ? getTeamRecentFormAndMatches(match.awayTeam._id, id)
      : Promise.resolve({ form: [], formString: "N/A", won: 0, drawn: 0, lost: 0, total: 0, recentMatches: [] }),
  ]);

  // Format Goals
  const goals = matchEvents
    .filter((e) => e.eventType === "goal")
    .map((e) => ({
      _id: e._id,
      team: e.team,
      isHome: String(e.team) === String(match.homeTeam?._id),
      minute: e.minute,
      goalType: e.eventMeta?.goalType || null,
      player: e.player
        ? {
            _id: e.player._id,
            firstName: (e.player as any).firstName || "",
            lastName: (e.player as any).lastName || "",
            profile: (e.player as any).profile || null,
          }
        : null,
      assist: e.eventMeta?.assist
        ? {
            _id: (e.eventMeta.assist as any)._id,
            firstName: (e.eventMeta.assist as any).firstName || "",
            lastName: (e.eventMeta.assist as any).lastName || "",
          }
        : null,
    }));

  // Format Cards
  const cards = matchEvents
    .filter((e) => e.eventType === "yellow_card" || e.eventType === "red_card")
    .map((e) => ({
      _id: e._id,
      team: e.team,
      isHome: String(e.team) === String(match.homeTeam?._id),
      minute: e.minute,
      cardType: e.eventType === "yellow_card" ? "yellow" : "red",
      player: e.player
        ? {
            _id: e.player._id,
            firstName: (e.player as any).firstName || "",
            lastName: (e.player as any).lastName || "",
          }
        : null,
    }));

  // Format Referee Report
  const motmCandidate = (evaluation?.manOfTheMatch as any) || (match.manOfTheMatch as any);
  const refereeReport = (evaluation || motmCandidate)
    ? {
        homeTeamRating: evaluation?.homeTeamRating ?? 0,
        awayTeamRating: evaluation?.awayTeamRating ?? 0,
        manOfTheMatch: motmCandidate
          ? {
              _id: motmCandidate._id,
              firstName: motmCandidate.firstName || "",
              lastName: motmCandidate.lastName || "",
              profile: motmCandidate.profile || null,
              jerseyNumber: motmCandidate.jerseyNumber || null,
            }
          : null,
      }
    : null;

  // Format referee object
  const refereeObj =
    match.referee && typeof match.referee === "object"
      ? {
          _id: match.referee._id,
          firstName: (match.referee as any).firstName || "",
          lastName: (match.referee as any).lastName || "",
          userName: (match.referee as any).userName || "",
          profile: (match.referee as any).profile || null,
          email: (match.referee as any).email || "",
          phone: (match.referee as any).phone || "",
        }
      : null;

  // Construct structured Team Form comparison object matching the mobile UI card
  const leagueTitle =
    baseMatch.league?.leagueName ||
    (baseMatch.matchType === "cup"
      ? "Cup Match"
      : baseMatch.matchType === "friendly"
      ? "Friendly Match"
      : "League Match");

  const homeTeamFormSummary = {
    _id: baseMatch.homeTeam?._id || null,
    teamName: baseMatch.homeTeam?.teamName || "",
    shortName: baseMatch.homeTeam?.shortName || "",
    teamLogo: baseMatch.homeTeam?.teamLogo || "",
    form: homeFormAndMatches?.form || [],
    formString: homeFormAndMatches?.formString || "N/A",
    won: homeFormAndMatches?.won || 0,
    drawn: homeFormAndMatches?.drawn || 0,
    lost: homeFormAndMatches?.lost || 0,
    total: homeFormAndMatches?.total || 0,
  };

  const awayTeamFormSummary = {
    _id: baseMatch.awayTeam?._id || null,
    teamName: baseMatch.awayTeam?.teamName || "",
    shortName: baseMatch.awayTeam?.shortName || "",
    teamLogo: baseMatch.awayTeam?.teamLogo || "",
    form: awayFormAndMatches?.form || [],
    formString: awayFormAndMatches?.formString || "N/A",
    won: awayFormAndMatches?.won || 0,
    drawn: awayFormAndMatches?.drawn || 0,
    lost: awayFormAndMatches?.lost || 0,
    total: awayFormAndMatches?.total || 0,
  };

  const teamForm = {
    title: "Team Form",
    leagueName: leagueTitle,
    homeTeam: homeTeamFormSummary,
    awayTeam: awayTeamFormSummary,
    comparison: [
      {
        label: "Won",
        home: homeTeamFormSummary.won,
        away: awayTeamFormSummary.won,
      },
      {
        label: "Drawn",
        home: homeTeamFormSummary.drawn,
        away: awayTeamFormSummary.drawn,
      },
      {
        label: "Lost",
        home: homeTeamFormSummary.lost,
        away: awayTeamFormSummary.lost,
      },
    ],
  };

  // Construct final response data matching the exact requested JSON structure
  return {
    _id: baseMatch._id,
    matchType: baseMatch.matchType || "league",
    ageGroupCategory: baseMatch.ageGroupCategory || null,
    ageGroup: baseMatch.ageGroup || null,
    league: baseMatch.league
      ? {
          _id: baseMatch.league._id,
          leagueName: baseMatch.league.leagueName,
          season: baseMatch.league.season,
        }
      : (baseMatch.matchType && baseMatch.matchType !== "league"
        ? {
            _id: "000000000000000000000000",
            leagueName: baseMatch.matchType === "cup" ? "Cup Match" : "Friendly Match",
            season: "N/A",
          }
        : null),
    matchDate: baseMatch.matchDate,
    venueName: baseMatch.venueName,
    venueCategory: baseMatch.venueCategory || null,
    venueSubCategory: baseMatch.venueSubCategory || null,
    durationMinutes: baseMatch.durationMinutes || null,
    formation: baseMatch.formation || null,
    status: baseMatch.status,
    period: baseMatch.period,
    referee: refereeObj,
    homeScore: baseMatch.homeScore,
    awayScore: baseMatch.awayScore,
    homeTeam: baseMatch.homeTeam
      ? {
          _id: baseMatch.homeTeam._id,
          teamName: baseMatch.homeTeam.teamName,
          shortName: baseMatch.homeTeam.shortName,
          teamLogo: baseMatch.homeTeam.teamLogo,
          manager:
            homeManagerDoc && homeManagerDoc.manager
              ? {
                  _id: (homeManagerDoc.manager as any)._id,
                  firstName: (homeManagerDoc.manager as any).firstName || "",
                  lastName: (homeManagerDoc.manager as any).lastName || "",
                  userName: (homeManagerDoc.manager as any).userName || "",
                  profile: (homeManagerDoc.manager as any).profile || null,
                }
              : null,
          form: homeFormAndMatches?.form || [],
          formString: homeFormAndMatches?.formString || "N/A",
          won: homeFormAndMatches?.won || 0,
          drawn: homeFormAndMatches?.drawn || 0,
          lost: homeFormAndMatches?.lost || 0,
          total: homeFormAndMatches?.total || 0,
          recentMatches: homeFormAndMatches?.recentMatches || [],
        }
      : null,
    awayTeam: baseMatch.awayTeam
      ? {
          _id: baseMatch.awayTeam._id,
          teamName: baseMatch.awayTeam.teamName,
          shortName: baseMatch.awayTeam.shortName,
          teamLogo: baseMatch.awayTeam.teamLogo,
          manager:
            awayManagerDoc && awayManagerDoc.manager
              ? {
                  _id: (awayManagerDoc.manager as any)._id,
                  firstName: (awayManagerDoc.manager as any).firstName || "",
                  lastName: (awayManagerDoc.manager as any).lastName || "",
                  userName: (awayManagerDoc.manager as any).userName || "",
                  profile: (awayManagerDoc.manager as any).profile || null,
                }
              : null,
          form: awayFormAndMatches?.form || [],
          formString: awayFormAndMatches?.formString || "N/A",
          won: awayFormAndMatches?.won || 0,
          drawn: awayFormAndMatches?.drawn || 0,
          lost: awayFormAndMatches?.lost || 0,
          total: awayFormAndMatches?.total || 0,
          recentMatches: awayFormAndMatches?.recentMatches || [],
        }
      : null,
    teamForm,
    homeTeamRecentMatches: homeFormAndMatches?.recentMatches || [],
    awayTeamRecentMatches: awayFormAndMatches?.recentMatches || [],
    homeTeamForm: homeFormAndMatches?.form || [],
    awayTeamForm: awayFormAndMatches?.form || [],
    goals,
    cards,
    refereeReport,
    matchReview: match.matchReview || [],
    isHomeTeamReviewed:
      Array.isArray(match.matchReview) &&
      match.matchReview.some(
        (r: any) => String(r.team) === String(match.homeTeam?._id || match.homeTeam),
      ),
    isAwayTeamReviewed:
      Array.isArray(match.matchReview) &&
      match.matchReview.some(
        (r: any) => String(r.team) === String(match.awayTeam?._id || match.awayTeam),
      ),
    timerStatus: baseMatch.timerStatus,
    timerStartedAt: baseMatch.timerStartedAt,
    elapsedSeconds: baseMatch.elapsedSeconds || 0,
    currentElapsedSeconds: baseMatch.currentElapsedSeconds,
    currentElapsedMinutes: baseMatch.currentElapsedMinutes,
    totalDurationMinutes: baseMatch.totalDurationMinutes,
  };
};

// UPDATE
const updateMatchToDB = async (id: string, payload: any) => {
  const match = await Match.findById(id);

  if (!match) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");
  }

  if (
    payload.homeTeam &&
    payload.awayTeam &&
    payload.homeTeam === payload.awayTeam
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Same team cannot play match");
  }

  const dateFields = [
    "scheduledAt",
    "startedAt",
    "firstHalfStartedAt",
    "halfTimeAt",
    "secondHalfStartedAt",
    "finishedAt",
  ];
  dateFields.forEach((field) => {
    if (payload[field] !== undefined) {
      payload[field] = payload[field] ? new Date(payload[field]) : null;
    }
  });
  if (payload.venueName && mongoose.Types.ObjectId.isValid(payload.venueName)) {
    payload.venueCategory = payload.venueName;
    const categoryDoc = await VenueCategory.findById(payload.venueName);
    if (categoryDoc) {
      payload.venueName = categoryDoc.name;
      
      const subVal = payload.subVenue || payload.pitch;
      if (subVal && mongoose.Types.ObjectId.isValid(subVal)) {
        payload.venueSubCategory = subVal;
        const subCategoryObj = categoryDoc.subCategories?.find(
          (s: any) => s._id?.toString() === subVal.toString() || s.id?.toString() === subVal.toString()
        );
        if (subCategoryObj) {
          payload.venueName = `${categoryDoc.name}, ${subCategoryObj.name}`;
        }
      }
    }
  } else if (payload.venueName === "") {
    payload.venueCategory = null;
  }
  
  const subVal = payload.subVenue || payload.pitch;
  if (subVal && mongoose.Types.ObjectId.isValid(subVal)) {
    payload.venueSubCategory = subVal;
  } else if (subVal === "" || subVal === undefined) {
    payload.venueSubCategory = null;
  }

  const updatedMatch = await Match.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });

  if (!updatedMatch) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to update match");
  }

  await emitMatchUpdate(id);

  return await formatMatchVenue(updatedMatch);
};

// DELETE
const deleteMatchFromDB = async (id: string) => {
  const match = await Match.findById(id);

  if (!match) {
    throw new Error("Match not found");
  }

  // 1. Rollback all match events (goals/assists/cards, reducing player stats & reversing user coins)
  try {
    await MatchResultService.rollbackAllResultsForMatch(id);
    await revokeMatchCleanSheets(id);
  } catch (err) {
    console.error("Error in rollbackAllResultsForMatch/revokeMatchCleanSheets:", err);
  }

  // 2. Rollback Player of the Day and Team Conduct rewards from referee evaluations
  try {
    const evaluations = await MatchEvaluation.find({ match: id });
    if (evaluations.length > 0) {
      const pe = await PlayerEconomy.findOne();
      const ce = await ClubEconomy.findOne();
      const potdCoin = pe?.playerOfTheDay?.coin ?? 0;
      const potdMV = pe?.playerOfTheDay?.marketValue ?? 0;

      for (const evaluation of evaluations) {
        if (evaluation.manOfTheMatch) {
          // Rollback playerOfTheDay count in PlayerStats
          const currentStats = await PlayerStats.findOne({ player: evaluation.manOfTheMatch });
          if (currentStats) {
            const newPOTD = Math.max(0, (currentStats.playerOfTheDay ?? 0) - 1);
            await PlayerStats.findOneAndUpdate(
              { player: evaluation.manOfTheMatch },
              { $set: { playerOfTheDay: newPOTD } }
            );
          }

          // Rollback player user coins and market value
          const playerUser = await User.findById(evaluation.manOfTheMatch);
          if (playerUser && (potdCoin > 0 || potdMV > 0)) {
            const isPro = await isUserPremiumPlayer(evaluation.manOfTheMatch);
            const minFloorCoin = getMinFloorCoin(pe, isPro);
            const minFloorMV = Number(pe?.startingMarketValue) || 10000000;
            const newCoin = Math.max(minFloorCoin, (playerUser.engCoine ?? 0) - potdCoin);
            const newMV = Math.max(minFloorMV, (playerUser.marketValue ?? 0) - potdMV);
            await User.findByIdAndUpdate(evaluation.manOfTheMatch, {
              $set: { engCoine: newCoin, marketValue: newMV },
            });
          }
        }

        // Rollback Home Team Conduct Rating coins and budget
        if (evaluation.homeTeam && evaluation.homeTeamRating != null) {
          const r = evaluation.homeTeamRating > 10 ? evaluation.homeTeamRating / 10 : evaluation.homeTeamRating;
          let hCoin = 0, hBudget = 0;
          if (r >= 10) {
            hCoin = Number(ce?.exceptionalConduct?.coin) || 0;
            hBudget = Number(ce?.exceptionalConduct?.budgetValue) || 0;
          } else if (r >= 8.0) {
            hCoin = Number(ce?.goodConduct?.coin) || 0;
            hBudget = Number(ce?.goodConduct?.budgetValue) || 0;
          } else if (r >= 6.0) {
            hCoin = Number(ce?.satisfactoryConduct?.coin) || 0;
            hBudget = Number(ce?.satisfactoryConduct?.budgetValue) || 0;
          } else if (r >= 5.0) {
            hCoin = Number(ce?.averageConduct?.coin) || 0;
            hBudget = Number(ce?.averageConduct?.budgetValue) || 0;
          } else if (r >= 3.0) {
            hCoin = Number(ce?.poorConduct?.coin) || 0;
            hBudget = Number(ce?.poorConduct?.budgetValue) || 0;
          } else {
            hCoin = Number(ce?.unprofessionalConduct?.coin) || 0;
            hBudget = Number(ce?.unprofessionalConduct?.budgetValue) || 0;
          }

          if (hCoin > 0 || hBudget > 0) {
            await rollbackClubCoinsSafely(id, evaluation.homeTeam, hCoin, hBudget);
          }
        }

        // Rollback Away Team Conduct Rating coins and budget
        if (evaluation.awayTeam && evaluation.awayTeamRating != null) {
          const r = evaluation.awayTeamRating > 10 ? evaluation.awayTeamRating / 10 : evaluation.awayTeamRating;
          let aCoin = 0, aBudget = 0;
          if (r >= 10) {
            aCoin = Number(ce?.exceptionalConduct?.coin) || 0;
            aBudget = Number(ce?.exceptionalConduct?.budgetValue) || 0;
          } else if (r >= 8.0) {
            aCoin = Number(ce?.goodConduct?.coin) || 0;
            aBudget = Number(ce?.goodConduct?.budgetValue) || 0;
          } else if (r >= 6.0) {
            aCoin = Number(ce?.satisfactoryConduct?.coin) || 0;
            aBudget = Number(ce?.satisfactoryConduct?.budgetValue) || 0;
          } else if (r >= 5.0) {
            aCoin = Number(ce?.averageConduct?.coin) || 0;
            aBudget = Number(ce?.averageConduct?.budgetValue) || 0;
          } else if (r >= 3.0) {
            aCoin = Number(ce?.poorConduct?.coin) || 0;
            aBudget = Number(ce?.poorConduct?.budgetValue) || 0;
          } else {
            aCoin = Number(ce?.unprofessionalConduct?.coin) || 0;
            aBudget = Number(ce?.unprofessionalConduct?.budgetValue) || 0;
          }

          if (aCoin > 0 || aBudget > 0) {
            await rollbackClubCoinsSafely(id, evaluation.awayTeam, aCoin, aBudget);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error rolling back evaluations:", err);
  }

  // 3. Rollback Team win/draw reward coins ONLY if resultCoinAwarded was true
  try {
    if (match.resultCoinAwarded) {
      const ce = await ClubEconomy.findOne();
      const homeTeamId = match.homeTeam;
      const awayTeamId = match.awayTeam;
      const homeScore = match.homeScore || 0;
      const awayScore = match.awayScore || 0;

      if (homeScore === awayScore) {
        const drawCoin = Number(ce?.drawMatch?.coin) || 0;
        const drawBudget = Number(ce?.drawMatch?.budgetValue) || (drawCoin * 10);
        if (drawCoin > 0 || drawBudget > 0) {
          if (homeTeamId) {
            await rollbackClubCoinsSafely(id, homeTeamId, drawCoin, drawBudget);
          }
          if (awayTeamId) {
            await rollbackClubCoinsSafely(id, awayTeamId, drawCoin, drawBudget);
          }
        }
      } else {
        const winCoin = Number(ce?.winMatch?.coin) || 0;
        const winBudget = Number(ce?.winMatch?.budgetValue) || (winCoin * 10);
        const winnerTeamId = match.winnerTeam || (homeScore > awayScore ? homeTeamId : awayTeamId);
        if (winnerTeamId && (winCoin > 0 || winBudget > 0)) {
          await rollbackClubCoinsSafely(id, winnerTeamId, winCoin, winBudget);
        }
      }
    }
  } catch (err) {
    console.error("Error rolling back win/draw coins:", err);
  }

  // 4. Rollback match start attendance and player coins if awarded
  if (match.coinAwarded) {
    try {
      const ce = await ClubEconomy.findOne();
      const pe = await PlayerEconomy.findOne();
      const attendCoin = Number(ce?.attendMatch?.coin) || 0;
      const attendBudget = Number(ce?.attendMatch?.budgetValue) || (attendCoin * 10);
      const playCoin = Number(pe?.playingMatch?.coin) || 0;
      const playMV = Number(pe?.playingMatch?.marketValue) || 0;

      if (attendCoin > 0 || attendBudget > 0) {
        if (match.homeTeam) {
          await rollbackClubCoinsSafely(id, match.homeTeam, attendCoin, attendBudget);
        }
        if (match.awayTeam) {
          await rollbackClubCoinsSafely(id, match.awayTeam, attendCoin, attendBudget);
        }
      }
    } catch (err) {
      console.error("Error rolling back match start coins:", err);
    }
  }

  // 4.1. Rollback match player participation coins
  try {
    await revokeMatchPlayerParticipation(id);
  } catch (partRollbackErr) {
    console.error("Error rolling back match player participation coins:", partRollbackErr);
  }

  // 4.5. Rollback feedback/reviews given by manager (matchReview)
  if (match.matchReview && match.matchReview.length > 0) {
    try {
      const pe = await PlayerEconomy.findOne();
      const ce = await ClubEconomy.findOne();

      for (const r of match.matchReview) {
        if (r.player) {
          const coinToDeduct = Number(r.coinImpact) || 0;
          const mvToDeduct = Number((r as any).valueImpact) || (coinToDeduct * (pe?.conversionRate ?? 10));

          const pUser = await User.findById(r.player);
          if (pUser && (coinToDeduct > 0 || mvToDeduct > 0)) {
            const isPro = await isUserPremiumPlayer(r.player);
            const minFloorCoin = getMinFloorCoin(pe, isPro);
            const minFloorMV = Number(pe?.startingMarketValue) || 10000000;
            const newCoin = Math.max(minFloorCoin, (pUser.engCoine ?? 0) - coinToDeduct);
            const newMV = Math.max(minFloorMV, (pUser.marketValue ?? 0) - mvToDeduct);
            await User.findByIdAndUpdate(r.player, {
              $set: { engCoine: newCoin, marketValue: newMV },
            });
          }
        }

        if (r.team) {
          const numRating = Number(r.rating);
          const rNorm = numRating > 10 ? numRating / 10 : numRating;
          let coinToDeduct = Number(r.coinImpact) || 0;
          let budgetToDeduct = 0;

          if (rNorm >= 9.0) {
            budgetToDeduct = Number(ce?.exceptionalConduct?.budgetValue) || 0;
            if (!coinToDeduct) coinToDeduct = Number(ce?.exceptionalConduct?.coin) || 0;
          } else if (rNorm >= 8.0) {
            budgetToDeduct = Number(ce?.goodConduct?.budgetValue) || 0;
            if (!coinToDeduct) coinToDeduct = Number(ce?.goodConduct?.coin) || 0;
          } else if (rNorm >= 7.0) {
            budgetToDeduct = Number(ce?.satisfactoryConduct?.budgetValue) || 0;
            if (!coinToDeduct) coinToDeduct = Number(ce?.satisfactoryConduct?.coin) || 0;
          }

          if (coinToDeduct > 0 || budgetToDeduct > 0) {
            await rollbackClubCoinsSafely(id, r.team, coinToDeduct, budgetToDeduct);
          }
        }
      }
    } catch (reviewErr) {
      console.error("Error rolling back matchReview feedback coins:", reviewErr);
    }
  }

  // 5. Clean up referee ratings/evaluations, player selections, and match results for this match
  try {
    // Find all players who participated in this match before deleting records
    const selections = await MatchPlayerSelection.find({ match: id });
    const matchResults = await MatchResult.find({ match: id });
    const matchDoc = await Match.findById(id).lean();
    const playerIdsToUpdate = new Set<string>();

    selections.forEach((sel: any) => {
      sel.players?.forEach((p: any) => {
        if (p.player) playerIdsToUpdate.add(p.player.toString());
      });
    });

    matchResults.forEach((mr: any) => {
      if (mr.player) playerIdsToUpdate.add(mr.player.toString());
      if (mr.eventMeta?.assist) playerIdsToUpdate.add(mr.eventMeta.assist.toString());
    });

    if (matchDoc?.matchReview) {
      matchDoc.matchReview.forEach((r: any) => {
        if (r.player) playerIdsToUpdate.add(r.player.toString());
      });
    }

    if (playerIdsToUpdate.size > 0) {
      const pIdList = Array.from(playerIdsToUpdate);
      await PlayerStats.updateMany(
        { player: { $in: pIdList }, totalMatches: { $gt: 0 } },
        { $inc: { totalMatches: -1 } }
      );
      await PlayerStats.updateMany(
        { player: { $in: pIdList }, matchesPlayed: { $gt: 0 } },
        { $inc: { matchesPlayed: -1 } }
      );
    }
  } catch (statErr) {
    console.error("Error decrementing PlayerStats on match deletion:", statErr);
  }

  try {
    await MatchEvaluation.deleteMany({ match: id });
  } catch (err) {
    console.error("Error deleting MatchEvaluation:", err);
  }

  try {
    await MatchPlayerSelection.deleteMany({ match: id });
  } catch (err) {
    console.error("Error deleting MatchPlayerSelection:", err);
  }

  try {
    await MatchResult.deleteMany({ match: id });
  } catch (err) {
    console.error("Error deleting MatchResult:", err);
  }

  // 6. Delete the match document itself
  const deleted = await Match.findByIdAndDelete(id);
  if (deleted) {
    if ((global as any).io) {
      (global as any).io.emit("matches_list_update", { _id: id, deleted: true });
    }
  }
  return deleted;
};

// TOGGLE STATUS (Sequence: scheduled -> live (1st half) -> half_time -> live (2nd half) -> finished)
const toggleMatchStatusToDB = async (id: string, userRole: string = "") => {
  const match = await Match.findById(id);

  if (!match) {
    throw new Error("Match not found");
  }

  let nextStatus = "live";
  let nextPeriod = match.period;

  if (match.status === "scheduled" || match.status === "upcoming") {
    nextStatus = "live";
    nextPeriod = "first_half";
  } else if (
    match.status === "live" &&
    (match.period === "first_half" || !match.period)
  ) {
    nextStatus = "half_time";
    nextPeriod = "first_half";
  } else if (match.status === "half_time") {
    nextStatus = "live";
    nextPeriod = "second_half";
  } else if (match.status === "live" && match.period === "second_half") {
    nextStatus = "finished";
    nextPeriod = "second_half";
  } else {
    nextStatus = "finished";
    nextPeriod = "second_half";
  }

  return await updateMatchStatusInDB(
    id,
    { status: nextStatus, period: nextPeriod },
    userRole,
  );
};

export async function processMatchCompletion(matchDoc: any) {
  const matchId = matchDoc._id?.toString() || matchDoc.toString();
  const match = await Match.findById(matchId);
  if (!match) return;

  // 1. 🏆 Award Win / Draw coins according to ClubEconomy if not already awarded
  if (!match.resultCoinAwarded) {
    try {
      const ce = await ClubEconomy.findOne();
      const homeScore = Number(match.homeScore) || 0;
      const awayScore = Number(match.awayScore) || 0;

      if (homeScore === awayScore) {
        const drawCoin = Number(ce?.drawMatch?.coin) || 0;
        const drawBudget = Number(ce?.drawMatch?.budgetValue) || drawCoin * 10;
        if (drawCoin > 0 || drawBudget > 0) {
          if (match.homeTeam) {
            await awardClubCoinsSafely(
              match._id,
              match.homeTeam,
              drawCoin,
              drawBudget,
              undefined,
              TEAM_COIN_CATEGORY.DRAW_MATCH,
              "Match Draw Reward",
              "Earned coins for drawing the match"
            );
          }
          if (match.awayTeam) {
            await awardClubCoinsSafely(
              match._id,
              match.awayTeam,
              drawCoin,
              drawBudget,
              undefined,
              TEAM_COIN_CATEGORY.DRAW_MATCH,
              "Match Draw Reward",
              "Earned coins for drawing the match"
            );
          }
        }
      } else {
        const winnerId = homeScore > awayScore ? match.homeTeam : match.awayTeam;
        match.winnerTeam = winnerId as any;
        const winCoin = Number(ce?.winMatch?.coin) || 0;
        const winBudget = Number(ce?.winMatch?.budgetValue) || winCoin * 10;
        if (winnerId && (winCoin > 0 || winBudget > 0)) {
          await awardClubCoinsSafely(
            match._id,
            winnerId,
            winCoin,
            winBudget,
            undefined,
            TEAM_COIN_CATEGORY.WIN_MATCH,
            "Match Victory Reward",
            "Earned coins for winning the match"
          );
        }
      }
      match.resultCoinAwarded = true;
      await match.save();
    } catch (err) {
      console.error("Failed to award match finish win/draw coins to teams:", err);
    }
  }

  // 2. Auto-award Clean Sheets to GK and Defenders if opponent conceded 0
  try {
    await awardMatchCleanSheets(match._id);
  } catch (csErr) {
    console.error("Failed to auto-award clean sheets on match finish:", csErr);
  }

  // 3. Auto-award Playing Match coins to participating players
  try {
    await awardMatchPlayerParticipation(match._id);
  } catch (partErr) {
    console.error("Failed to auto-award match playing coins on match finish:", partErr);
  }

  // 4. Notify subscribers of both teams about Full-Time match result via BullMQ
  try {
    const [homeTeamDoc, awayTeamDoc] = await Promise.all([
      match.homeTeam ? Team.findById(match.homeTeam).select("teamName").lean() : null,
      match.awayTeam ? Team.findById(match.awayTeam).select("teamName").lean() : null,
    ]);

    const hName = homeTeamDoc?.teamName || "Home Team";
    const aName = awayTeamDoc?.teamName || "Away Team";
    const hScore = match.homeScore || 0;
    const aScore = match.awayScore || 0;
    const fullTimeMsg = `Full-Time Result: ${hName} ${hScore} - ${aScore} ${aName}.`;

    if (match.homeTeam) {
      await NotificationQueueHelper.notifyTeamSubscribers(
        match.homeTeam.toString(),
        `Full Time: ${hName}`,
        fullTimeMsg,
        "MATCH_RESULT",
        match._id.toString(),
        "Match",
        { matchId: match._id.toString(), homeScore: String(hScore), awayScore: String(aScore) }
      );
    }

    if (match.awayTeam) {
      await NotificationQueueHelper.notifyTeamSubscribers(
        match.awayTeam.toString(),
        `Full Time: ${aName}`,
        fullTimeMsg,
        "MATCH_RESULT",
        match._id.toString(),
        "Match",
        { matchId: match._id.toString(), homeScore: String(hScore), awayScore: String(aScore) }
      );
    }
  } catch (teamNotifErr) {
    console.error("Failed to notify team subscribers of match finish:", teamNotifErr);
  }
}

export async function notifyMatchHalfTime(matchDoc: any) {
  try {
    const matchId = matchDoc._id?.toString() || matchDoc.toString();
    const match = await Match.findById(matchId);
    if (!match) return;

    const [homeTeam, awayTeam] = await Promise.all([
      match.homeTeam ? Team.findById(match.homeTeam).select("teamName").lean() : null,
      match.awayTeam ? Team.findById(match.awayTeam).select("teamName").lean() : null,
    ]);

    const hName = homeTeam?.teamName || "Home Team";
    const aName = awayTeam?.teamName || "Away Team";
    const hScore = Number(match.homeScore) || 0;
    const aScore = Number(match.awayScore) || 0;
    const title = `Half Time: ${hName} ${hScore} - ${aScore} ${aName}`;
    const message = `Half-time interval for ${hName} vs ${aName}. Score: ${hName} ${hScore} - ${aScore} ${aName}.`;

    if (match.homeTeam) {
      await NotificationQueueHelper.notifyTeamSubscribers(
        match.homeTeam.toString(),
        title,
        message,
        "HALF_TIME",
        match._id.toString(),
        "Match",
        { matchId: match._id.toString(), homeScore: String(hScore), awayScore: String(aScore), period: "half_time" }
      );
    }

    if (match.awayTeam) {
      await NotificationQueueHelper.notifyTeamSubscribers(
        match.awayTeam.toString(),
        title,
        message,
        "HALF_TIME",
        match._id.toString(),
        "Match",
        { matchId: match._id.toString(), homeScore: String(hScore), awayScore: String(aScore), period: "half_time" }
      );
    }
  } catch (err) {
    console.error("Failed to notify half time:", err);
  }
}

export async function notifyMatchSecondHalfLive(matchDoc: any) {
  try {
    const matchId = matchDoc._id?.toString() || matchDoc.toString();
    const match = await Match.findById(matchId);
    if (!match) return;

    const [homeTeam, awayTeam] = await Promise.all([
      match.homeTeam ? Team.findById(match.homeTeam).select("teamName").lean() : null,
      match.awayTeam ? Team.findById(match.awayTeam).select("teamName").lean() : null,
    ]);

    const hName = homeTeam?.teamName || "Home Team";
    const aName = awayTeam?.teamName || "Away Team";
    const hScore = Number(match.homeScore) || 0;
    const aScore = Number(match.awayScore) || 0;
    const title = `Second Half Live: ${hName} vs ${aName}`;
    const message = `The second half of ${hName} vs ${aName} has kicked off! Current score: ${hName} ${hScore} - ${aScore} ${aName}.`;

    if (match.homeTeam) {
      await NotificationQueueHelper.notifyTeamSubscribers(
        match.homeTeam.toString(),
        title,
        message,
        "MATCH_LIVE_2ND_HALF",
        match._id.toString(),
        "Match",
        { matchId: match._id.toString(), period: "second_half", homeScore: String(hScore), awayScore: String(aScore) }
      );
    }

    if (match.awayTeam) {
      await NotificationQueueHelper.notifyTeamSubscribers(
        match.awayTeam.toString(),
        title,
        message,
        "MATCH_LIVE_2ND_HALF",
        match._id.toString(),
        "Match",
        { matchId: match._id.toString(), period: "second_half", homeScore: String(hScore), awayScore: String(aScore) }
      );
    }
  } catch (err) {
    console.error("Failed to notify second half live:", err);
  }
}

export async function checkAndFinishExpiredMatches() {
  try {
    const liveMatches = await Match.find({
      status: "live",
      timerStatus: "running",
      period: "second_half",
    });

    if (!liveMatches || liveMatches.length === 0) return;

    const now = Date.now();
    for (const match of liveMatches) {
      const durationMinutes = parseInt(match.durationMinutes) || 90;
      const halfTimeSeconds = Math.floor((durationMinutes / 2) * 60);
      let elapsed = match.elapsedSeconds || 0;
      if (match.timerStartedAt) {
        const diff = Math.floor((now - new Date(match.timerStartedAt).getTime()) / 1000);
        if (diff > 0) elapsed += diff;
      }

      if (elapsed >= halfTimeSeconds) {
        const finishedAt = match.finishedAt || new Date();
        const claimedMatch = await Match.findOneAndUpdate(
          {
            _id: match._id,
            status: "live",
            timerStatus: "running",
            period: "second_half",
          },
          {
            $set: {
              elapsedSeconds: halfTimeSeconds,
              timerStatus: "finished",
              timerStartedAt: null,
              status: "finished",
              finishedAt,
            },
          },
          { new: true }
        );

        if (!claimedMatch) continue;






        await emitMatchUpdate(match._id.toString());

        const io = (socketService as any).io;
        if (io) {
          io.emit(`match_${match._id.toString()}_timer`, {
            matchId: match._id.toString(),
            action: "FINISH",
            timerStatus: "finished",
            elapsedSeconds: halfTimeSeconds,
            currentElapsedSeconds: halfTimeSeconds,
            currentElapsedMinutes: Math.floor(halfTimeSeconds / 60),
            timerStartedAt: null,
            status: "finished",
            durationMinutes: match.durationMinutes,
          });
        }

        await processMatchCompletion(match);
      }
    }
  } catch (err) {
    console.error("Error in checkAndFinishExpiredMatches:", err);
  }
}

const updateMatchStatusInDB = async (
  id: string,
  payload: any,
  userRole: string = "",
) => {
  const match = await Match.findById(id);

  if (!match) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");
  }

  const roleUpper = (userRole || "").toString().trim().toUpperCase();
  const isAdmin = roleUpper === "ADMIN" || roleUpper === "SUPER_ADMIN";

  const targetStatus =
    typeof payload === "string"
      ? payload.toLowerCase()
      : (payload?.status || "").toLowerCase();
  const targetPeriod =
    typeof payload === "object" ? payload?.period : undefined;

  const validStatuses = [
    "scheduled",
    "upcoming",
    "live",
    "half_time",
    "finished",
    "cancelled",
  ];
  if (!validStatuses.includes(targetStatus)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
    );
  }

  const oldStatus = match.status;
  const ukNow = getUKNowInUTC();

  // Referee check for starting match (in non-admin flow)
  if ((targetStatus === "live" || targetPeriod === "first_half") && !isAdmin) {
    if (!match.referee) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "A referee must be assigned to the match before making it live",
      );
    }
  }

  // 1️⃣ Status & Period Transitioning & Automatic Server Timestamping
  if (targetStatus === "scheduled" || targetStatus === "upcoming") {
    match.status = targetStatus as any;
    match.period = targetPeriod !== undefined ? targetPeriod : null;
    if (!match.scheduledAt) {
      match.scheduledAt = match.matchDate || ukNow;
    }
  } else if (targetStatus === "live") {
    match.status = "live";
    const requestedPeriod =
      targetPeriod ||
      (oldStatus === "half_time" ? "second_half" : "first_half");
    match.period = requestedPeriod as any;

    if (requestedPeriod === "first_half") {
      if (!match.startedAt) match.startedAt = ukNow;
      if (!match.firstHalfStartedAt || isAdmin)
        match.firstHalfStartedAt = ukNow;
      match.elapsedSeconds = 0; // reset on new first half start
    } else if (requestedPeriod === "second_half") {
      if (!match.secondHalfStartedAt || isAdmin)
        match.secondHalfStartedAt = ukNow;
      match.elapsedSeconds = 0; // restart to 0 for second half
    }

    // Automatically run the match timer
    match.timerStatus = "running";
    match.timerStartedAt = ukNow;

    // Coin Awarding Logic for Teams & Playing Coins for Players (Strictly Once)
    if (!match.coinAwarded) {
      // 1. Award Teams Attend a Match from ClubEconomy
      try {
        const ce = await ClubEconomy.findOne();
        const attendCoin = Number(ce?.attendMatch?.coin) || 0;
        const attendBudget = Number(ce?.attendMatch?.budgetValue) || (attendCoin * 10);

        if (attendCoin > 0 || attendBudget > 0) {
          if (match.homeTeam) {
            await awardClubCoinsSafely(
              match._id,
              match.homeTeam,
              attendCoin,
              attendBudget,
              undefined,
              TEAM_COIN_CATEGORY.ATTEND_MATCH,
              "Match Attendance Reward",
              "Earned coins for attending and participating in the match"
            );
          }
          if (match.awayTeam) {
            await awardClubCoinsSafely(
              match._id,
              match.awayTeam,
              attendCoin,
              attendBudget,
              undefined,
              TEAM_COIN_CATEGORY.ATTEND_MATCH,
              "Match Attendance Reward",
              "Earned coins for attending and participating in the match"
            );
          }
        }
      } catch (err) {
        console.error("Failed to award team attend coins:", err);
      }

      // Player "Playing a Match" coins are awarded only when the manager rates the players after the match in addMatchReviewToDB
      match.coinAwarded = true;
    }
  } else if (targetStatus === "half_time") {
    // Accumulate elapsed seconds if timer was running
    if (match.timerStatus === "running" && match.timerStartedAt) {
      const diff = Math.floor(
        (ukNow.getTime() - new Date(match.timerStartedAt).getTime()) / 1000,
      );
      if (diff > 0) {
        match.elapsedSeconds = (match.elapsedSeconds || 0) + diff;
      }
    }
    match.status = "half_time";
    match.period = targetPeriod || "first_half";
    if (!match.halfTimeAt || isAdmin) {
      match.halfTimeAt = ukNow;
    }
    // Pause timer
    match.timerStatus = "paused";
    match.timerStartedAt = null;
  } else if (targetStatus === "finished") {
    // Accumulate elapsed seconds if timer was running
    if (match.timerStatus === "running" && match.timerStartedAt) {
      const diff = Math.floor(
        (ukNow.getTime() - new Date(match.timerStartedAt).getTime()) / 1000,
      );
      if (diff > 0) {
        match.elapsedSeconds = (match.elapsedSeconds || 0) + diff;
      }
    }
    match.status = "finished";
    match.period = targetPeriod || "second_half";
    if (!match.finishedAt || isAdmin) {
      match.finishedAt = ukNow;
    }
    // Stop/finish timer
    match.timerStatus = "finished";
    match.timerStartedAt = null;

    await processMatchCompletion(match);
  } else if (targetStatus === "cancelled") {
    match.status = "cancelled";
    match.timerStatus = "stopped";
    match.timerStartedAt = null;

    // Rollback clean sheets if match was cancelled
    if (oldStatus === "finished") {
      try {
        await revokeMatchCleanSheets(match._id);
      } catch (csErr) {
        console.error("Failed to revoke clean sheets on match cancel:", csErr);
      }
    }
  }

  // If transitioning away from finished back to live/half_time, revoke clean sheets
  if (oldStatus === "finished" && targetStatus !== "finished" && targetStatus !== "cancelled") {
    try {
      await revokeMatchCleanSheets(match._id);
    } catch (csErr) {
      console.error("Failed to revoke clean sheets on match status reversion:", csErr);
    }
  }

  // 2️⃣ Allow Admin to manually overwrite timestamps & state
  if (isAdmin && typeof payload === "object") {
    if (payload.scheduledAt !== undefined)
      match.scheduledAt = payload.scheduledAt
        ? new Date(payload.scheduledAt)
        : null;
    if (payload.startedAt !== undefined)
      match.startedAt = payload.startedAt ? new Date(payload.startedAt) : null;
    if (payload.firstHalfStartedAt !== undefined)
      match.firstHalfStartedAt = payload.firstHalfStartedAt
        ? new Date(payload.firstHalfStartedAt)
        : null;
    if (payload.halfTimeAt !== undefined)
      match.halfTimeAt = payload.halfTimeAt
        ? new Date(payload.halfTimeAt)
        : null;
    if (payload.secondHalfStartedAt !== undefined)
      match.secondHalfStartedAt = payload.secondHalfStartedAt
        ? new Date(payload.secondHalfStartedAt)
        : null;
    if (payload.finishedAt !== undefined)
      match.finishedAt = payload.finishedAt
        ? new Date(payload.finishedAt)
        : null;
    if (payload.period !== undefined) match.period = payload.period;
  }

  await match.save();

  // Send notifications if status has changed significantly
  if (
    (targetStatus === "live" || targetStatus === "finished") &&
    oldStatus !== targetStatus &&
    !isAdmin
  ) {
    try {
      const homeTeam = await Team.findById(match.homeTeam);
      const awayTeam = await Team.findById(match.awayTeam);
      const matchName = `${homeTeam?.teamName || "Home Team"} vs ${awayTeam?.teamName || "Away Team"}`;

      const userDetails = await User.find({
        selectTeam: { $in: [match.homeTeam, match.awayTeam] },
      });

      if (userDetails.length > 0) {
        const title =
          targetStatus === "live" ? "Match is Live" : "Match Finished";
        const message =
          targetStatus === "live"
            ? `The match ${matchName} has officially started and is now live!`
            : `The match ${matchName} has finished. Check the final match results and ratings.`;

        const userIds = userDetails.map((u) => u._id.toString());

        await NotificationQueueHelper.sendBulkNotifications(
          userIds,
          title,
          message,
          NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED,
          undefined,
          match._id.toString(),
          "Match",
        );
      }

      // Also notify all team subscribers when match kicks off / goes live
      if (targetStatus === "live") {
        const hName = homeTeam?.teamName || "Home Team";
        const aName = awayTeam?.teamName || "Away Team";
        if (match.homeTeam) {
          await NotificationQueueHelper.notifyTeamSubscribers(
            match.homeTeam.toString(),
            `Match is Live: ${hName}`,
            `The match ${hName} vs ${aName} has kicked off and is now live! Follow the action.`,
            "MATCH_LIVE",
            match._id.toString(),
            "Match",
            { matchId: match._id.toString() }
          );
        }
        if (match.awayTeam) {
          await NotificationQueueHelper.notifyTeamSubscribers(
            match.awayTeam.toString(),
            `Match is Live: ${aName}`,
            `The match ${hName} vs ${aName} has kicked off and is now live! Follow the action.`,
            "MATCH_LIVE",
            match._id.toString(),
            "Match",
            { matchId: match._id.toString() }
          );
        }
      }
    } catch (err) {
      console.error("Failed to send status update notification", err);
    }
  }

  await emitMatchUpdate(match._id.toString());

  return await formatMatchVenue(match);
};

const addMatchReviewToDB = async (
  matchId: string,
  payload: {
    reviews?: {
      team?: string;
      player?: string;
      rating: number;
      notes?: string;
    }[];
    playerReviews?: {
      player: string;
      rating: number;
      notes?: string;
    }[];
  },
) => {
  const match = await Match.findById(matchId);

  if (!match) throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");

  // Dynamic Feedback Window (Admin Configurable)
  const setting = await getEffectiveMatchSetting();

  // If match is not marked finished, mark it finished upon review submission so reviews succeed smoothly
  if (match.status !== "finished") {
    match.status = "finished";
    if (!match.finishedAt) {
      match.finishedAt = new Date();
    }
    match.timerStatus = "finished";
    match.timerStartedAt = null;
    await match.save();

    try {
      await processMatchCompletion(match);
    } catch (e) {
      console.error("Failed to auto-award match completion rewards in review submission:", e);
    }
  }

  if (setting.isFeedbackWindowRestricted && setting.feedbackWindowHours > 0) {
    const finishTime = match.finishedAt || (match as any).updatedAt || match.matchDate;
    if (finishTime) {
      const targetTz = setting.timezone || "Europe/London";
      const nowUK = dayjs().tz(targetTz);
      const finishUK = dayjs(finishTime).tz(targetTz);
      const hoursSinceFinish = nowUK.diff(finishUK, "hour", true);
      if (hoursSinceFinish > setting.feedbackWindowHours) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Feedback window expired. Reviews cannot be submitted after ${setting.feedbackWindowHours} hours of match completion (${targetTz} Time)`,
        );
      }
    }
  }

  const allReviews = [
    ...(payload.reviews || []),
    ...(payload.playerReviews || []),
  ];

  if (!allReviews.length) {
    throw new Error("No reviews provided");
  }

  const pe = await PlayerEconomy.findOne();
  const ce = await ClubEconomy.findOne();

  const getPlayerReward = (rating: number) => {
    const r = rating > 10 ? rating / 10 : rating;
    if (r >= 9.0) {
      return {
        coin: Number(pe?.eliteRating?.coin) || 0,
        marketValue: Number(pe?.eliteRating?.marketValue) || 0,
      };
    }
    if (r >= 8.0) {
      return {
        coin: Number(pe?.greatRating?.coin) || 0,
        marketValue: Number(pe?.greatRating?.marketValue) || 0,
      };
    }
    if (r >= 7.0) {
      return {
        coin: Number(pe?.goodRating?.coin) || 0,
        marketValue: Number(pe?.goodRating?.marketValue) || 0,
      };
    }
    return { coin: 0, marketValue: 0 };
  };

  const getTeamReward = (rating: number) => {
    const r = rating > 10 ? rating / 10 : rating;
    if (r >= 10) {
      return {
        coin: Number(ce?.exceptionalConduct?.coin) || 0,
        budgetValue: Number(ce?.exceptionalConduct?.budgetValue) || 0,
      };
    }
    if (r >= 8.0) {
      return {
        coin: Number(ce?.goodConduct?.coin) || 0,
        budgetValue: Number(ce?.goodConduct?.budgetValue) || 0,
      };
    }
    if (r >= 6.0) {
      return {
        coin: Number(ce?.satisfactoryConduct?.coin) || 0,
        budgetValue: Number(ce?.satisfactoryConduct?.budgetValue) || 0,
      };
    }
    if (r >= 5.0) {
      return {
        coin: Number(ce?.averageConduct?.coin) || 0,
        budgetValue: Number(ce?.averageConduct?.budgetValue) || 0,
      };
    }
    if (r >= 3.0) {
      return {
        coin: Number(ce?.poorConduct?.coin) || 0,
        budgetValue: Number(ce?.poorConduct?.budgetValue) || 0,
      };
    }
    return {
      coin: Number(ce?.unprofessionalConduct?.coin) || 0,
      budgetValue: Number(ce?.unprofessionalConduct?.budgetValue) || 0,
    };
  };

  const reviewsWithCoin = await Promise.all(
    allReviews.map(async (r: any) => {
      let coinImpact = 0;
      let valueImpact = 0;
      const numRating = Number(r.rating);
      let teamId = r.team;

      if (r.player) {
        if (!teamId) {
          const pUser = await User.findById(r.player).select("selectTeam");
          if (pUser?.selectTeam) {
            teamId = pUser.selectTeam;
          }
        }
        const isPro = await isUserPremiumPlayer(r.player);
        if (isPro) {
          // Manager Rating Reward from PlayerEconomy (Elite: 300, Great: 200, Good: 100)
          const ratingReward = getPlayerReward(numRating);

          // Playing a match appearance bonus is awarded strictly once upon match completion
          coinImpact = ratingReward.coin;
          valueImpact = ratingReward.marketValue;
        } else {
          // Non-professional / free players receive NO coins
          coinImpact = 0;
          valueImpact = 0;
        }
      } else if (r.team) {
        const reward = getTeamReward(numRating);
        coinImpact = reward.coin;
        valueImpact = reward.budgetValue;
      }

      return {
        team: teamId || undefined,
        player: r.player || undefined,
        rating: numRating,
        notes: r.notes || null,
        coinImpact,
        valueImpact,
      };
    }),
  );

  // Update existing reviews if present, or push new reviews
  if (!match.matchReview) {
    match.matchReview = [] as any;
  }

  for (const newRev of reviewsWithCoin) {
    const existingIndex = match.matchReview.findIndex((existing: any) => {
      if (newRev.player && existing.player) {
        return String(existing.player) === String(newRev.player);
      }
      if (newRev.team && existing.team && !newRev.player && !existing.player) {
        return String(existing.team) === String(newRev.team);
      }
      return false;
    });

    if (existingIndex !== -1) {
      const oldCoin = match.matchReview[existingIndex].coinImpact || 0;
      const oldMV = match.matchReview[existingIndex].valueImpact || 0;

      (newRev as any).coinDelta = newRev.coinImpact - oldCoin;
      (newRev as any).valueDelta = newRev.valueImpact - oldMV;

      // Update existing review
      match.matchReview[existingIndex].rating = newRev.rating;
      match.matchReview[existingIndex].notes = newRev.notes;
      match.matchReview[existingIndex].coinImpact = newRev.coinImpact;
      match.matchReview[existingIndex].valueImpact = newRev.valueImpact;
      if (newRev.team) {
        match.matchReview[existingIndex].team = newRev.team;
      }
    } else {
      (newRev as any).coinDelta = newRev.coinImpact;
      (newRev as any).valueDelta = newRev.valueImpact;
      match.matchReview.push({
        team: newRev.team,
        player: newRev.player,
        rating: newRev.rating,
        notes: newRev.notes,
        coinImpact: newRev.coinImpact,
        valueImpact: newRev.valueImpact,
      } as any);
    }
  }

  await match.save();

  // Apply coins and market values for teams and players
  for (const r of reviewsWithCoin) {
    const coinDelta = (r as any).coinDelta || 0;
    const valueDelta = (r as any).valueDelta || 0;

    if (r.team && (coinDelta !== 0 || valueDelta !== 0)) {
      await Team.findByIdAndUpdate(r.team, {
        $inc: { coin: coinDelta, marketValue: valueDelta },
      });
    }
    if (r.player) {
      try {
        let opponentDesc = "";
        try {
          const mDoc = await Match.findById(match._id)
            .populate("homeTeam", "teamName shortName")
            .populate("awayTeam", "teamName shortName")
            .lean();
          if (mDoc) {
            const hId = (mDoc.homeTeam as any)?._id?.toString() || mDoc.homeTeam?.toString();
            const aId = (mDoc.awayTeam as any)?._id?.toString() || mDoc.awayTeam?.toString();
            const hName = (mDoc.homeTeam as any)?.teamName || (mDoc.homeTeam as any)?.shortName || "Home";
            const aName = (mDoc.awayTeam as any)?.teamName || (mDoc.awayTeam as any)?.shortName || "Away";
            const rTeamId = r.team ? r.team.toString() : "";
            if (rTeamId && rTeamId === hId) {
              opponentDesc = ` vs ${aName}`;
            } else if (rTeamId && rTeamId === aId) {
              opponentDesc = ` vs ${hName}`;
            } else {
              opponentDesc = ` in ${hName} vs ${aName}`;
            }
          }
        } catch (_) {}

        // Adjust player balance by coinDelta (new rating coin - old rating coin)
        let playerUser = await User.findById(r.player);
        if (playerUser) {
          if (coinDelta !== 0) {
            const currentCoins = Number(playerUser.engCoine) || 0;
            playerUser.engCoine = Math.max(0, currentCoins + coinDelta);
          }
          if (valueDelta !== 0) {
            const pe = await PlayerEconomy.findOne();
            const rate = Number(pe?.conversionRate) || 10;
            const floorMV = Number(pe?.startingMarketValue) || 100000;
            playerUser.marketValue = Math.max(floorMV, Number(playerUser.engCoine) * rate);
          }
          if (coinDelta !== 0 || valueDelta !== 0) {
            await playerUser.save();
          }
        }

        // Update or create CoinTransaction history
        const existingRatingTxs = await CoinTransaction.find({
          user: r.player,
          match: match._id,
          category: COIN_TRANSACTION_CATEGORY.MATCH_RATING,
        }).sort({ createdAt: 1 });

        if (existingRatingTxs.length > 0) {
          // Update the existing transaction with the latest rating and coin amount
          const primaryTx = existingRatingTxs[0];
          primaryTx.amount = r.coinImpact || 0;
          primaryTx.type = "CREDIT";
          primaryTx.title = "Match Rating Reward";
          primaryTx.description = `Manager match evaluation rating: ${r.rating}/10${opponentDesc}`;
          if (playerUser) {
            primaryTx.balanceAfter = Number(playerUser.engCoine) || 0;
          }
          await primaryTx.save();

          // Clean up any extra duplicate rating transactions from previous edits
          if (existingRatingTxs.length > 1) {
            const extraIds = existingRatingTxs.slice(1).map((t: any) => t._id);
            await CoinTransaction.deleteMany({ _id: { $in: extraIds } });
          }
        } else if (r.coinImpact > 0) {
          // First time rating that earned coins
          const currentBalance = playerUser ? Number(playerUser.engCoine) || 0 : r.coinImpact;
          await CoinTransaction.create({
            user: r.player,
            amount: r.coinImpact,
            type: "CREDIT",
            category: COIN_TRANSACTION_CATEGORY.MATCH_RATING,
            title: "Match Rating Reward",
            description: `Manager match evaluation rating: ${r.rating}/10${opponentDesc}`,
            match: match._id,
            referenceId: match._id.toString(),
            balanceBefore: Math.max(0, currentBalance - r.coinImpact),
            balanceAfter: currentBalance,
          });
        }
      } catch (coinErr) {
        console.error("Error updating match review coin transaction:", coinErr);
        if (coinDelta !== 0 || valueDelta !== 0) {
          await User.findByIdAndUpdate(r.player, {
            $inc: { engCoine: coinDelta, marketValue: valueDelta },
          });
        }
      }
    }
  }

  return match;
};

const getUpcomingMatchesForManagerFromDB = async (
  managerId: string,
  query: Record<string, any>,
) => {
  const managerTeams = await ManagerTeam.find({
    manager: new mongoose.Types.ObjectId(managerId),
  });

  const teamIds = managerTeams.map((item) => item.team);

  const statusCondition: any = query.status
    ? query.status === "ALL"
      ? {}
      : { status: query.status }
    : { status: "upcoming" };

  const matchQuery = new QueryBuilder(
    Match.find({
      ...statusCondition,
      $or: [{ homeTeam: { $in: teamIds } }, { awayTeam: { $in: teamIds } }],
    }),
    query,
  )
    .filter()
    .sort()
    .paginate()
    .fields();

  const matches = await matchQuery.modelQuery
    .populate("league")
    .populate("homeTeam")
    .populate("awayTeam")
    .populate("referee")
    .populate("winnerTeam")
    .populate("venueCategory", "name")
    .populate("venueSubCategory", "name");

  const meta = await matchQuery.getPaginationInfo();
  const formattedResult = await Promise.all(
    matches.map((m: any) => formatMatchVenue(m)),
  );

  return {
    meta,
    result: formattedResult,
  };
};

const updateMatchTimerInDB = async (    
  matchId: string,
  action: "START" | "PAUSE" | "RESUME" | "FINISH",
  user?: any,
) => {
  const match = await Match.findById(matchId);

  if (!match) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");
  }

  const now = new Date();
  let elapsed = match.elapsedSeconds || 0;

  // Accumulate segment elapsed time if timer was running
  if (match.timerStatus === "running" && match.timerStartedAt) {
    const diffSeconds = Math.floor(
      (now.getTime() - new Date(match.timerStartedAt).getTime()) / 1000,
    );
    if (diffSeconds > 0) {
      elapsed += diffSeconds;
    }
  }

  const durationMinutes = parseInt(match.durationMinutes) || 90;
  const halfTimeSeconds = Math.floor((durationMinutes / 2) * 60);

  // Auto-expire only if timer was actually running and elapsed has reached halfTimeSeconds
  if (match.timerStatus === "running" && match.timerStartedAt && elapsed >= halfTimeSeconds) {
    elapsed = halfTimeSeconds;
    match.timerStatus = match.period === "second_half" ? "finished" : "paused";
    match.timerStartedAt = null;
    match.elapsedSeconds = elapsed;
    if (match.period === "second_half") {
      match.status = "finished";
      if (!match.finishedAt) {
        match.finishedAt = now;
      }
    } else {
      match.status = "half_time";
      if (!match.halfTimeAt) {
        match.halfTimeAt = now;
      }
    }
    await match.save();
    await emitMatchUpdate(matchId);

    const io = (socketService as any).io;
    if (io) {
      io.emit(`match_${matchId}_timer`, {
        matchId,
        action: match.period === "second_half" ? "FINISH" : "PAUSE",
        timerStatus: match.timerStatus,
        elapsedSeconds: match.elapsedSeconds,
        currentElapsedSeconds: elapsed,
        currentElapsedMinutes: Math.floor(elapsed / 60),
        timerStartedAt: match.timerStartedAt,
        status: match.status,
        durationMinutes: match.durationMinutes,
      });
    }

    if (match.period === "second_half") {
      await processMatchCompletion(match);
    } else {
      await notifyMatchHalfTime(match);
    }

    const formatted = await formatMatchVenue(match);
    return {
      ...formatted,
      currentElapsedSeconds: elapsed,
      currentElapsedMinutes: Math.floor(elapsed / 60),
    };
  }

  switch (action) {
    case "START":
      if (!match.referee) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "A referee must be assigned to the match before starting the match timer",
        );
      }
      if (match.status === "half_time" || match.period === "second_half") {
        match.period = "second_half";
        match.timerStatus = "running";
        match.timerStartedAt = now;
        match.elapsedSeconds = 0;
        match.status = "live";
        if (!match.secondHalfStartedAt) match.secondHalfStartedAt = now;
        await notifyMatchSecondHalfLive(match);
      } else {
        match.period = "first_half";
        match.timerStatus = "running";
        match.timerStartedAt = now;
        match.elapsedSeconds = 0;
        match.status = "live";
        if (!match.startedAt) match.startedAt = now;
        if (!match.firstHalfStartedAt) match.firstHalfStartedAt = now;
      }
      break;

    case "PAUSE":
      match.timerStatus = "paused";
      match.timerStartedAt = null;
      match.elapsedSeconds = elapsed;
      break;

    case "RESUME":
      if (match.status === "half_time") {
        match.period = "second_half";
        match.timerStatus = "running";
        match.timerStartedAt = now;
        match.elapsedSeconds = 0;
        match.status = "live";
        if (!match.secondHalfStartedAt) match.secondHalfStartedAt = now;
        await notifyMatchSecondHalfLive(match);
      } else {
        match.timerStatus = "running";
        match.timerStartedAt = now;
        match.elapsedSeconds = elapsed;
        match.status = "live";
      }
      break;

    case "FINISH":
      match.timerStatus = "finished";
      match.timerStartedAt = null;
      match.elapsedSeconds = elapsed;
      match.status = "finished";
      if (!match.finishedAt) {
        match.finishedAt = now;
      }
      break;

    default:
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid timer action. Valid actions: START, PAUSE, RESUME, FINISH",
      );
  }

  await match.save();

  if (action === "FINISH") {
    await processMatchCompletion(match);
  }

  // Calculate live current elapsed for instant response & socket emit
  let liveSeconds = match.elapsedSeconds || 0;
  if (match.timerStatus === "running" && match.timerStartedAt) {
    const diff = Math.floor(
      (Date.now() - new Date(match.timerStartedAt).getTime()) / 1000,
    );
    if (diff > 0) liveSeconds += diff;
  }

  // 📡 Socket broadcast
  const io = socketService.io;
  if (io) {
    io.emit(`match_${matchId}_timer`, {
      matchId,
      action,
      timerStatus: match.timerStatus,
      elapsedSeconds: match.elapsedSeconds,
      currentElapsedSeconds: liveSeconds,
      currentElapsedMinutes: Math.floor(liveSeconds / 60),
      timerStartedAt: match.timerStartedAt,
      status: match.status,
      durationMinutes: match.durationMinutes,
    });
  }

  await emitMatchUpdate(matchId);

  const formatted = await formatMatchVenue(match);
  return {
    ...formatted,
    currentElapsedSeconds: liveSeconds,
    currentElapsedMinutes: Math.floor(liveSeconds / 60),
  };
};

const modifyMatchScoreInDB = async (
  id: string,
  payload: {
    homeScore: number;
    awayScore: number;
    manOfTheMatch?: string | null;
    goalScorers?: Array<{
      _id?: string;
      team: string;
      player: string;
      assistPlayer?: string;
      goalType?: 'normal' | 'penalty' | 'header' | 'own_goal' | 'free_kick';
      minute?: number;
    }>;
  },
) => {
  const match = await Match.findById(id);

  if (!match) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");
  }

  if (payload.homeScore === undefined || payload.awayScore === undefined) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Both homeScore and awayScore must be provided",
    );
  }

  const oldHomeScore = match.homeScore ?? 0;
  const oldAwayScore = match.awayScore ?? 0;
  const newHomeScore = Number(payload.homeScore);
  const newAwayScore = Number(payload.awayScore);

  let newWinnerTeam = null;
  if (newHomeScore > newAwayScore) {
    newWinnerTeam = match.homeTeam;
  } else if (newAwayScore > newHomeScore) {
    newWinnerTeam = match.awayTeam;
  }

  // If the match is already finished and score actually changed, adjust team coins & market value rewards
  if (match.status === "finished" && (oldHomeScore !== newHomeScore || oldAwayScore !== newAwayScore)) {
    const ce = await ClubEconomy.findOne();
    const drawCoin = Number(ce?.drawMatch?.coin) || 2000;
    const drawMV = Number(ce?.drawMatch?.budgetValue) || (drawCoin * 10);
    const winCoin = Number(ce?.winMatch?.coin) || 5000;
    const winMV = Number(ce?.winMatch?.budgetValue) || (winCoin * 10);

    // Rollback old coin/MV allocations
    if (oldHomeScore === oldAwayScore) {
      if (match.homeTeam) await rollbackClubCoinsSafely(match._id, match.homeTeam, drawCoin, drawMV);
      if (match.awayTeam) await rollbackClubCoinsSafely(match._id, match.awayTeam, drawCoin, drawMV);
    } else {
      const oldWinner = oldHomeScore > oldAwayScore ? match.homeTeam : match.awayTeam;
      if (oldWinner) await rollbackClubCoinsSafely(match._id, oldWinner, winCoin, winMV);
    }

    // Apply new coin/MV allocations
    if (newHomeScore === newAwayScore) {
      if (match.homeTeam)
        await awardClubCoinsSafely(
          match._id,
          match.homeTeam,
          drawCoin,
          drawMV,
          undefined,
          TEAM_COIN_CATEGORY.DRAW_MATCH,
          "Match Draw Reward",
          "Earned coins for drawing the match (Score update)"
        );
      if (match.awayTeam)
        await awardClubCoinsSafely(
          match._id,
          match.awayTeam,
          drawCoin,
          drawMV,
          undefined,
          TEAM_COIN_CATEGORY.DRAW_MATCH,
          "Match Draw Reward",
          "Earned coins for drawing the match (Score update)"
        );
    } else if (newWinnerTeam) {
      await awardClubCoinsSafely(
        match._id,
        newWinnerTeam,
        winCoin,
        winMV,
        undefined,
        TEAM_COIN_CATEGORY.WIN_MATCH,
        "Match Victory Reward",
        "Earned coins for winning the match (Score update)"
      );
    }
  }

  // Resolve match teams for opponent name and fixture descriptions in coin transactions
  let homeTeamName = "Home Team";
  let awayTeamName = "Away Team";
  let homeIdStr = match.homeTeam ? (match.homeTeam._id || match.homeTeam).toString() : "";
  let awayIdStr = match.awayTeam ? (match.awayTeam._id || match.awayTeam).toString() : "";

  try {
    const populatedMatch = await Match.findById(id)
      .populate("homeTeam", "teamName shortName")
      .populate("awayTeam", "teamName shortName")
      .lean();
    if (populatedMatch) {
      homeTeamName = (populatedMatch.homeTeam as any)?.teamName || (populatedMatch.homeTeam as any)?.shortName || "Home Team";
      awayTeamName = (populatedMatch.awayTeam as any)?.teamName || (populatedMatch.awayTeam as any)?.shortName || "Away Team";
      homeIdStr = (populatedMatch.homeTeam as any)?._id?.toString() || homeIdStr;
      awayIdStr = (populatedMatch.awayTeam as any)?._id?.toString() || awayIdStr;
    }
  } catch (e) {
    // fallback safely
  }

  const fixtureStr = `${homeTeamName} vs ${awayTeamName}`;
  const getOpponentForTeam = (teamId?: any) => {
    const tStr = teamId ? (teamId._id || teamId).toString() : "";
    if (tStr === homeIdStr) return awayTeamName;
    if (tStr === awayIdStr) return homeTeamName;
    return "";
  };

  // Handle assigned goal scorers for player stats, coins & notifications
  if (Array.isArray(payload.goalScorers)) {
    const pe = await PlayerEconomy.findOne();
    const goalCoin = pe?.goal?.coin ?? 0;
    const goalMV = pe?.goal?.marketValue ?? 0;
    const assistCoin = pe?.assist?.coin ?? 0;
    const assistMV = pe?.assist?.marketValue ?? 0;
    const minFloorMV = Number(pe?.startingMarketValue) || 10000000;

    // 1. Fetch all existing goal records for this match
    const existingGoals = await MatchResult.find({
      match: match._id,
      eventType: "goal",
    });

    const unmatchedExisting = [...existingGoals];
    const newGoalsToAdd: Array<{
      _id?: string;
      team: string;
      player: string;
      assistPlayer?: string;
      goalType?: 'normal' | 'penalty' | 'header' | 'own_goal' | 'free_kick';
      minute?: number;
    }> = [];

    // 2. Reconcile incoming goals against existing goals
    for (const incoming of payload.goalScorers) {
      if (!incoming.player || !incoming.team) continue;

      let matchedIndex = -1;

      // Match by explicit _id if provided
      if (incoming._id) {
        matchedIndex = unmatchedExisting.findIndex(
          (eg) => String(eg._id) === String(incoming._id),
        );
      }

      // If not matched by _id, match by content (player + team + minute)
      if (matchedIndex === -1) {
        matchedIndex = unmatchedExisting.findIndex(
          (eg) =>
            String(eg.player) === String(incoming.player) &&
            String(eg.team) === String(incoming.team) &&
            Number(eg.minute) === (Number(incoming.minute) || 1),
        );
      }

      if (matchedIndex !== -1) {
        // Goal already exists in DB!
        const [existingMatchGoal] = unmatchedExisting.splice(matchedIndex, 1);

        const targetMin = Number(incoming.minute) || 1;
        const targetType = incoming.goalType || "normal";
        const oldPlayer = existingMatchGoal.player ? String(existingMatchGoal.player) : "";
        const newPlayer = incoming.player ? String(incoming.player) : "";
        const oldAssist = existingMatchGoal.eventMeta?.assist ? String(existingMatchGoal.eventMeta.assist) : "";
        const newAssist = incoming.assistPlayer ? String(incoming.assistPlayer) : "";

        let needsUpdate = false;

        // Check if goal scorer was changed by admin
        if (oldPlayer !== newPlayer) {
          if (oldPlayer) {
            await PlayerStats.findOneAndUpdate(
              { player: oldPlayer },
              { $inc: { goals: -1 } },
            );
            if (goalCoin > 0 || goalMV > 0) {
              const oldScorerUser = await User.findById(oldPlayer);
              if (oldScorerUser) {
                const isProOld = await isUserPremiumPlayer(oldPlayer);
                const minFloorCoin = getMinFloorCoin(pe, isProOld);
                const updatedCoin = Math.max(minFloorCoin, (oldScorerUser.engCoine ?? 0) - goalCoin);
                const updatedMV = Math.max(minFloorMV, (oldScorerUser.marketValue ?? 0) - goalMV);
                await User.findByIdAndUpdate(oldPlayer, {
                  $set: { engCoine: updatedCoin, marketValue: updatedMV },
                });
              }
            }
            await CoinTransaction.deleteMany({
              referenceId: existingMatchGoal._id.toString(),
              user: oldPlayer,
            });
          }
          if (newPlayer) {
            await PlayerStats.findOneAndUpdate(
              { player: newPlayer },
              { $inc: { goals: 1 }, $set: { team: incoming.team } },
              { upsert: true, new: true },
            );
            const oppName = getOpponentForTeam(incoming.team);
            const vsOpponent = oppName ? ` vs ${oppName}` : "";
            if (goalCoin > 0) {
              await recordCoinTransaction({
                userId: newPlayer,
                amount: goalCoin,
                category: COIN_TRANSACTION_CATEGORY.GOAL,
                title: "Goal Reward",
                description: `Scored a goal${vsOpponent} at minute ${targetMin}`,
                matchId: match._id,
                referenceId: existingMatchGoal._id.toString(),
              });
            }
          }
          existingMatchGoal.player = new mongoose.Types.ObjectId(newPlayer) as any;
          existingMatchGoal.team = new mongoose.Types.ObjectId(incoming.team) as any;
          needsUpdate = true;
        }

        if (existingMatchGoal.minute !== targetMin) {
          existingMatchGoal.minute = targetMin;
          needsUpdate = true;
        }
        if (!existingMatchGoal.eventMeta) {
          existingMatchGoal.eventMeta = {} as any;
        }
        if (existingMatchGoal.eventMeta && existingMatchGoal.eventMeta.goalType !== targetType) {
          existingMatchGoal.eventMeta.goalType = targetType;
          needsUpdate = true;
        }

        // Handle changed assist player if amended
        if (oldAssist !== newAssist) {
          if (oldAssist) {
            await PlayerStats.findOneAndUpdate(
              { player: oldAssist },
              { $inc: { assists: -1 } },
            );
            if (assistCoin > 0 || assistMV > 0) {
              const oldAssistUser = await User.findById(oldAssist);
              if (oldAssistUser) {
                const isProOld = await isUserPremiumPlayer(oldAssist);
                const minFloorCoin = getMinFloorCoin(pe, isProOld);
                const updatedCoin = Math.max(minFloorCoin, (oldAssistUser.engCoine ?? 0) - assistCoin);
                const updatedMV = Math.max(minFloorMV, (oldAssistUser.marketValue ?? 0) - assistMV);
                await User.findByIdAndUpdate(oldAssist, {
                  $set: { engCoine: updatedCoin, marketValue: updatedMV },
                });
              }
            }
            await CoinTransaction.deleteMany({
              referenceId: `${existingMatchGoal._id.toString()}_assist`,
              user: oldAssist,
            });
          }
          if (newAssist) {
            await PlayerStats.findOneAndUpdate(
              { player: newAssist },
              { $inc: { assists: 1 }, $set: { team: incoming.team } },
              { upsert: true, new: true },
            );
            const oppName = getOpponentForTeam(incoming.team);
            const vsOpponent = oppName ? ` vs ${oppName}` : "";
            if (assistCoin > 0) {
              await recordCoinTransaction({
                userId: newAssist,
                amount: assistCoin,
                category: COIN_TRANSACTION_CATEGORY.ASSIST,
                title: "Assist Reward",
                description: `Assisted a goal${vsOpponent} at minute ${targetMin}`,
                matchId: match._id,
                referenceId: `${existingMatchGoal._id.toString()}_assist`,
              });
            }
          }
          if (!existingMatchGoal.eventMeta) {
            existingMatchGoal.eventMeta = {} as any;
          }
          if (existingMatchGoal.eventMeta) {
            existingMatchGoal.eventMeta.assist = newAssist ? (new mongoose.Types.ObjectId(newAssist) as any) : undefined;
          }
          needsUpdate = true;
        }

        if (needsUpdate) {
          await existingMatchGoal.save();
        }
      } else {
        // This is a genuinely new goal added by the user
        newGoalsToAdd.push(incoming);
      }
    }

    // 3. Any goal remaining in unmatchedExisting was REMOVED/DELETED by the admin!
    for (const removedGoal of unmatchedExisting) {
      if (removedGoal.player) {
        await PlayerStats.findOneAndUpdate(
          { player: removedGoal.player },
          { $inc: { goals: -1 } },
        );
        if (goalCoin > 0 || goalMV > 0) {
          const scorerUser = await User.findById(removedGoal.player);
          if (scorerUser) {
            const isProScorer = await isUserPremiumPlayer(removedGoal.player);
            const minFloorCoin = getMinFloorCoin(pe, isProScorer);
            const updatedCoin = Math.max(minFloorCoin, (scorerUser.engCoine ?? 0) - goalCoin);
            const updatedMV = Math.max(minFloorMV, (scorerUser.marketValue ?? 0) - goalMV);
            await User.findByIdAndUpdate(removedGoal.player, {
              $set: { engCoine: updatedCoin, marketValue: updatedMV },
            });
          }
        }
      }

      // Rollback assist stats if this goal had an assist
      if (removedGoal.eventMeta?.assist) {
        const assistPlayerId = String(removedGoal.eventMeta.assist);
        await PlayerStats.findOneAndUpdate(
          { player: assistPlayerId },
          { $inc: { assists: -1 } },
        );
        if (assistCoin > 0 || assistMV > 0) {
          const assistUser = await User.findById(assistPlayerId);
          if (assistUser) {
            const isProAssist = await isUserPremiumPlayer(assistPlayerId);
            const minFloorCoin = getMinFloorCoin(pe, isProAssist);
            const updatedCoin = Math.max(minFloorCoin, (assistUser.engCoine ?? 0) - assistCoin);
            const updatedMV = Math.max(minFloorMV, (assistUser.marketValue ?? 0) - assistMV);
            await User.findByIdAndUpdate(assistPlayerId, {
              $set: { engCoine: updatedCoin, marketValue: updatedMV },
            });
          }
        }
      }

      // Delete associated CoinTransactions for this removed goal
      await CoinTransaction.deleteMany({
        $or: [
          { referenceId: removedGoal._id.toString() },
          { referenceId: `${removedGoal._id.toString()}_assist` },
        ],
      });

      // Permanently remove the MatchResult document
      await MatchResult.findByIdAndDelete(removedGoal._id);
    }

    // 4. Create and credit only the genuinely new goals
    for (const scorer of newGoalsToAdd) {
      if (scorer.player && scorer.team) {
        const min = Number(scorer.minute) || 1;

        const newGoalDoc = await MatchResult.create({
          match: match._id,
          league: match.league || undefined,
          team: scorer.team,
          player: scorer.player,
          eventType: "goal",
          minute: min,
          addedBy: scorer.player,
          eventMeta: {
            goalType: scorer.goalType || "normal",
            ...(scorer.assistPlayer ? { assist: scorer.assistPlayer } : {}),
          },
        });

        await PlayerStats.findOneAndUpdate(
          { player: scorer.player },
          { $inc: { goals: 1 }, $set: { team: scorer.team } },
          { upsert: true, new: true },
        );

        const oppName = getOpponentForTeam(scorer.team);
        const vsOpponent = oppName ? ` vs ${oppName}` : "";

        if (goalCoin > 0) {
          await recordCoinTransaction({
            userId: scorer.player,
            amount: goalCoin,
            category: COIN_TRANSACTION_CATEGORY.GOAL,
            title: "Goal Reward",
            description: `Scored a goal${vsOpponent} at minute ${min}`,
            matchId: match._id,
            referenceId: newGoalDoc._id.toString(),
          });
        }

        if (scorer.assistPlayer) {
          await PlayerStats.findOneAndUpdate(
            { player: scorer.assistPlayer },
            { $inc: { assists: 1 }, $set: { team: scorer.team } },
            { upsert: true, new: true },
          );

          if (assistCoin > 0) {
            await recordCoinTransaction({
              userId: scorer.assistPlayer,
              amount: assistCoin,
              category: COIN_TRANSACTION_CATEGORY.ASSIST,
              title: "Assist Reward",
              description: `Assisted a goal${vsOpponent} at minute ${min}`,
              matchId: match._id,
              referenceId: `${newGoalDoc._id.toString()}_assist`,
            });
          }
        }

        // Send notifications only for new goals
        try {
          await NotificationQueueHelper.sendNotification(
            String(scorer.player),
            `Congratulations! You scored a goal at minute ${min}.`,
            "Goal Scored",
            NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED,
          );
          if (scorer.assistPlayer) {
            await NotificationQueueHelper.sendNotification(
              String(scorer.assistPlayer),
              `Well done! You assisted a goal at minute ${min}.`,
              "Assist Recorded",
              NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED,
            );
          }

          // If scorer has a parent account registered, notify parent
          try {
            const scorerUser = await User.findById(scorer.player).select("parentId firstName lastName userName").lean();
            if (scorerUser?.parentId) {
              const childName = (scorerUser.firstName ? `${scorerUser.firstName} ${scorerUser.lastName || ""}` : scorerUser.userName).trim();
              await NotificationQueueHelper.sendNotification(
                String(scorerUser.parentId),
                `Congratulations! Your child ${childName} scored a goal at minute ${min}!`,
                "Goal Scored",
                NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED,
              );
            }
          } catch (pErr) {
            // safe ignore
          }

          // Broadcast goal to all team subscribers (Bell Icon subscribers)
          if (scorer.team) {
            const scoringTeamDoc = await Team.findById(scorer.team).select("teamName").lean();
            const playerDoc = await User.findById(scorer.player).select("firstName lastName userName").lean();
            const pName = playerDoc
              ? (playerDoc.firstName ? `${playerDoc.firstName} ${playerDoc.lastName || ""}`.trim() : playerDoc.userName)
              : "A player";
            const tName = scoringTeamDoc?.teamName || "Team";

            await NotificationQueueHelper.notifyTeamSubscribers(
              String(scorer.team),
              `Goal: ${tName}`,
              `${pName} scored for ${tName} at minute ${min}!`,
              "PLAYER_ACTION",
              match._id.toString(),
              "Match",
              {
                playerId: String(scorer.player),
                matchId: match._id.toString(),
                eventType: "goal",
                minute: String(min),
              }
            );
          }
        } catch (err) {
          console.error("Failed to send goal notification", err);
        }
      }
    }
  }

  // 5. Player of the Day / Man of the Match handling (Strictly ONE per match)
  if (payload.manOfTheMatch !== undefined) {
    const targetMOTM = payload.manOfTheMatch ? String(payload.manOfTheMatch) : "";
    const evaluation = await MatchEvaluation.findOne({ match: match._id });

    // Check existing MOTMs for this match across MatchEvaluation, MatchResult, and match document
    const currentMOTMIds = new Set<string>();
    if (evaluation?.manOfTheMatch) {
      currentMOTMIds.add(String(evaluation.manOfTheMatch));
    }
    if (match.manOfTheMatch) {
      currentMOTMIds.add(String(match.manOfTheMatch));
    }

    const potdMatchResults = await MatchResult.find({
      match: match._id,
      eventType: { $in: ["player_of_the_day", "man_of_the_match"] },
    });
    for (const mr of potdMatchResults) {
      if (mr.player) currentMOTMIds.add(String(mr.player));
    }

    const pe = await PlayerEconomy.findOne();
    const potdCoin = pe?.playerOfTheDay?.coin ?? 0;
    const potdMV = pe?.playerOfTheDay?.marketValue ?? (potdCoin * (pe?.conversionRate ?? 10));
    const minFloorMV = Number(pe?.startingMarketValue) || 10000000;

    // Rollback any previous MOTM player(s) that are NOT the targetMOTM
    for (const oldMOTM of currentMOTMIds) {
      if (oldMOTM !== targetMOTM) {
        await PlayerStats.findOneAndUpdate(
          { player: oldMOTM },
          { $inc: { playerOfTheDay: -1 } },
        );
        if (potdCoin > 0) {
          const isProOld = await isUserPremiumPlayer(oldMOTM);
          if (isProOld) {
            await recordCoinTransaction({
              userId: oldMOTM,
              amount: -potdCoin,
              category: COIN_TRANSACTION_CATEGORY.ROLLBACK,
              title: "Player of the Day Revoked",
              description: `Player of the Day award was reassigned${fixtureStr ? ` in ${fixtureStr}` : ""}`,
              matchId: match._id,
              referenceId: `${match._id.toString()}_motm_revoked`,
            });
          }
        }
        await CoinTransaction.deleteMany({
          match: match._id,
          user: oldMOTM,
          category: COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
        });
      }
    }

    // Clean up any rogue MatchResult MOTM events for this match
    if (potdMatchResults.length > 0) {
      await MatchResult.deleteMany({
        match: match._id,
        eventType: { $in: ["player_of_the_day", "man_of_the_match"] },
      });
    }

    // Award new MOTM (only if targetMOTM was not already awarded)
    const wasAlreadyMOTM = currentMOTMIds.has(targetMOTM);
    if (targetMOTM && !wasAlreadyMOTM) {
      await PlayerStats.findOneAndUpdate(
        { player: targetMOTM },
        { $inc: { playerOfTheDay: 1 } },
        { upsert: true, new: true },
      );

      let motmOpponent = "";
      try {
        const motmUser = await User.findById(targetMOTM).select("selectTeam").lean();
        if (motmUser?.selectTeam) {
          motmOpponent = getOpponentForTeam(motmUser.selectTeam);
        }
      } catch (e) {}

      const vsMotm = motmOpponent ? ` vs ${motmOpponent}` : (fixtureStr ? ` in ${fixtureStr}` : " in match");

      if (potdCoin > 0) {
        const alreadyAwarded = await CoinTransaction.findOne({
          match: match._id,
          user: targetMOTM,
          category: COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
        }).lean();

        if (!alreadyAwarded) {
          await recordCoinTransaction({
            userId: targetMOTM,
            amount: potdCoin,
            category: COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
            title: "Player of the Day Bonus",
            description: `Player of the Day reward${vsMotm}`,
            matchId: match._id,
            referenceId: `${match._id.toString()}_motm`,
          });
        }
      }
    }

    // Update or create MatchEvaluation safely
    if (evaluation) {
      evaluation.manOfTheMatch = targetMOTM ? (new mongoose.Types.ObjectId(targetMOTM) as any) : null;
      if (!evaluation.homeTeam && match.homeTeam) evaluation.homeTeam = match.homeTeam as any;
      if (!evaluation.awayTeam && match.awayTeam) evaluation.awayTeam = match.awayTeam as any;
      await evaluation.save();
    } else if (targetMOTM) {
      await MatchEvaluation.create({
        match: match._id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        homeTeamRating: 0,
        awayTeamRating: 0,
        manOfTheMatch: new mongoose.Types.ObjectId(targetMOTM),
      });
    }

    match.manOfTheMatch = targetMOTM ? (new mongoose.Types.ObjectId(targetMOTM) as any) : null;
  }

  match.homeScore = newHomeScore;
  match.awayScore = newAwayScore;
  match.winnerTeam = newWinnerTeam as any;

  await match.save();

  // If match was already finished, re-evaluate clean sheets based on score change
  if (match.status === "finished") {
    try {
      if (oldAwayScore === 0 && newAwayScore > 0 && match.homeTeam) {
        await revokeMatchCleanSheets(match._id, match.homeTeam);
      }
      if (oldHomeScore === 0 && newHomeScore > 0 && match.awayTeam) {
        await revokeMatchCleanSheets(match._id, match.awayTeam);
      }
      if (newAwayScore === 0 || newHomeScore === 0) {
        await awardMatchCleanSheets(match._id);
      }
    } catch (csErr) {
      console.error("Failed to re-evaluate clean sheets on score change:", csErr);
    }
  }

  await emitMatchUpdate(match._id.toString());

  return await formatMatchVenue(match);
};

export async function emitMatchUpdate(matchId: string) {
  try {
    const match = await Match.findById(matchId)
      .populate("league")
      .populate("homeTeam")
      .populate("awayTeam")
      .populate("referee")
      .populate("winnerTeam")
      .populate("venueCategory", "name")
      .populate("venueSubCategory", "name");

    if (!match) return;

    const formatted = await formatMatchVenue(match);

    const io = socketService.io;
    if (io) {
      // 1. Emit deep populated match object to the specific match room
      io.to(`match_${matchId}`).emit("match_update", formatted);

      // 2. Emit lightweight payload to the global list channel
      const lightweightPayload = {
        _id: formatted._id,
        homeScore: formatted.homeScore,
        awayScore: formatted.awayScore,
        status: formatted.status,
        period: formatted.period,
        elapsedSeconds: formatted.elapsedSeconds,
        currentElapsedSeconds: formatted.currentElapsedSeconds,
        currentElapsedMinutes: formatted.currentElapsedMinutes,
        timerStatus: formatted.timerStatus,
        timerStartedAt: formatted.timerStartedAt,
      };
      io.emit("matches_list_update", lightweightPayload);
    }
  } catch (error) {
    console.error("Failed to emit match update:", error);
  }
};

const getMatchScheduleDatesFromDB = async (query: Record<string, any>) => {
  const { league, leagueId, status, unplayedOnly, team, teamId } = query;
  const matchFilter: any = {
    matchDate: { $exists: true, $ne: null },
  };

  // League Filter
  const targetLeague = leagueId || league;
  if (
    targetLeague &&
    targetLeague !== "ALL" &&
    targetLeague !== "null" &&
    targetLeague !== "undefined"
  ) {
    if (mongoose.Types.ObjectId.isValid(targetLeague)) {
      const objId = new mongoose.Types.ObjectId(targetLeague);
      const matchingLeagueTeams = await LeagueTeam.find({
        $or: [{ league: objId }, { _id: objId }],
      }).select("_id league team");

      const leagueTeamIds = matchingLeagueTeams.map((lt) => lt._id);
      const directLeagueIds = matchingLeagueTeams.map((lt) => lt.league);
      const teamIdsInLeague = matchingLeagueTeams
        .map((lt) => lt.team)
        .filter(Boolean);

      const idStrings = Array.from(
        new Set(
          [
            objId.toString(),
            ...leagueTeamIds.map((id) => id.toString()),
            ...directLeagueIds.map((id) => id?.toString()),
          ].filter(Boolean),
        ),
      );

      const targetLeagueIds = [
        ...idStrings.map((idStr) => new mongoose.Types.ObjectId(idStr as string)),
        ...idStrings,
      ];

      const allTeamIdRefs = [
        ...teamIdsInLeague,
        ...teamIdsInLeague.map((id) => id.toString()),
      ];

      matchFilter.$or = [
        { league: { $in: targetLeagueIds } },
        ...(allTeamIdRefs.length > 0 ? [{ homeTeam: { $in: allTeamIdRefs } }] : []),
        ...(allTeamIdRefs.length > 0 ? [{ awayTeam: { $in: allTeamIdRefs } }] : []),
      ];
    }
  }

  // Team Filter
  const targetTeam = teamId || team;
  if (
    targetTeam &&
    targetTeam !== "ALL" &&
    targetTeam !== "null" &&
    targetTeam !== "undefined"
  ) {
    if (mongoose.Types.ObjectId.isValid(targetTeam)) {
      const teamObj = new mongoose.Types.ObjectId(targetTeam);
      const teamFilterCondition = [
        { homeTeam: teamObj },
        { awayTeam: teamObj },
        { homeTeam: targetTeam.toString() },
        { awayTeam: targetTeam.toString() },
      ];
      if (matchFilter.$or) {
        matchFilter.$and = [
          { $or: matchFilter.$or },
          { $or: teamFilterCondition },
        ];
        delete matchFilter.$or;
      } else {
        matchFilter.$or = teamFilterCondition;
      }
    }
  }

  // Status Filter
  if (status && status !== "ALL") {
    const lowerStatus = (status as string).toLowerCase();
    if (lowerStatus === "upcoming" || lowerStatus === "scheduled") {
      matchFilter.status = { $ne: "finished" };
    } else {
      matchFilter.status = { $regex: new RegExp(`^${lowerStatus}$`, "i") };
    }
  }

  if (unplayedOnly === "true" || unplayedOnly === true) {
    matchFilter.status = { $ne: "finished" };
  }

  const rawDates = await Match.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$matchDate",
            timezone: "Europe/London",
          },
        },
        matchCount: { $sum: 1 },
        sampleDate: { $first: "$matchDate" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const formattedDates = rawDates
    .filter((item) => item._id && item._id.trim() !== "")
    .map((item) => {
      const ukDate = dayjs(item.sampleDate).tz("Europe/London");
      const dayLabel = ukDate.format("ddd DD/MM/YY"); // e.g. "Fri 05/09/25"
      return {
        date: item._id, // "2025-09-05"
        label: `${dayLabel} [${item.matchCount}]`,
        matchCount: item.matchCount,
      };
    });

  return formattedDates;
};

const getMatchFeedbackSettingFromDB = async () => {
  return await getEffectiveMatchSetting();
};

const updateMatchFeedbackSettingInDB = async (payload: Partial<IMatchSetting>) => {
  const setting = (await getEffectiveMatchSetting()) as any;
  if (payload.feedbackWindowHours !== undefined) {
    setting.feedbackWindowHours = Math.max(0, Number(payload.feedbackWindowHours));
  }
  if (payload.isFeedbackWindowRestricted !== undefined) {
    setting.isFeedbackWindowRestricted = Boolean(payload.isFeedbackWindowRestricted);
  }
  if (payload.timezone !== undefined) {
    setting.timezone = String(payload.timezone).trim() || "Europe/London";
  }
  await setting.save();
  return setting;
};

const getMatchCleanSheetsFromDB = async (matchId: string) => {
  const cleanSheets = await MatchResult.find({
    match: matchId,
    eventType: "clean_sheet",
  })
    .populate("player", "_id firstName lastName position profile image userName")
    .populate("team", "_id teamName shortName teamLogo")
    .lean();
  return cleanSheets;
};

const manualAwardCleanSheetInDB = async (
  matchId: string,
  playerId: string,
  adminId: string,
  reason?: string
) => {
  return await manualAwardCleanSheet(matchId, playerId, adminId, reason);
};

const manualRevokeCleanSheetInDB = async (
  matchId: string,
  playerId: string,
  adminId: string,
  reason?: string
) => {
  return await manualRevokeCleanSheet(matchId, playerId, adminId, reason);
};

const getMatchOverviewFromDB = async () => {
  const [total, upcoming, live, halfTime, finished, cancelled] = await Promise.all([
    Match.countDocuments(),
    Match.countDocuments({ status: { $in: ["upcoming", "scheduled"] } }),
    Match.countDocuments({ status: "live" }),
    Match.countDocuments({ status: "half_time" }),
    Match.countDocuments({ status: "finished" }),
    Match.countDocuments({ status: "cancelled" }),
  ]);

  return {
    totalMatches: total,
    upcomingMatches: upcoming,
    liveMatches: live + halfTime,
    finishedMatches: finished,
    cancelledMatches: cancelled,
  };
};

export const MatchService = {
  createMatchToDB,
  getAllMatchesFromDB,
  getSingleMatchFromDB,
  updateMatchToDB,
  deleteMatchFromDB,
  toggleMatchStatusToDB,
  updateMatchStatusInDB,
  getMatchesByRefereeFromDB,
  addMatchReviewToDB,
  getUpcomingMatchesForManagerFromDB,
  updateMatchTimerInDB,
  modifyMatchScoreInDB,
  getMatchScheduleDatesFromDB,
  getMatchFeedbackSettingFromDB,
  updateMatchFeedbackSettingInDB,
  getMatchCleanSheetsFromDB,
  manualAwardCleanSheetInDB,
  manualRevokeCleanSheetInDB,
  getMatchOverviewFromDB,
};
