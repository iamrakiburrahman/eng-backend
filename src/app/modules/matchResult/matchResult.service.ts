import { MatchResult } from "./matchResult.model";
import { PlayerStats } from "../playerStats/playerStats.model";

import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { Match } from "../match/match.model";
import { Team } from "../team/team.model";
import { User } from "../user/user.model";
import { League } from "../league/league.model";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";
import { ClubEconomy } from "../coinAndBudget/clubEconomySchema.model";
import { NotificationQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";
import { emitMatchUpdate, getMinFloorCoin } from "../match/match.service";
import { isUserPremiumPlayer } from "../../../helpers/packageHelper";
import { MatchEvaluation } from "../refereeRating/refereeRating.model";
import { recordCoinTransaction } from "../../../helpers/coinLedgerHelper";
import { CoinTransaction } from "../coinTransaction/coinTransaction.model";
import { COIN_TRANSACTION_CATEGORY } from "../coinTransaction/coinTransaction.interface";
import mongoose from "mongoose";

// ========================== CREATE ==========================
const createMatchResultToDB = async (payload: any) => {
  if (payload.league === "" || !payload.league) {
    delete payload.league;
  }
  const { league, match, team, player, eventType, minute } = payload;

  // . VALIDATE MATCH
  const matchData = await Match.findById(match);
  if (!matchData) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");
  }

  // . VALIDATE LEAGUE
  if (matchData.matchType === "league" && matchData.league) {
    if (String(matchData.league) !== String(league)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "League mismatch for this match",
      );
    }
  }

  // . VALIDATE TEAM IN MATCH
  let eventTeam = team;
  if (!eventTeam && player) {
    const playerUser = await User.findById(player).select("selectTeam").lean();
    if (playerUser?.selectTeam) {
      eventTeam = (playerUser.selectTeam._id || playerUser.selectTeam).toString();
      payload.team = eventTeam;
    }
  }

  const isTeamValid =
    String(matchData.homeTeam) === String(eventTeam) ||
    String(matchData.awayTeam) === String(eventTeam);

  if (!isTeamValid) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Team is not part of this match",
    );
  }

  // . CHECK MATCH STATUS (Admins have master override to record/adjust match events anytime)
  if (!payload.isAdmin && matchData.status !== "live" && matchData.status !== "half_time") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Match is not running");
  }

  // . TIME VALIDATION
  const now = new Date();
  const matchStart = new Date(matchData.matchDate);

  const matchEndPlusExtra = new Date(matchStart);
  matchEndPlusExtra.setHours(matchEndPlusExtra.getHours() + 2);

  // if (now > matchEndPlusExtra) {
  //   throw new ApiError(
  //     StatusCodes.BAD_REQUEST,
  //     "Match time expired, cannot update score",
  //   );
  // }

  // Dynamic minute calculation if missing (e.g. referee live panel event)
  let eventMinute = minute;
  if (
    eventMinute === undefined ||
    eventMinute === null ||
    eventMinute === "" ||
    isNaN(Number(eventMinute)) ||
    Number(eventMinute) <= 0
  ) {
    let liveSeconds = matchData.elapsedSeconds || 0;
    if (matchData.timerStatus === "running" && matchData.timerStartedAt) {
      const diff = Math.floor(
        (Date.now() - new Date(matchData.timerStartedAt).getTime()) / 1000,
      );
      if (diff > 0) liveSeconds += diff;
    }
    const calculatedMinute = Math.floor(liveSeconds / 60);
    eventMinute = calculatedMinute || 1;
    payload.minute = eventMinute;
  } else {
    eventMinute = Number(eventMinute);
    payload.minute = eventMinute;
  }

  // . MINUTE VALIDATION
  if (eventMinute < 0 || eventMinute > 120) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid match minute");
  }

  // 6.. RAPID DUPLICATE GUARD (prevent accidental double tap / network retry duplicates)
  if (eventType === "goal" && player) {
    const recentDuplicate = await MatchResult.findOne({
      match,
      player,
      team,
      eventType: "goal",
      createdAt: { $gte: new Date(Date.now() - 15000) },
    });
    if (recentDuplicate) {
      return recentDuplicate;
    }
  }

  // 6.. STRICT SINGLE MAN OF THE MATCH / PLAYER OF THE DAY GUARD
  if (eventType === "player_of_the_day" || eventType === "man_of_the_match") {
    const existingPOTD = await MatchResult.findOne({
      match,
      eventType: { $in: ["player_of_the_day", "man_of_the_match"] },
    });

    if (existingPOTD) {
      if (String(existingPOTD.player) === String(player)) {
        return existingPOTD; // Same player already awarded MOTM for this match
      }
      // If changing to a new player, rollback previous player first so only 1 player has MOTM
      await rollbackPlayerStats(existingPOTD);
      await MatchResult.findByIdAndDelete(existingPOTD._id);
    }

    const evaluation = await MatchEvaluation.findOne({ match });
    if (evaluation) {
      if (evaluation.manOfTheMatch && String(evaluation.manOfTheMatch) !== String(player)) {
        const oldMOTM = String(evaluation.manOfTheMatch);
        const peOld = await PlayerEconomy.findOne();
        const potdCoinOld = peOld?.playerOfTheDay?.coin ?? 0;
        const potdMVOld = peOld?.playerOfTheDay?.marketValue ?? (potdCoinOld * (peOld?.conversionRate ?? 10));
        const minFloorMV = Number(peOld?.startingMarketValue) || 10000000;
        await PlayerStats.findOneAndUpdate(
          { player: oldMOTM },
          { $inc: { playerOfTheDay: -1 } },
        );
        if (potdCoinOld > 0 || potdMVOld > 0) {
          const oldUser = await User.findById(oldMOTM);
          if (oldUser) {
            const isProOld = await isUserPremiumPlayer(oldMOTM);
            const minFloorCoin = getMinFloorCoin(peOld, isProOld);
            await User.findByIdAndUpdate(oldMOTM, {
              $set: {
                engCoine: Math.max(minFloorCoin, (oldUser.engCoine ?? 0) - potdCoinOld),
                marketValue: Math.max(minFloorMV, (oldUser.marketValue ?? 0) - potdMVOld),
              },
            });
          }
        }
      }
      evaluation.manOfTheMatch = (player ? new mongoose.Types.ObjectId(player) : null) as any;
      await evaluation.save();
    }
    await Match.findByIdAndUpdate(match, {
      $set: { manOfTheMatch: player ? new mongoose.Types.ObjectId(player) : null },
    });
  }

  // 6.. AUTO-POPULATE REQUIRED EVENT META
  if (!payload.eventMeta) {
    payload.eventMeta = {};
  }
  if (eventType === "yellow_card" && !payload.eventMeta.cardType) {
    payload.eventMeta.cardType = "yellow";
  }
  if (eventType === "red_card" && !payload.eventMeta.cardType) {
    payload.eventMeta.cardType = "red";
  }
  if (eventType === "goal" && !payload.eventMeta.goalType) {
    payload.eventMeta.goalType = "normal";
  }
  if (eventType === "substitution" && !payload.eventMeta.substitutionType) {
    payload.eventMeta.substitutionType = "in";
  }

  // . CREATE EVENT
  const result = await MatchResult.create(payload);

  // 8. UPDATE MATCH SCORE
  await applyMatchScore(payload);

  // 9. UPDATE PLAYER STATS
  await applyPlayerStats(result);

  // 10. UPDATE WINNER
  await updateMatchWinner(match);

  // 11. SEND QUEUED NOTIFICATIONS TO PLAYERS & TEAM SUBSCRIBERS
  try {
    const eventMeta = payload.eventMeta;
    const resolvedMinute = payload.minute ?? eventMinute ?? minute ?? 1;
    const resolvedTeam = team || payload.team || eventTeam;

    if (player) {
      let title = "Match Event Update";
      let message = `A new event occurred at minute ${resolvedMinute}.`;

      if (eventType === "goal") {
        if (eventMeta?.goalType === "own_goal") {
          title = "Own Goal";
          message = `An own goal was recorded at minute ${resolvedMinute}.`;
        } else {
          title = "Goal Scored";
          message = `Congratulations! You scored a goal at minute ${resolvedMinute}.`;
        }
      } else if (eventType === "assist") {
        title = "Assist Recorded";
        message = `Well done! You assisted a goal at minute ${resolvedMinute}.`;
      } else if (eventType === "yellow_card") {
        title = "Yellow Card Issued";
        message = `You received a yellow card at minute ${resolvedMinute}.`;
      } else if (eventType === "red_card") {
        title = "Red Card Issued";
        message = `You received a red card at minute ${resolvedMinute}.`;
      } else if (eventType === "substitution") {
        if (eventMeta?.substitutionType === "in") {
          title = "Subbed In";
          message = `You were substituted in at minute ${resolvedMinute}.`;
        } else if (eventMeta?.substitutionType === "out") {
          title = "Subbed Out";
          message = `You were substituted out at minute ${resolvedMinute}.`;
        }
      } else if (eventType === "clean_sheet") {
        title = "Clean Sheet Recorded";
        message = `A clean sheet was recorded for you at minute ${resolvedMinute}.`;
      } else if (eventType === "player_of_the_day") {
        title = "Player of the Day";
        message = `Congratulations! You have been named Player of the Day for this match.`;
      } else if (eventType === "foul") {
        title = "Foul Recorded";
        message = `A foul was recorded for you at minute ${resolvedMinute}.`;
      }

      await NotificationQueueHelper.sendNotification(
        String(player),
        message,
        title,
        NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED
      );

      // Also notify registered parent if player has a parent account linked
      try {
        const playerWithParent = await User.findById(player).select("parentId firstName lastName userName").lean();
        if (playerWithParent?.parentId) {
          const childName = (playerWithParent.firstName ? `${playerWithParent.firstName} ${playerWithParent.lastName || ""}` : playerWithParent.userName).trim();
          let parentMsg = `Your child ${childName}: ${message}`;
          if (eventType === "goal") {
            parentMsg = `Congratulations! Your child ${childName} scored a goal at minute ${resolvedMinute}!`;
          }
          await NotificationQueueHelper.sendNotification(
            String(playerWithParent.parentId),
            parentMsg,
            title,
            NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED
          );
        }
      } catch (pErr) {
        // safe ignore
      }
    }

    // Assist player notification
    if (eventType === "goal" && eventMeta?.assist) {
      await NotificationQueueHelper.sendNotification(
        String(eventMeta.assist),
        `You assisted a goal at minute ${resolvedMinute}.`,
        "Assist Recorded",
        NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED
      );
    }

    // Notify all team subscribers about the player/team action in BullMQ background queue
    if (resolvedTeam) {
      try {
        const teamDoc = await Team.findById(resolvedTeam).select("teamName").lean();
        const playerDoc = player
          ? await User.findById(player).select("firstName lastName userName").lean()
          : null;
        const playerName = playerDoc
          ? (playerDoc.firstName
              ? `${playerDoc.firstName} ${playerDoc.lastName || ""}`.trim()
              : playerDoc.userName)
          : "A player";
        const tName = teamDoc?.teamName || "Team";

        let subTitle = `${tName} Match Update`;
        let subMessage = `${playerName} recorded a match event at minute ${resolvedMinute}.`;

        if (eventType === "goal") {
          subTitle = `Goal: ${tName}`;
          subMessage = `${playerName} scored for ${tName} at minute ${resolvedMinute}!`;
        } else if (eventType === "yellow_card") {
          subTitle = `Yellow Card: ${tName}`;
          subMessage = `${playerName} received a yellow card at minute ${resolvedMinute}.`;
        } else if (eventType === "red_card") {
          subTitle = `Red Card: ${tName}`;
          subMessage = `${playerName} received a red card at minute ${resolvedMinute}.`;
        } else if (eventType === "substitution") {
          const subDirection = eventMeta?.substitutionType === "out" ? "substituted out" : "substituted in";
          subTitle = `Substitution: ${tName}`;
          subMessage = `${playerName} was ${subDirection} at minute ${resolvedMinute}.`;
        } else if (eventType === "foul") {
          subTitle = `Foul: ${tName}`;
          subMessage = `A foul was recorded for ${playerName} at minute ${resolvedMinute}.`;
        } else if (
          eventType === "player_of_the_day" ||
          eventType === "man_of_the_match"
        ) {
          subTitle = `Player of the Day: ${tName}`;
          subMessage = `${playerName} has been named Player of the Day.`;
        } else if (eventType === "clean_sheet") {
          subTitle = `Clean Sheet: ${tName}`;
          subMessage = `${playerName} maintained a clean sheet.`;
        }

        await NotificationQueueHelper.notifyTeamSubscribers(
          String(resolvedTeam),
          subTitle,
          subMessage,
          "PLAYER_ACTION",
          String(match),
          "Match",
          {
            playerId: player ? String(player) : "",
            matchId: String(match),
            eventType,
            minute: String(resolvedMinute),
            period: matchData.period || "first_half",
          }
        );
      } catch (subErr) {
        console.error("Failed to queue team subscriber notification:", subErr);
      }
    }
  } catch (error) {
    console.error("Failed to send match result notifications:", error);
  }

  await emitMatchUpdate(match.toString());

  return result;
};

// ========================== GET ALL ==========================
const getAllMatchResultsFromDB = async (query: Record<string, any>) => {
  const { searchTerm, search, sort, page, limit, fields, ...filterKeys } = query;

  // 1. Build Filter Query
  const filterQuery: Record<string, any> = {};

  // Clean and apply other filters
  for (const key in filterKeys) {
    const val = filterKeys[key];
    if (val !== undefined && val !== null && val !== "" && val !== "undefined") {
      filterQuery[key] = val;
    }
  }

  // 2. Handle Search Term
  const searchVal = searchTerm || search;
  if (searchVal) {
    const searchRegex = new RegExp(String(searchVal), "i");

    // Fetch matching references in parallel to perform matching in MatchResult
    const [matchingTeams, matchingUsers, matchingLeagues] = await Promise.all([
      Team.find({
        $or: [
          { teamName: { $regex: searchRegex } },
          { shortName: { $regex: searchRegex } },
        ],
      }).distinct("_id"),
      User.find({
        $or: [
          { userName: { $regex: searchRegex } },
          { firstName: { $regex: searchRegex } },
          { lastName: { $regex: searchRegex } },
          { email: { $regex: searchRegex } },
        ],
      }).distinct("_id"),
      League.find({
        $or: [
          { leagueName: { $regex: searchRegex } },
          { season: { $regex: searchRegex } },
        ],
      }).distinct("_id"),
    ]);

    filterQuery.$or = [
      { eventType: { $regex: searchRegex } },
      { "eventMeta.goalType": { $regex: searchRegex } },
      { "eventMeta.cardType": { $regex: searchRegex } },
      { "eventMeta.substitutionType": { $regex: searchRegex } },
      { team: { $in: matchingTeams } },
      { player: { $in: matchingUsers } },
      { addedBy: { $in: matchingUsers } },
      { "eventMeta.assist": { $in: matchingUsers } },
      { league: { $in: matchingLeagues } },
    ];
  }

  // 3. Sorting
  const sortField = (sort as string) || "-createdAt";

  // 4. Pagination
  const pageNumber = Number(page) || 1;
  const limitNumber = Number(limit) || 10;
  const skip = (pageNumber - 1) * limitNumber;

  // 5. Fields Selection
  const selectFields = (fields as string)?.split(",").join(" ") || "-__v";

  // 6. Execute Main Query & Pagination Total
  const [total, result] = await Promise.all([
    MatchResult.countDocuments(filterQuery),
    MatchResult.find(filterQuery)
      .sort(sortField)
      .skip(skip)
      .limit(limitNumber)
      .select(selectFields)
      .populate("league")
      .populate({
        path: "match",
        populate: [
          { path: "homeTeam", select: "teamName shortName teamLogo" },
          { path: "awayTeam", select: "teamName shortName teamLogo" }
        ]
      })
      .populate("team")
      .populate("player")
      .populate("addedBy")
      .populate("eventMeta.assist")
  ]);

  const totalPage = Math.ceil(total / limitNumber) || 1;
  const meta = {
    total,
    limit: limitNumber,
    page: pageNumber,
    totalPage,
  };

  return { meta, result };
};

// ========================== SINGLE ==========================
const getSingleMatchResultFromDB = async (id: string) => {
  const result = await MatchResult.findById(id)
    .populate("match")
    .populate("team")
    .populate("player")
    .populate("addedBy");

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match event not found");
  }

  return result;
};

// ========================== UPDATE ==========================
const updateMatchResultToDB = async (id: string, payload: any) => {
  if (payload.league === "" || !payload.league) {
    delete payload.league;
  }
  const existing = await MatchResult.findById(id);

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match event not found");
  }

  // rollback old
  await rollbackPlayerStats(existing);
  await rollbackMatchScore(existing);

  const updated = await MatchResult.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });

  if (updated) {
    await applyPlayerStats(updated);
    await applyMatchScore(updated);
    await updateMatchWinner(updated.match);
    await emitMatchUpdate(updated.match.toString());
  }

  return updated;
};

// ========================== DELETE ==========================
const deleteMatchResultFromDB = async (id: string) => {
  const existing = await MatchResult.findById(id);

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match event not found");
  }

  await rollbackPlayerStats(existing);
  await rollbackMatchScore(existing);

  const deleted = await MatchResult.findByIdAndDelete(id);

  await updateMatchWinner(existing.match);
  await emitMatchUpdate(existing.match.toString());

  return deleted;
};

// ========================== MATCH WISE ==========================
const getMatchWiseResultsFromDB = async (matchId: string) => {
  return await MatchResult.find({ match: matchId })
    .populate("team")
    .populate("player")
    .populate("eventMeta.assist")
    .populate("addedBy")
    .sort({ minute: 1, createdAt: 1 });
};

// ============================================================
// ================= PLAYER STATS =================
// ============================================================
const applyPlayerStats = async (payload: any) => {
  const { player, team, eventType, eventMeta, match, minute } = payload;

  if (!player) return;

  // Fetch PlayerEconomy config from DB (fallback to defaults if not configured)
  const pe = await PlayerEconomy.findOne();
  const isPro = await isUserPremiumPlayer(player);

  const inc: any = {};
  const matchRefId = match ? (match._id || match).toString() : undefined;
  const eventRefId = payload._id ? payload._id.toString() : matchRefId;
  const eventMin = Number(minute) || 1;

  // Resolve opponent team name and fixture for clear coin ledger logging
  let opponentName = "";
  let fixtureStr = "";
  if (matchRefId) {
    try {
      const matchDoc = await Match.findById(matchRefId)
        .populate("homeTeam", "teamName shortName")
        .populate("awayTeam", "teamName shortName")
        .lean();
      if (matchDoc) {
        const homeId = (matchDoc.homeTeam as any)?._id?.toString() || matchDoc.homeTeam?.toString();
        const awayId = (matchDoc.awayTeam as any)?._id?.toString() || matchDoc.awayTeam?.toString();

        let playerTeamId = team ? (team._id || team).toString() : "";
        if (!playerTeamId) {
          const playerUser = await User.findById(player).select("selectTeam").lean();
          if (playerUser?.selectTeam) {
            playerTeamId = (playerUser.selectTeam._id || playerUser.selectTeam).toString();
          }
        }

        const homeName = (matchDoc.homeTeam as any)?.teamName || (matchDoc.homeTeam as any)?.shortName || "Home Team";
        const awayName = (matchDoc.awayTeam as any)?.teamName || (matchDoc.awayTeam as any)?.shortName || "Away Team";
        fixtureStr = `${homeName} vs ${awayName}`;

        if (playerTeamId) {
          if (playerTeamId === homeId) {
            opponentName = awayName;
          } else if (playerTeamId === awayId) {
            opponentName = homeName;
          }
        }
      }
    } catch (e) {
      // Graceful fallback if query fails
    }
  }

  const vsOpponent = opponentName ? ` vs ${opponentName}` : "";

  // ================= GOAL =================
  if (eventType === "goal") {
    if (eventMeta?.goalType !== "own_goal") {
      inc.goals = 1;

      // Goal Reward — dynamic from DB (Only for Professional players)
      if (isPro) {
        const goalCoin = pe?.goal?.coin ?? 0;
        if (goalCoin > 0) {
          await recordCoinTransaction({
            userId: player,
            amount: goalCoin,
            category: COIN_TRANSACTION_CATEGORY.GOAL,
            title: "Goal Reward",
            description: `Scored a goal${vsOpponent} at minute ${eventMin}`,
            matchId: matchRefId,
            referenceId: eventRefId,
          });
        }
      }
    }

    // Assist
    if (eventMeta?.assist) {
      await PlayerStats.findOneAndUpdate(
        { player: eventMeta.assist },
        { $inc: { assists: 1 }, $set: { team } },
        { upsert: true, new: true },
      );

      // Assist Reward — dynamic from DB (Only for Professional players)
      const isProAssist = await isUserPremiumPlayer(eventMeta.assist);
      if (isProAssist) {
        const assistCoin = pe?.assist?.coin ?? 0;
        if (assistCoin > 0) {
          await recordCoinTransaction({
            userId: eventMeta.assist,
            amount: assistCoin,
            category: COIN_TRANSACTION_CATEGORY.ASSIST,
            title: "Assist Reward",
            description: `Assisted a goal${vsOpponent} at minute ${eventMin}`,
            matchId: matchRefId,
            referenceId: eventRefId ? `${eventRefId}_assist` : undefined,
          });
        }
      }
    }
  }

  // ================= STANDALONE ASSIST =================
  if (eventType === "assist") {
    inc.assists = 1;
    if (isPro) {
      const assistCoin = pe?.assist?.coin ?? 0;
      if (assistCoin > 0) {
        await recordCoinTransaction({
          userId: player,
          amount: assistCoin,
          category: COIN_TRANSACTION_CATEGORY.ASSIST,
          title: "Assist Reward",
          description: `Assisted a goal${vsOpponent} at minute ${eventMin}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= YELLOW CARD =================
  if (eventType === "yellow_card") {
    inc.yellowCards = 1;

    if (isPro) {
      const yellowCardCoin = pe?.yellowCard?.coin ? -Math.abs(pe.yellowCard.coin) : -500;
      if (yellowCardCoin !== 0) {
        await recordCoinTransaction({
          userId: player,
          amount: yellowCardCoin,
          category: COIN_TRANSACTION_CATEGORY.YELLOW_CARD_PENALTY,
          title: "Yellow Card Penalty",
          description: `Yellow card penalty${vsOpponent} at minute ${eventMin}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= RED CARD =================
  if (eventType === "red_card") {
    inc.redCards = 1;

    if (isPro) {
      const redCardCoin = pe?.redCard?.coin ? -Math.abs(pe.redCard.coin) : -5000;
      if (redCardCoin !== 0) {
        await recordCoinTransaction({
          userId: player,
          amount: redCardCoin,
          category: COIN_TRANSACTION_CATEGORY.RED_CARD_PENALTY,
          title: "Red Card Penalty",
          description: `Red card penalty${vsOpponent} at minute ${eventMin}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= CLEAN SHEET =================
  if (eventType === "clean_sheet") {
    inc.cleanSheets = 1;

    if (isPro) {
      const csCoin = pe?.cleanSheet?.coin ?? 0;
      if (csCoin > 0) {
        await recordCoinTransaction({
          userId: player,
          amount: csCoin,
          category: COIN_TRANSACTION_CATEGORY.CLEAN_SHEET,
          title: "Clean Sheet Reward",
          description: `Clean sheet awarded${vsOpponent ? ` against ${opponentName}` : (fixtureStr ? ` in ${fixtureStr}` : " in match")}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= PLAYER OF THE DAY =================
  if (eventType === "player_of_the_day") {
    inc.playerOfTheDay = 1;

    const potdCoin = pe?.playerOfTheDay?.coin ?? 0;
    if (potdCoin > 0) {
      await recordCoinTransaction({
        userId: player,
        amount: potdCoin,
        category: COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
        title: "Player of the Day Bonus",
        description: `Player of the Day reward${vsOpponent ? ` vs ${opponentName}` : (fixtureStr ? ` in ${fixtureStr}` : " in match")}`,
        matchId: matchRefId,
        referenceId: matchRefId,
      });
    }
  }

  // ================= FOUL =================
  if (eventType === "foul") {
    inc.fouls = 1;

    if (isPro) {
      const foulCoin = pe?.foul?.coin ? -Math.abs(pe.foul.coin) : -100;
      if (foulCoin !== 0) {
        await recordCoinTransaction({
          userId: player,
          amount: foulCoin,
          category: COIN_TRANSACTION_CATEGORY.FOUL_PENALTY,
          title: "Foul Penalty",
          description: `Foul committed${vsOpponent} at minute ${eventMin}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= SIN BIN =================
  if (eventType === "sin_bin") {
    if (isPro) {
      const sinBinCoin = pe?.sinBin?.coin ? -Math.abs(pe.sinBin.coin) : -2500;
      if (sinBinCoin !== 0) {
        await recordCoinTransaction({
          userId: player,
          amount: sinBinCoin,
          category: COIN_TRANSACTION_CATEGORY.SIN_BIN_PENALTY,
          title: "Sin Bin Penalty",
          description: `Sin bin penalty${vsOpponent} at minute ${eventMin}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= DISRESPECT TO REFEREE =================
  if (eventType === "disrespect_to_referee") {
    if (isPro) {
      const disrespectCoin = pe?.disrespectToReferee?.coin ? -Math.abs(pe.disrespectToReferee.coin) : -7500;
      if (disrespectCoin !== 0) {
        await recordCoinTransaction({
          userId: player,
          amount: disrespectCoin,
          category: COIN_TRANSACTION_CATEGORY.DISRESPECT_TO_REFEREE,
          title: "Disrespect to Referee Penalty",
          description: `Disrespect to referee penalty${vsOpponent} at minute ${eventMin}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= GROSS MISCONDUCT =================
  if (eventType === "gross_misconduct") {
    if (isPro) {
      const misconductCoin = pe?.grossMisconduct?.coin ? -Math.abs(pe.grossMisconduct.coin) : -10000;
      if (misconductCoin !== 0) {
        await recordCoinTransaction({
          userId: player,
          amount: misconductCoin,
          category: COIN_TRANSACTION_CATEGORY.GROSS_MISCONDUCT,
          title: "Gross Misconduct Penalty",
          description: `Gross misconduct penalty${vsOpponent} at minute ${eventMin}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= GOOD RATING =================
  if (eventType === "good_rating") {
    if (isPro) {
      const coin = pe?.goodRating?.coin ?? 0;
      if (coin > 0) {
        await recordCoinTransaction({
          userId: player,
          amount: coin,
          category: COIN_TRANSACTION_CATEGORY.MATCH_RATING,
          title: "Good Match Rating Bonus",
          description: `Received Good match rating${vsOpponent ? ` vs ${opponentName}` : (fixtureStr ? ` in ${fixtureStr}` : "")}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= GREAT RATING =================
  if (eventType === "great_rating") {
    if (isPro) {
      const coin = pe?.greatRating?.coin ?? 0;
      if (coin > 0) {
        await recordCoinTransaction({
          userId: player,
          amount: coin,
          category: COIN_TRANSACTION_CATEGORY.MATCH_RATING,
          title: "Great Match Rating Bonus",
          description: `Received Great match rating${vsOpponent ? ` vs ${opponentName}` : (fixtureStr ? ` in ${fixtureStr}` : "")}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= ELITE RATING =================
  if (eventType === "elite_rating") {
    if (isPro) {
      const coin = pe?.eliteRating?.coin ?? 0;
      if (coin > 0) {
        await recordCoinTransaction({
          userId: player,
          amount: coin,
          category: COIN_TRANSACTION_CATEGORY.MATCH_RATING,
          title: "Elite Match Rating Bonus",
          description: `Received Elite match rating${vsOpponent ? ` vs ${opponentName}` : (fixtureStr ? ` in ${fixtureStr}` : "")}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  // ================= PLAYING MATCH =================
  if (eventType === "playing_match") {
    if (isPro) {
      const coin = pe?.playingMatch?.coin ?? 0;
      if (coin > 0) {
        await recordCoinTransaction({
          userId: player,
          amount: coin,
          category: COIN_TRANSACTION_CATEGORY.PLAYING_MATCH,
          title: "Match Appearance Bonus",
          description: `Participated in match${vsOpponent ? ` vs ${opponentName}` : (fixtureStr ? `: ${fixtureStr}` : "")}`,
          matchId: matchRefId,
          referenceId: eventRefId,
        });
      }
    }
  }

  if (Object.keys(inc).length > 0) {
    await PlayerStats.findOneAndUpdate(
      { player },
      { $inc: inc, $set: { team } },
      { upsert: true, new: true },
    );
  }
};

const rollbackPlayerStats = async (payload: any) => {
  const { player, eventType, eventMeta } = payload;

  if (!player) return;

  // Clean up associated coin transactions for this event if it was recorded
  if (payload._id) {
    const eventIdStr = payload._id.toString();
    await CoinTransaction.deleteMany({
      $or: [{ referenceId: eventIdStr }, { referenceId: `${eventIdStr}_assist` }],
    });
  }

  // Fetch PlayerEconomy config from DB for rollback reversal
  const pe = await PlayerEconomy.findOne();
  const isPro = await isUserPremiumPlayer(player);

  const minFloorMV = pe?.startingMarketValue ?? 10000000;

  const inc: any = {};

  // ================= GOAL =================
  if (eventType === "goal") {
    if (eventMeta?.goalType !== "own_goal") {
      inc.goals = -1;

      const goalCoin = pe?.goal?.coin ?? 0;
      const goalMV = pe?.goal?.marketValue ? pe.goal.marketValue : (goalCoin * (pe?.conversionRate ?? 10));
      const user = await User.findById(player);
      if (user && (goalCoin > 0 || goalMV > 0)) {
        const newCoins = Math.max(0, (user.engCoine ?? 0) - goalCoin);
        const newMV = Math.max(minFloorMV, (user.marketValue ?? minFloorMV) - goalMV);
        await User.findByIdAndUpdate(player, {
          $set: { engCoine: newCoins, marketValue: newMV },
        });
      }
    }

    // Rollback Assist
    if (eventMeta?.assist) {
      await PlayerStats.findOneAndUpdate(
        { player: eventMeta.assist },
        { $inc: { assists: -1 } },
      );

      const assistCoin = pe?.assist?.coin ?? 0;
      const assistMV = pe?.assist?.marketValue ? pe.assist.marketValue : (assistCoin * (pe?.conversionRate ?? 10));
      const assistUser = await User.findById(eventMeta.assist);
      if (assistUser && (assistCoin > 0 || assistMV > 0)) {
        const newCoins = Math.max(0, (assistUser.engCoine ?? 0) - assistCoin);
        const newMV = Math.max(minFloorMV, (assistUser.marketValue ?? minFloorMV) - assistMV);
        await User.findByIdAndUpdate(eventMeta.assist, {
          $set: { engCoine: newCoins, marketValue: newMV },
        });
      }
    }
  }

  // ================= STANDALONE ASSIST =================
  if (eventType === "assist") {
    inc.assists = -1;
    const assistCoin = pe?.assist?.coin ?? 0;
    const assistMV = pe?.assist?.marketValue ? pe.assist.marketValue : (assistCoin * (pe?.conversionRate ?? 10));
    const assistUser = await User.findById(player);
    if (assistUser && (assistCoin > 0 || assistMV > 0)) {
      const newCoins = Math.max(0, (assistUser.engCoine ?? 0) - assistCoin);
      const newMV = Math.max(minFloorMV, (assistUser.marketValue ?? minFloorMV) - assistMV);
      await User.findByIdAndUpdate(player, {
        $set: { engCoine: newCoins, marketValue: newMV },
      });
    }
  }

  // ================= YELLOW CARD =================
  if (eventType === "yellow_card") {
    inc.yellowCards = -1;

    if (isPro) {
      const yellowCardCoin = Math.abs(pe?.yellowCard?.coin ?? 0);
      const yellowCardMV = Math.abs(pe?.yellowCard?.marketValue ?? 0);
      await User.findOneAndUpdate(
        { _id: player },
        { $inc: { engCoine: yellowCardCoin, marketValue: yellowCardMV } },
      );
    }
  }

  // ================= RED CARD =================
  if (eventType === "red_card") {
    inc.redCards = -1;

    if (isPro) {
      const redCardCoin = Math.abs(pe?.redCard?.coin ?? 0);
      const redCardMV = Math.abs(pe?.redCard?.marketValue ?? 0);
      await User.findOneAndUpdate(
        { _id: player },
        { $inc: { engCoine: redCardCoin, marketValue: redCardMV } },
      );
    }
  }

  // ================= CLEAN SHEET =================
  if (eventType === "clean_sheet") {
    inc.cleanSheets = -1;

    const csCoin = pe?.cleanSheet?.coin ?? 0;
    const csMV = pe?.cleanSheet?.marketValue ? pe.cleanSheet.marketValue : (csCoin * (pe?.conversionRate ?? 10));
    const user = await User.findById(player);
    if (user && (csCoin > 0 || csMV > 0)) {
      const newCoins = Math.max(0, (user.engCoine ?? 0) - csCoin);
      const newMV = Math.max(minFloorMV, (user.marketValue ?? minFloorMV) - csMV);
      await User.findByIdAndUpdate(player, {
        $set: { engCoine: newCoins, marketValue: newMV },
      });
    }
  }

  // ================= PLAYER OF THE DAY =================
  if (eventType === "player_of_the_day") {
    inc.playerOfTheDay = -1;

    const potdCoin = pe?.playerOfTheDay?.coin ?? 0;
    const potdMV = pe?.playerOfTheDay?.marketValue ? pe.playerOfTheDay.marketValue : (potdCoin * (pe?.conversionRate ?? 10));
    const user = await User.findById(player);
    if (user && (potdCoin > 0 || potdMV > 0)) {
      const newCoins = Math.max(0, (user.engCoine ?? 0) - potdCoin);
      const newMV = Math.max(minFloorMV, (user.marketValue ?? minFloorMV) - potdMV);
      await User.findByIdAndUpdate(player, {
        $set: { engCoine: newCoins, marketValue: newMV },
      });
    }
  }

  // ================= FOUL =================
  if (eventType === "foul") {
    inc.fouls = -1;

    if (isPro) {
      const foulCoin = Math.abs(pe?.foul?.coin ?? 0);
      const foulMV = Math.abs(pe?.foul?.marketValue ?? 0);
      await User.findOneAndUpdate(
        { _id: player },
        { $inc: { engCoine: foulCoin, marketValue: foulMV } },
      );
    }
  }

  // ================= SIN BIN =================
  if (eventType === "sin_bin") {
    if (isPro) {
      const sinBinCoin = Math.abs(pe?.sinBin?.coin ?? 0);
      const sinBinMV = Math.abs(pe?.sinBin?.marketValue ?? 0);
      await User.findOneAndUpdate(
        { _id: player },
        { $inc: { engCoine: sinBinCoin, marketValue: sinBinMV } },
      );
    }
  }

  // ================= DISRESPECT TO REFEREE =================
  if (eventType === "disrespect_to_referee") {
    if (isPro) {
      const disrespectCoin = Math.abs(pe?.disrespectToReferee?.coin ?? 0);
      const disrespectMV = Math.abs(pe?.disrespectToReferee?.marketValue ?? 0);
      await User.findOneAndUpdate(
        { _id: player },
        { $inc: { engCoine: disrespectCoin, marketValue: disrespectMV } },
      );
    }
  }

  // ================= GROSS MISCONDUCT =================
  if (eventType === "gross_misconduct") {
    if (isPro) {
      const misconductCoin = Math.abs(pe?.grossMisconduct?.coin ?? 0);
      const misconductMV = Math.abs(pe?.grossMisconduct?.marketValue ?? 0);
      await User.findOneAndUpdate(
        { _id: player },
        { $inc: { engCoine: misconductCoin, marketValue: misconductMV } },
      );
    }
  }

  // ================= GOOD RATING =================
  if (eventType === "good_rating") {
    if (isPro) {
      const coin = pe?.goodRating?.coin ?? 0;
      const mv = pe?.goodRating?.marketValue ?? (coin * (pe?.conversionRate ?? 10));
      const user = await User.findById(player);
      if (user) {
        const newCoins = Math.max(0, (user.engCoine ?? 0) - coin);
        const newMV = Math.max(minFloorMV, (user.marketValue ?? minFloorMV) - mv);
        await User.findOneAndUpdate(
          { _id: player },
          { $set: { engCoine: newCoins, marketValue: newMV } },
        );
      }
    }
  }

  // ================= GREAT RATING =================
  if (eventType === "great_rating") {
    if (isPro) {
      const coin = pe?.greatRating?.coin ?? 0;
      const mv = pe?.greatRating?.marketValue ?? (coin * (pe?.conversionRate ?? 10));
      const user = await User.findById(player);
      if (user) {
        const newCoins = Math.max(0, (user.engCoine ?? 0) - coin);
        const newMV = Math.max(minFloorMV, (user.marketValue ?? minFloorMV) - mv);
        await User.findOneAndUpdate(
          { _id: player },
          { $set: { engCoine: newCoins, marketValue: newMV } },
        );
      }
    }
  }

  // ================= ELITE RATING =================
  if (eventType === "elite_rating") {
    if (isPro) {
      const coin = pe?.eliteRating?.coin ?? 0;
      const mv = pe?.eliteRating?.marketValue ?? (coin * (pe?.conversionRate ?? 10));
      const user = await User.findById(player);
      if (user) {
        const newCoins = Math.max(0, (user.engCoine ?? 0) - coin);
        const newMV = Math.max(minFloorMV, (user.marketValue ?? minFloorMV) - mv);
        await User.findOneAndUpdate(
          { _id: player },
          { $set: { engCoine: newCoins, marketValue: newMV } },
        );
      }
    }
  }

  // ================= PLAYING MATCH =================
  if (eventType === "playing_match") {
    if (isPro) {
      const coin = pe?.playingMatch?.coin ?? 0;
      const mv = pe?.playingMatch?.marketValue ?? (coin * (pe?.conversionRate ?? 10));
      const user = await User.findById(player);
      if (user) {
        const newCoins = Math.max(0, (user.engCoine ?? 0) - coin);
        const newMV = Math.max(minFloorMV, (user.marketValue ?? minFloorMV) - mv);
        await User.findOneAndUpdate(
          { _id: player },
          { $set: { engCoine: newCoins, marketValue: newMV } },
        );
      }
    }
  }

  if (Object.keys(inc).length > 0) {
    await PlayerStats.findOneAndUpdate(
      { player },
      { $inc: inc },
    );
  }
};

// ============================================================
// MATCH SCORE LOGIC (NEW)
// ============================================================
const applyMatchScore = async (payload: any) => {
  const { match, team, eventType, eventMeta } = payload;

  if (eventType !== "goal") return;

  const matchData = await Match.findById(match);
  if (!matchData) return;

  // own goal হলে score reverse team এ যাবে
  const isOwnGoal = eventMeta?.goalType === "own_goal";

  let scoringTeam = team;

  if (isOwnGoal) {
    scoringTeam =
      String(matchData.homeTeam) === String(team)
        ? matchData.awayTeam
        : matchData.homeTeam;
  }

  if (String(matchData.homeTeam) === String(scoringTeam)) {
    await Match.findByIdAndUpdate(match, {
      $inc: { homeScore: 1 },
    });
  }

  if (String(matchData.awayTeam) === String(scoringTeam)) {
    await Match.findByIdAndUpdate(match, {
      $inc: { awayScore: 1 },
    });
  }
};

const rollbackMatchScore = async (payload: any) => {
  const { match, team, eventType, eventMeta } = payload;

  if (eventType !== "goal") return;

  const matchData = await Match.findById(match);
  if (!matchData) return;

  const isOwnGoal = eventMeta?.goalType === "own_goal";

  let scoringTeam = team;

  if (isOwnGoal) {
    scoringTeam =
      String(matchData.homeTeam) === String(team)
        ? matchData.awayTeam
        : matchData.homeTeam;
  }

  if (String(matchData.homeTeam) === String(scoringTeam)) {
    await Match.findByIdAndUpdate(match, {
      $inc: { homeScore: -1 },
    });
  }

  if (String(matchData.awayTeam) === String(scoringTeam)) {
    await Match.findByIdAndUpdate(match, {
      $inc: { awayScore: -1 },
    });
  }
};

// ============================================================
//  WINNER UPDATE (NEW)
// ============================================================
const updateMatchWinner = async (matchId: any) => {
  const match = await Match.findById(matchId);
  if (!match) return;

  let winnerTeam = null;

  const homeTeamId = match.homeTeam;
  const awayTeamId = match.awayTeam;
  const homeScore = match.homeScore;
  const awayScore = match.awayScore;

  // WIN CONDITION
  if (homeScore > awayScore) {
    winnerTeam = homeTeamId;
  } else if (awayScore > homeScore) {
    winnerTeam = awayTeamId;
  }

  // Update match winner
  await Match.findByIdAndUpdate(matchId, { winnerTeam });
};

const rollbackAllResultsForMatch = async (matchId: string) => {
  const results = await MatchResult.find({ match: matchId });
  for (const r of results) {
    await rollbackPlayerStats(r);
  }
  await CoinTransaction.deleteMany({ match: matchId });
  await MatchResult.deleteMany({ match: matchId });
};

// ============================================================
export const MatchResultService = {
  createMatchResultToDB,
  getAllMatchResultsFromDB,
  getSingleMatchResultFromDB,
  updateMatchResultToDB,
  deleteMatchResultFromDB,
  getMatchWiseResultsFromDB,
  rollbackAllResultsForMatch,
};
