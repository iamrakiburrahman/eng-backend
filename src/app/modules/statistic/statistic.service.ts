import mongoose from "mongoose";
import { MatchResult } from "../matchResult/matchResult.model";
import { Match } from "../match/match.model";
import { League } from "../league/league.model";
import { LeagueTeam } from "../leagueTeam/leagueTeam.model";
import { User } from "../user/user.model";
import { Team } from "../team/team.model";
import { Video } from "../video/video.model";

import { USER_ROLES } from "../../../enums/user";
import { getBatchPlayerStatsSummary, IPlayerStatsDetails } from "../../../helpers/playerStatsHelper";
import { getActivePremiumSubUserIds } from "../../../helpers/packageHelper";
import { CoinTransaction } from "../coinTransaction/coinTransaction.model";
import { COIN_TRANSACTION_CATEGORY } from "../coinTransaction/coinTransaction.interface";

const MATCH_COIN_CATEGORIES: COIN_TRANSACTION_CATEGORY[] = [
  COIN_TRANSACTION_CATEGORY.GOAL,
  COIN_TRANSACTION_CATEGORY.ASSIST,
  COIN_TRANSACTION_CATEGORY.CLEAN_SHEET,
  COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
  COIN_TRANSACTION_CATEGORY.MATCH_RATING,
  COIN_TRANSACTION_CATEGORY.ATTEND_MATCH,
  COIN_TRANSACTION_CATEGORY.PLAYING_MATCH,
  COIN_TRANSACTION_CATEGORY.WIN_MATCH,
  COIN_TRANSACTION_CATEGORY.DRAW_MATCH,
  COIN_TRANSACTION_CATEGORY.YELLOW_CARD_PENALTY,
  COIN_TRANSACTION_CATEGORY.RED_CARD_PENALTY,
  COIN_TRANSACTION_CATEGORY.FOUL_PENALTY,
  COIN_TRANSACTION_CATEGORY.SIN_BIN_PENALTY,
  COIN_TRANSACTION_CATEGORY.DISRESPECT_TO_REFEREE,
  COIN_TRANSACTION_CATEGORY.GROSS_MISCONDUCT,
  COIN_TRANSACTION_CATEGORY.ROLLBACK,
];

const escapeRegex = (val: string) => val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getTimeframeConfig = (rawTf?: unknown) => {
  const tf = (rawTf || "overall").toString().trim().toLowerCase();
  const now = new Date();

  if (tf === "this_week" || tf === "week" || tf === "weekly") {
    const day = now.getDay() || 7;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - day + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);

    const startOfPrevWeek = new Date(startOfWeek);
    startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);

    const endOfPrevWeek = new Date(startOfWeek);
    endOfPrevWeek.setMilliseconds(-1);

    return {
      tf: "weekly",
      isPeriodSpecific: true,
      currentRange: { start: startOfWeek, end: endOfWeek },
      previousRange: { start: startOfPrevWeek, end: endOfPrevWeek },
    };
  }

  if (tf === "this_month" || tf === "month" || tf === "monthly") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startOfPrevMonth.setHours(0, 0, 0, 0);

    const endOfPrevMonth = new Date(startOfMonth);
    endOfPrevMonth.setMilliseconds(-1);

    return {
      tf: "monthly",
      isPeriodSpecific: true,
      currentRange: { start: startOfMonth, end: endOfMonth },
      previousRange: { start: startOfPrevMonth, end: endOfPrevMonth },
    };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return {
    tf: tf === "all" ? "all" : "overall",
    isPeriodSpecific: false,
    currentRange: null,
    previousRange: { endBefore: sevenDaysAgo },
  };
};

const getBatchMatchEarnedCoins = async (
  playerIds: mongoose.Types.ObjectId[],
  matchIds: mongoose.Types.ObjectId[]
): Promise<Map<string, number>> => {
  const coinsMap = new Map<string, number>();
  if (!playerIds.length || !matchIds.length) {
    return coinsMap;
  }

  const rows = await CoinTransaction.aggregate([
    {
      $match: {
        user: { $in: playerIds },
        match: { $in: matchIds },
        category: { $in: MATCH_COIN_CATEGORIES },
      },
    },
    {
      $group: {
        _id: "$user",
        netCoins: {
          $sum: {
            $cond: [
              { $eq: ["$type", "CREDIT"] },
              "$amount",
              { $multiply: ["$amount", -1] },
            ],
          },
        },
      },
    },
  ]);

  rows.forEach((row: any) => {
    const pId = row._id?.toString();
    if (pId) {
      coinsMap.set(pId, Math.max(0, Number(row.netCoins) || 0));
    }
  });

  return coinsMap;
};


const getTopPlayerFromDB = async (leagueId: string) => {
  const [parentIds, activePremiumSubUserIds] = await Promise.all([
    User.find({
      parentId: { $exists: true, $ne: null },
    }).distinct("parentId"),
    getActivePremiumSubUserIds(),
  ]);

  const result = await MatchResult.aggregate([
    {
      $match: {
        league: new mongoose.Types.ObjectId(leagueId),
      },
    },

    {
      $group: {
        _id: "$player",

        goals: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "goal"] }, 1, 0],
          },
        },

        assists: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "assist"] }, 1, 0],
          },
        },

        yellowCards: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "yellow_card"] }, 1, 0],
          },
        },

        redCards: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "red_card"] }, 1, 0],
          },
        },
      },
    },

    {
      $addFields: {
        score: {
          $subtract: [
            {
              $add: [
                { $multiply: ["$goals", 4] },
                { $multiply: ["$assists", 3] },
              ],
            },
            {
              $add: [
                { $multiply: ["$yellowCards", 1] },
                { $multiply: ["$redCards", 3] },
              ],
            },
          ],
        },
      },
    },

    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "player",
      },
    },

    { $unwind: "$player" },

    {
      $match: {
        "player.role": {
          $in: [
            USER_ROLES.PLAYER,
            USER_ROLES.TOURNAMENT_PLAYER,
            USER_ROLES.OTHER_CLUBS,
          ],
        },
        "player._id": { $nin: parentIds },
        $or: [
          { "player._id": { $in: activePremiumSubUserIds } },
          { "player.parentId": { $in: activePremiumSubUserIds } },
        ],
      },
    },

    { $sort: { score: -1 } },
    { $limit: 1 },

    {
      $project: {
        _id: 0,
        player: {
          _id: "$player._id",
          email: "$player.email",
          role: "$player.role",
          profile: "$player.profile",
          username: "$player.userName",
        },
        goals: 1,
        assists: 1,
        yellowCards: 1,
        redCards: 1,
        score: 1,
      },
    },
  ]);

  return result[0] || null;
};

const getPlayerSeasonStatsFromDB = async (
  playerId: string,
  leagueId: string
) => {
  const stats = await MatchResult.aggregate([
    {
      $match: {
        player: new mongoose.Types.ObjectId(playerId),
        league: new mongoose.Types.ObjectId(leagueId),
      },
    },

    {
      $group: {
        _id: null,

        goals: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "goal"] }, 1, 0],
          },
        },

        assists: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "assist"] }, 1, 0],
          },
        },

        yellowCards: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "yellow_card"] }, 1, 0],
          },
        },

        redCards: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "red_card"] }, 1, 0],
          },
        },

        fouls: {
          $sum: {
            $cond: [{ $eq: ["$eventType", "foul"] }, 1, 0],
          },
        },

        totalMatches: {
          $addToSet: "$match",
        },
      },
    },

    {
      $project: {
        _id: 0,
        goals: 1,
        assists: 1,
        yellowCards: 1,
        redCards: 1,
        fouls: 1,
        totalMatches: { $size: "$totalMatches" },
      },
    },
  ]);

  return (
    stats[0] || {
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      fouls: 0,
      totalMatches: 0,
    }
  );
};


// Helper to fetch single-timeframe league summary stats
const fetchLeagueSummaryStatsByTimeframe = async (
  query: Record<string, any> | undefined,
  tf: string = "overall",
  leagueFilter: any,
  matchedLeagueIds: mongoose.Types.ObjectId[] = [],
  hasLeagueFilter: boolean = false
) => {
  const queryWithTf = {
    ...query,
    timeframe: tf,
    limit: 1,
  };

  const { isPeriodSpecific, currentRange } = getTimeframeConfig(tf);

  let teamScopeFilter: any = { ...leagueFilter };
  if (hasLeagueFilter && matchedLeagueIds.length === 0) {
    teamScopeFilter = { match: { $in: [] } };
  } else if (isPeriodSpecific && currentRange) {
    const periodMatchQuery: any = {
      status: { $ne: "cancelled" },
      matchDate: { $gte: currentRange.start, $lte: currentRange.end },
    };
    if (matchedLeagueIds.length > 0) {
      periodMatchQuery.league = { $in: matchedLeagueIds };
    }
    const periodMatches = await Match.find(periodMatchQuery).select("_id").lean();
    const periodMatchIds = periodMatches.map((m) => m._id);
    teamScopeFilter = { match: { $in: periodMatchIds } };
  }

  const goalMatchFilter: any = {
    ...teamScopeFilter,
    eventType: "goal",
    "eventMeta.goalType": { $ne: "own_goal" },
  };
  const assistMatchFilter: any = {
    ...teamScopeFilter,
    eventType: "assist",
  };

  // 1. Fetch top 1 from each category using the unified leaderboard logic
  // 2. Fetch top goal and assist teams
  const [
    topGoalList,
    topAssistList,
    topCleanSheetList,
    topOverallList,
    topGoalTeam,
    topAssistTeam,
  ] = await Promise.all([
    getTopGoalScorersFromDB(queryWithTf),
    getTopAssistsFromDB(queryWithTf),
    getTopCleanSheetsFromDB(queryWithTf),
    getTopOverallPlayersFromDB(queryWithTf),
    MatchResult.aggregate([
      {
        $match: goalMatchFilter,
      },
      {
        $group: {
          _id: "$team",
          totalGoals: { $sum: 1 },
        },
      },
      {
        $sort: { totalGoals: -1 },
      },
      {
        $limit: 1,
      },
      {
        $lookup: {
          from: "teams",
          localField: "_id",
          foreignField: "_id",
          as: "team",
        },
      },
      {
        $unwind: "$team",
      },
      {
        $project: {
          _id: 0,
          totalGoals: 1,
          teamName: "$team.teamName",
          teamLogo: { $ifNull: ["$team.teamLogo", "$team.logo"] },
        },
      },
    ]),
    MatchResult.aggregate([
      {
        $match: assistMatchFilter,
      },
      {
        $group: {
          _id: "$team",
          totalAssists: { $sum: 1 },
        },
      },
      {
        $sort: { totalAssists: -1 },
      },
      {
        $limit: 1,
      },
      {
        $lookup: {
          from: "teams",
          localField: "_id",
          foreignField: "_id",
          as: "team",
        },
      },
      {
        $unwind: "$team",
      },
      {
        $project: {
          _id: 0,
          totalAssists: 1,
          teamName: "$team.teamName",
          teamLogo: { $ifNull: ["$team.teamLogo", "$team.logo"] },
        },
      },
    ]),
  ]);

  const defaultPlayer = {
    _id: null,
    playerId: null,
    firstName: "",
    lastName: "",
    userName: "",
    profile: "",
    jerseyNumber: null,
    position: null,
    ageGroup: null,
    team: null,
    marketValue: 0,
    engCoine: 0,
    lifetimeEngCoine: 0,
    periodCoins: 0,
    goals: 0,
    totalGoals: 0,
    assists: 0,
    totalAssists: 0,
    cleanSheets: 0,
    totalCleanSheets: 0,
    playerOfTheDay: 0,
    totalPlayerOfTheDay: 0,
    score: 0,
    stats: {
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      playerOfTheDay: 0,
      yellowCards: 0,
      redCards: 0,
      score: 0,
    },
  };

  const topGoalScorer = topGoalList[0] || defaultPlayer;
  const topAssistPlayer = topAssistList[0] || defaultPlayer;
  const topCleanSheetPlayer = topCleanSheetList[0] || defaultPlayer;
  const topOverallPlayer = topOverallList[0] || defaultPlayer;

  return {
    timeframe: tf,
    topGoalScorer,
    topAssistPlayer,
    topCleanSheetPlayer,
    topCleanSheet: topCleanSheetPlayer,
    topOverallPlayer,
    topOverall: topOverallPlayer,
    topGoalTeam: topGoalTeam[0] || {
      totalGoals: 0,
      teamName: "",
      teamLogo: "",
    },
    topAssistTeam: topAssistTeam[0] || {
      totalAssists: 0,
      teamName: "",
      teamLogo: "",
    },
  };
};

// 🏆 LEAGUE SUMMARY (Supports timeframe=weekly | monthly | overall | all, articles excluded per request)
const getLeagueSummaryFromDB = async (query?: Record<string, any>): Promise<any> => {
  const { leagueName, leagueId, league, season } = query || {};
  const directLeagueId = leagueId || (league && mongoose.Types.ObjectId.isValid(league as string) ? league : null);

  const matchedLeagueIds: mongoose.Types.ObjectId[] = [];
  if (directLeagueId && mongoose.Types.ObjectId.isValid(directLeagueId as string)) {
    matchedLeagueIds.push(new mongoose.Types.ObjectId(directLeagueId as string));
  }

  if (leagueName || season) {
    const filterConditions: any = {};
    if (leagueName && leagueName.trim()) {
      const safeLeagueName = escapeRegex(leagueName.trim());
      filterConditions.$or = [
        { leagueName: { $regex: safeLeagueName, $options: "i" } },
        { name: { $regex: safeLeagueName, $options: "i" } },
      ];
    }
    if (season && season.trim()) {
      filterConditions.season = { $regex: escapeRegex(season.trim()), $options: "i" };
    }

    const leagues = await League.find(filterConditions).select("_id");
    leagues.forEach((l) => {
      if (!matchedLeagueIds.some((id) => id.toString() === l._id.toString())) {
        matchedLeagueIds.push(l._id);
      }
    });
  }

  const hasLeagueFilter = Boolean(
    (directLeagueId && mongoose.Types.ObjectId.isValid(directLeagueId as string)) ||
      (leagueName && leagueName.trim()) ||
      (season && season.trim())
  );

  const leagueFilter: any = {};
  if (matchedLeagueIds.length > 0) {
    const matchesInLeague = await Match.find({
      league: { $in: matchedLeagueIds },
      status: { $ne: "cancelled" },
    }).select("_id");
    const matchIds = matchesInLeague.map((m) => m._id);

    leagueFilter.$or = [
      { league: { $in: matchedLeagueIds } },
      { match: { $in: matchIds } },
    ];
  }

  // Videos only (Articles excluded per request)
  const videosPromise = Video.find()
    .sort({ createdAt: -1 })
    .limit(6)
    .select("title description videoUrl thumbnail duration createdAt")
    .lean();

  const requestedTf = (query?.timeframe || query?.period || "overall").toString().toLowerCase();

  // If client requests "all", return weekly, monthly, and overall in parallel
  if (requestedTf === "all") {
    const [weekly, monthly, overall, videos] = await Promise.all([
      fetchLeagueSummaryStatsByTimeframe(query, "weekly", leagueFilter, matchedLeagueIds, hasLeagueFilter),
      fetchLeagueSummaryStatsByTimeframe(query, "monthly", leagueFilter, matchedLeagueIds, hasLeagueFilter),
      fetchLeagueSummaryStatsByTimeframe(query, "overall", leagueFilter, matchedLeagueIds, hasLeagueFilter),
      videosPromise,
    ]);

    return {
      weekly,
      monthly,
      overall,
      videos,
    };
  }

  // Normalize single timeframe
  let normalizedTf = "overall";
  if (requestedTf === "weekly" || requestedTf === "week" || requestedTf === "this_week") {
    normalizedTf = "weekly";
  } else if (requestedTf === "monthly" || requestedTf === "month" || requestedTf === "this_month") {
    normalizedTf = "monthly";
  }

  const [stats, videos] = await Promise.all([
    fetchLeagueSummaryStatsByTimeframe(query, normalizedTf, leagueFilter, matchedLeagueIds, hasLeagueFilter),
    videosPromise,
  ]);

  return {
    ...stats,
    videos,
  };
};



const getSeasonLeaderboardFromDB = async (season?: string) => {
  const matchFilter: any = {};

  if (season) {
    const leagues = await League.find({
      season: {
        $regex: season,
        $options: "i",
      },
    }).select("_id");

    if (!leagues.length) {
      return {
        goal: [],
        assist: [],
      };
    }

    matchFilter.league = {
      $in: leagues.map((l) => l._id),
    };
  }

  const [parentIds, activePremiumSubUserIds] = await Promise.all([
    User.find({
      parentId: { $exists: true, $ne: null },
    }).distinct("parentId"),
    getActivePremiumSubUserIds(),
  ]);

  // ===============================
  // Goal Leaderboard
  // ===============================

  const goal = await MatchResult.aggregate([
    {
      $match: {
        ...matchFilter,
        eventType: "goal",
      },
    },

    {
      $group: {
        _id: "$player",
        totalGoals: {
          $sum: 1,
        },
      },
    },

    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },

    {
      $unwind: "$user",
    },

    {
      $match: {
        "user.role": {
          $in: [
            USER_ROLES.PLAYER,
            USER_ROLES.TOURNAMENT_PLAYER,
            USER_ROLES.OTHER_CLUBS,
          ],
        },
        "user._id": { $nin: parentIds },
        $or: [
          { "user._id": { $in: activePremiumSubUserIds } },
          { "user.parentId": { $in: activePremiumSubUserIds } },
        ],
      },
    },

    {
      $sort: {
        totalGoals: -1,
      },
    },

    {
      $limit: 50,
    },

    {
      $project: {
        _id: 0,
        firstName: "$user.firstName",
        lastName: "$user.lastName",
        profile: "$user.profile",
        totalGoals: 1,
      },
    },
  ]).then((players) =>
    players.map((player, index) => ({
      rank: index + 1,
      ...player,
    }))
  );

  // ===============================
  // Assist Leaderboard
  // ===============================

  const assist = await MatchResult.aggregate([
    {
      $match: {
        ...matchFilter,
        eventType: "assist",
      },
    },

    {
      $group: {
        _id: "$player",
        totalAssists: {
          $sum: 1,
        },
      },
    },

    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "user",
      },
    },

    {
      $unwind: "$user",
    },

    {
      $match: {
        "user.role": {
          $in: [
            USER_ROLES.PLAYER,
            USER_ROLES.TOURNAMENT_PLAYER,
            USER_ROLES.OTHER_CLUBS,
          ],
        },
        "user._id": { $nin: parentIds },
        $or: [
          { "user._id": { $in: activePremiumSubUserIds } },
          { "user.parentId": { $in: activePremiumSubUserIds } },
        ],
      },
    },

    {
      $sort: {
        totalAssists: -1,
      },
    },

    {
      $limit: 50,
    },

    {
      $project: {
        _id: 0,
        firstName: "$user.firstName",
        lastName: "$user.lastName",
        profile: "$user.profile",
        totalAssists: 1,
      },
    },
  ]).then((players) =>
    players.map((player, index) => ({
      rank: index + 1,
      ...player,
    }))
  );

  return {
    goal,
    assist,
  };
};

/**
 * Common helper to get enriched players with stats and team info
 */
const attachRankAndMovement = (
  sortedList: any[],
  baselineCompareFn: (a: any, b: any) => number,
  limit: number
) => {
  const baselineList = [...sortedList].sort(baselineCompareFn);
  const prevRankMap = new Map<string, number>();
  baselineList.forEach((p, idx) => {
    prevRankMap.set(p._id.toString(), idx + 1);
  });

  return sortedList.slice(0, limit).map((player, idx) => {
    const rank = idx + 1;
    const previousRank = prevRankMap.get(player._id.toString()) || rank;
    const rankDelta = previousRank - rank; // > 0 means climbed up (e.g. was 5, now 3 -> delta +2)
    let rankChange: "up" | "down" | "same" = "same";
    let arrow: "green" | "red" | "neutral" = "neutral";

    if (rankDelta > 0) {
      rankChange = "up";
      arrow = "green";
    } else if (rankDelta < 0) {
      rankChange = "down";
      arrow = "red";
    }

    return {
      rank,
      previousRank,
      rankChange,
      rankDelta,
      arrow,
      ...player,
    };
  });
};

/**
 * Common helper to get enriched players with stats, team info, and timeframe filtering
 */
const getEnrichedPlayersWithStats = async (query?: Record<string, any>) => {
  const {
    ageGroup,
    teamId,
    search,
    leagueName,
    leagueId,
    league,
    season,
    searchTerm,
    timeframe,
    period,
  } = query || {};
  const playerSearch = (search || searchTerm) as string;
  const directLeagueId = leagueId || (league && mongoose.Types.ObjectId.isValid(league as string) ? league : null);

  const { tf, isPeriodSpecific, currentRange, previousRange } = getTimeframeConfig(
    timeframe || period
  );

  const matchedLeagueIds: mongoose.Types.ObjectId[] = [];
  if (directLeagueId && mongoose.Types.ObjectId.isValid(directLeagueId as string)) {
    matchedLeagueIds.push(new mongoose.Types.ObjectId(directLeagueId as string));
  }

  if (leagueName || season) {
    const filterConditions: any = {};
    if (leagueName && leagueName.trim()) {
      const safeLeagueName = escapeRegex(leagueName.trim());
      filterConditions.$or = [
        { leagueName: { $regex: safeLeagueName, $options: "i" } },
        { name: { $regex: safeLeagueName, $options: "i" } },
      ];
    }
    if (season && season.trim()) {
      filterConditions.season = { $regex: escapeRegex(season.trim()), $options: "i" };
    }

    const leagues = await League.find(filterConditions).select("_id");
    leagues.forEach((l) => {
      if (!matchedLeagueIds.some((id) => id.toString() === l._id.toString())) {
        matchedLeagueIds.push(l._id);
      }
    });

    if (!matchedLeagueIds.length) {
      return [];
    }
  }

  let matchFilterOptions: any = undefined;
  let prevMatchFilterOptions: any = undefined;
  let teamIdsInLeague: mongoose.Types.ObjectId[] = [];
  let periodMatchIds: mongoose.Types.ObjectId[] = [];
  let prevPeriodMatchIds: mongoose.Types.ObjectId[] = [];
  let recent7dMatchIds: mongoose.Types.ObjectId[] = [];

  if (matchedLeagueIds.length > 0) {
    const [matchesInLeague, leagueTeamLinks, directTeams] = await Promise.all([
      Match.find({
        league: { $in: matchedLeagueIds },
        status: { $ne: "cancelled" },
      })
        .select("_id homeTeam awayTeam matchDate")
        .lean(),
      LeagueTeam.find({ league: { $in: matchedLeagueIds } }).select("team"),
      Team.find({ league: { $in: matchedLeagueIds } }).select("_id"),
    ]);

    const leagueTeamIds = leagueTeamLinks.map((lt) => lt.team).filter(Boolean);
    const directTeamIds = directTeams.map((t) => t._id).filter(Boolean);
    const matchTeamIds = matchesInLeague.flatMap((m) => [m.homeTeam, m.awayTeam]).filter(Boolean);

    teamIdsInLeague = [
      ...new Set([...leagueTeamIds, ...directTeamIds, ...matchTeamIds].map((id) => id.toString())),
    ].map((id) => new mongoose.Types.ObjectId(id));

    if (!teamIdsInLeague.length) {
      return [];
    }

    const allMatchIds = matchesInLeague.map((m) => m._id);

    if (isPeriodSpecific && currentRange && previousRange.start && previousRange.end) {
      periodMatchIds = matchesInLeague
        .filter((m) => m.matchDate && m.matchDate >= currentRange.start && m.matchDate <= currentRange.end)
        .map((m) => m._id);

      if (!periodMatchIds.length) {
        return [];
      }

      prevPeriodMatchIds = matchesInLeague
        .filter((m) => m.matchDate && m.matchDate >= previousRange.start! && m.matchDate <= previousRange.end!)
        .map((m) => m._id);

      matchFilterOptions = {
        matchFilter: { match: { $in: periodMatchIds } },
        matchEvaluationFilter: { match: { $in: periodMatchIds } },
        matchSelectionFilter: { match: { $in: periodMatchIds } },
        matchReviewFilter: { _id: { $in: periodMatchIds } },
        validMatchFilter: { _id: { $in: periodMatchIds } },
        includeManualStats: false,
      };

      prevMatchFilterOptions = {
        matchFilter: { match: { $in: prevPeriodMatchIds } },
        matchEvaluationFilter: { match: { $in: prevPeriodMatchIds } },
        matchSelectionFilter: { match: { $in: prevPeriodMatchIds } },
        matchReviewFilter: { _id: { $in: prevPeriodMatchIds } },
        validMatchFilter: { _id: { $in: prevPeriodMatchIds } },
        includeManualStats: false,
      };
    } else {
      const endBefore = previousRange.endBefore || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      prevPeriodMatchIds = matchesInLeague
        .filter((m) => m.matchDate && m.matchDate < endBefore)
        .map((m) => m._id);
      recent7dMatchIds = matchesInLeague
        .filter((m) => m.matchDate && m.matchDate >= endBefore)
        .map((m) => m._id);

      matchFilterOptions = {
        matchFilter: {
          $or: [
            { league: { $in: matchedLeagueIds } },
            { match: { $in: allMatchIds } },
          ],
        },
        matchEvaluationFilter: { match: { $in: allMatchIds } },
        matchSelectionFilter: { match: { $in: allMatchIds } },
        matchReviewFilter: { _id: { $in: allMatchIds } },
        validMatchFilter: { _id: { $in: allMatchIds } },
        includeManualStats: true,
        manualStatsLeagueIds: matchedLeagueIds,
      };

      prevMatchFilterOptions = {
        matchFilter: { match: { $in: prevPeriodMatchIds } },
        matchEvaluationFilter: { match: { $in: prevPeriodMatchIds } },
        matchSelectionFilter: { match: { $in: prevPeriodMatchIds } },
        matchReviewFilter: { _id: { $in: prevPeriodMatchIds } },
        validMatchFilter: { _id: { $in: prevPeriodMatchIds } },
        includeManualStats: false,
      };
    }
  } else if (isPeriodSpecific && currentRange && previousRange.start && previousRange.end) {
    const [periodMatches, prevPeriodMatches] = await Promise.all([
      Match.find({
        status: { $ne: "cancelled" },
        matchDate: { $gte: currentRange.start, $lte: currentRange.end },
      })
        .select("_id")
        .lean(),
      Match.find({
        status: { $ne: "cancelled" },
        matchDate: { $gte: previousRange.start, $lte: previousRange.end },
      })
        .select("_id")
        .lean(),
    ]);

    periodMatchIds = periodMatches.map((m) => m._id);
    if (!periodMatchIds.length) {
      return [];
    }
    prevPeriodMatchIds = prevPeriodMatches.map((m) => m._id);

    matchFilterOptions = {
      matchFilter: { match: { $in: periodMatchIds } },
      matchEvaluationFilter: { match: { $in: periodMatchIds } },
      matchSelectionFilter: { match: { $in: periodMatchIds } },
      matchReviewFilter: { _id: { $in: periodMatchIds } },
      validMatchFilter: { _id: { $in: periodMatchIds } },
      includeManualStats: false,
    };

    prevMatchFilterOptions = {
      matchFilter: { match: { $in: prevPeriodMatchIds } },
      matchEvaluationFilter: { match: { $in: prevPeriodMatchIds } },
      matchSelectionFilter: { match: { $in: prevPeriodMatchIds } },
      matchReviewFilter: { _id: { $in: prevPeriodMatchIds } },
      validMatchFilter: { _id: { $in: prevPeriodMatchIds } },
      includeManualStats: false,
    };
  } else {
    const endBefore = previousRange.endBefore || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [prevMatches, recentMatches] = await Promise.all([
      Match.find({
        status: { $ne: "cancelled" },
        matchDate: { $lt: endBefore },
      })
        .select("_id")
        .lean(),
      Match.find({
        status: { $ne: "cancelled" },
        matchDate: { $gte: endBefore },
      })
        .select("_id")
        .lean(),
    ]);

    prevPeriodMatchIds = prevMatches.map((m) => m._id);
    recent7dMatchIds = recentMatches.map((m) => m._id);

    prevMatchFilterOptions = {
      matchFilter: { match: { $in: prevPeriodMatchIds } },
      matchEvaluationFilter: { match: { $in: prevPeriodMatchIds } },
      matchSelectionFilter: { match: { $in: prevPeriodMatchIds } },
      matchReviewFilter: { _id: { $in: prevPeriodMatchIds } },
      validMatchFilter: { _id: { $in: prevPeriodMatchIds } },
      includeManualStats: false,
    };
  }

  const [parentIds, activePremiumSubUserIds] = await Promise.all([
    User.find({
      parentId: { $exists: true, $ne: null },
    }).distinct("parentId"),
    getActivePremiumSubUserIds(),
  ]);

  const userFilter: any = {
    _id: { $in: activePremiumSubUserIds, $nin: parentIds },
    role: {
      $in: [
        USER_ROLES.PLAYER,
        USER_ROLES.TOURNAMENT_PLAYER,
        USER_ROLES.OTHER_CLUBS,
      ],
    },
    status: "APPROVED",
  };

  if (ageGroup) {
    userFilter.ageGroup = { $regex: new RegExp(`^${escapeRegex(ageGroup.toString().trim())}$`, "i") };
  }

  if (teamId) {
    userFilter.selectTeam = mongoose.Types.ObjectId.isValid(teamId as string)
      ? new mongoose.Types.ObjectId(teamId as string)
      : teamId;
  } else if (teamIdsInLeague.length > 0) {
    userFilter.selectTeam = { $in: teamIdsInLeague };
  }

  if (playerSearch && playerSearch.trim()) {
    const searchRegex = new RegExp(escapeRegex(playerSearch.trim()), "i");
    userFilter.$and = [
      {
        $or: [
          { firstName: searchRegex },
          { lastName: searchRegex },
          { userName: searchRegex },
        ],
      },
    ];
  }

  const players = await User.find(userFilter)
    .select(
      "_id firstName lastName userName profile jerseyNumber position ageGroup selectTeam engCoine marketValue"
    )
    .populate({
      path: "selectTeam",
      select: "_id teamName shortName teamLogo city country",
    })
    .lean();

  if (!players.length) {
    return [];
  }

  const playerIds = players.map((p) => p._id);

  const [statsMap, prevStatsMap, periodCoinsMap, prevPeriodCoinsMap, recent7dCoinsMap] =
    await Promise.all([
      getBatchPlayerStatsSummary(playerIds, matchFilterOptions),
      prevMatchFilterOptions
        ? getBatchPlayerStatsSummary(playerIds, prevMatchFilterOptions)
        : Promise.resolve(new Map<string, IPlayerStatsDetails>()),
      isPeriodSpecific
        ? getBatchMatchEarnedCoins(playerIds, periodMatchIds)
        : Promise.resolve(new Map<string, number>()),
      isPeriodSpecific
        ? getBatchMatchEarnedCoins(playerIds, prevPeriodMatchIds)
        : Promise.resolve(new Map<string, number>()),
      !isPeriodSpecific
        ? getBatchMatchEarnedCoins(playerIds, recent7dMatchIds)
        : Promise.resolve(new Map<string, number>()),
    ]);

  return players.map((p: any) => {
    const pIdStr = p._id.toString();
    const stats: IPlayerStatsDetails = statsMap.get(pIdStr) || {
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      playerOfTheDay: 0,
      yellowCards: 0,
      redCards: 0,
      totalMatches: 0,
      matchesPlayed: 0,
    };

    const prevStats: IPlayerStatsDetails = prevStatsMap.get(pIdStr) || {
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      playerOfTheDay: 0,
      yellowCards: 0,
      redCards: 0,
      totalMatches: 0,
      matchesPlayed: 0,
    };

    const score =
      (stats.goals * 4) +
      (stats.assists * 3) +
      (stats.cleanSheets * 3) +
      (stats.playerOfTheDay * 5) -
      (stats.yellowCards * 1) -
      (stats.redCards * 3);

    const lifetimeEngCoine = Number(p.engCoine) || 0;
    const effectiveCoins = isPeriodSpecific
      ? periodCoinsMap.get(pIdStr) || 0
      : lifetimeEngCoine;
    const prevCoins = isPeriodSpecific
      ? prevPeriodCoinsMap.get(pIdStr) || 0
      : Math.max(0, lifetimeEngCoine - (recent7dCoinsMap.get(pIdStr) || 0));

    return {
      _id: p._id,
      playerId: p._id,
      firstName: p.firstName || null,
      lastName: p.lastName || null,
      userName:
        p.userName ||
        (p.firstName ? `${p.firstName} ${p.lastName || ""}`.trim() : "Player"),
      profile: p.profile || null,
      jerseyNumber: p.jerseyNumber || null,
      position: p.position || null,
      ageGroup: p.ageGroup || null,
      team: p.selectTeam || null,
      marketValue: p.marketValue || 0,
      engCoine: effectiveCoins,
      lifetimeEngCoine,
      periodCoins: effectiveCoins,
      prevCoins,
      goals: stats.goals,
      totalGoals: stats.goals,
      assists: stats.assists,
      totalAssists: stats.assists,
      cleanSheets: stats.cleanSheets,
      totalCleanSheets: stats.cleanSheets,
      playerOfTheDay: stats.playerOfTheDay,
      totalPlayerOfTheDay: stats.playerOfTheDay,
      timeframe: tf,
      score,
      stats: {
        ...stats,
        score,
      },
      prevStats,
    };
  });
};

// 1. ⚽ TOP GOAL SCORERS (Supports limit=100 for sections, Top 20 for Home, Rank Movement Arrows)
const getTopGoalScorersFromDB = async (query?: Record<string, any>) => {
  const isHome = query?.isHome === "true" || query?.home === "true";
  const defaultLimit = isHome ? 20 : 100;
  const limit = parseInt(query?.limit as string) || defaultLimit;
  const enriched = await getEnrichedPlayersWithStats(query);

  const eligible = enriched.filter((p) => (p.goals || 0) > 0);

  const sorted = [...eligible].sort((a, b) => {
    if (b.goals !== a.goals) return b.goals - a.goals;
    if (b.playerOfTheDay !== a.playerOfTheDay) return b.playerOfTheDay - a.playerOfTheDay;
    if (b.engCoine !== a.engCoine) return b.engCoine - a.engCoine;
    return b.marketValue - a.marketValue;
  });

  const baselineCompareFn = (a: any, b: any) => {
    const aPrev = a.prevStats?.goals ?? 0;
    const bPrev = b.prevStats?.goals ?? 0;
    if (bPrev !== aPrev) return bPrev - aPrev;
    const aPOTD = a.prevStats?.playerOfTheDay ?? 0;
    const bPOTD = b.prevStats?.playerOfTheDay ?? 0;
    if (bPOTD !== aPOTD) return bPOTD - aPOTD;
    return (b.marketValue || 0) - (a.marketValue || 0);
  };

  return attachRankAndMovement(sorted, baselineCompareFn, limit);
};

// 2. 👟 TOP ASSIST PLAYERS (Supports limit=100 for sections, Top 20 for Home, Rank Movement Arrows)
const getTopAssistsFromDB = async (query?: Record<string, any>) => {
  const isHome = query?.isHome === "true" || query?.home === "true";
  const defaultLimit = isHome ? 20 : 100;
  const limit = parseInt(query?.limit as string) || defaultLimit;
  const enriched = await getEnrichedPlayersWithStats(query);

  const eligible = enriched.filter((p) => (p.assists || 0) > 0);

  const sorted = [...eligible].sort((a, b) => {
    if (b.assists !== a.assists) return b.assists - a.assists;
    if (b.playerOfTheDay !== a.playerOfTheDay) return b.playerOfTheDay - a.playerOfTheDay;
    if (b.engCoine !== a.engCoine) return b.engCoine - a.engCoine;
    return b.marketValue - a.marketValue;
  });

  const baselineCompareFn = (a: any, b: any) => {
    const aPrev = a.prevStats?.assists ?? 0;
    const bPrev = b.prevStats?.assists ?? 0;
    if (bPrev !== aPrev) return bPrev - aPrev;
    const aPOTD = a.prevStats?.playerOfTheDay ?? 0;
    const bPOTD = b.prevStats?.playerOfTheDay ?? 0;
    if (bPOTD !== aPOTD) return bPOTD - aPOTD;
    return (b.marketValue || 0) - (a.marketValue || 0);
  };

  return attachRankAndMovement(sorted, baselineCompareFn, limit);
};

// 3. 🧤 TOP CLEAN SHEETS (Goalkeepers Only, Supports limit=100 for sections, Top 20 for Home, Rank Movement Arrows)
const getTopCleanSheetsFromDB = async (query?: Record<string, any>) => {
  const isHome = query?.isHome === "true" || query?.home === "true";
  const defaultLimit = isHome ? 20 : 100;
  const limit = parseInt(query?.limit as string) || defaultLimit;
  const enriched = await getEnrichedPlayersWithStats(query);

  // 🧤 Filter ONLY Goalkeepers with cleanSheets > 0
  const goalkeepers = enriched.filter((p) => {
    const pos = (p.position || "").toString().trim();
    const isGK =
      /^(goalkeeper|gk|goal\s*keeper)$/i.test(pos) ||
      /gk|goalkeeper/i.test(pos);
    return isGK && (p.cleanSheets || 0) > 0;
  });

  const sorted = [...goalkeepers].sort((a, b) => {
    if (b.cleanSheets !== a.cleanSheets) return b.cleanSheets - a.cleanSheets;
    if (b.playerOfTheDay !== a.playerOfTheDay) return b.playerOfTheDay - a.playerOfTheDay;
    if (b.engCoine !== a.engCoine) return b.engCoine - a.engCoine;
    return (b.marketValue || 0) - (a.marketValue || 0);
  });

  const baselineCompareFn = (a: any, b: any) => {
    const aPrev = a.prevStats?.cleanSheets ?? 0;
    const bPrev = b.prevStats?.cleanSheets ?? 0;
    if (bPrev !== aPrev) return bPrev - aPrev;
    const aPOTD = a.prevStats?.playerOfTheDay ?? 0;
    const bPOTD = b.prevStats?.playerOfTheDay ?? 0;
    if (bPOTD !== aPOTD) return bPOTD - aPOTD;
    return (b.marketValue || 0) - (a.marketValue || 0);
  };

  return attachRankAndMovement(sorted, baselineCompareFn, limit);
};

// 4. 🌟 TOP OVERALL BEST PLAYERS (Coin-wise: match-earned coins for weekly/monthly, total engCoine for overall)
const getTopOverallPlayersFromDB = async (query?: Record<string, any>) => {
  const isHome = query?.isHome === "true" || query?.home === "true";
  const defaultLimit = isHome ? 20 : 100;
  const limit = parseInt(query?.limit as string) || defaultLimit;
  const enriched = await getEnrichedPlayersWithStats(query);

  const eligible = enriched.filter((p) => (Number(p.engCoine) || 0) > 0);

  const sorted = [...eligible].sort((a, b) => {
    const aCoins = Number(a.engCoine) || 0;
    const bCoins = Number(b.engCoine) || 0;
    if (bCoins !== aCoins) return bCoins - aCoins;

    if (b.score !== a.score) return b.score - a.score;
    if (b.goals !== a.goals) return b.goals - a.goals;
    if (b.assists !== a.assists) return b.assists - a.assists;

    const aMarket = Number(a.marketValue) || 0;
    const bMarket = Number(b.marketValue) || 0;
    return bMarket - aMarket;
  });

  const baselineCompareFn = (a: any, b: any) => {
    const aPrevCoins = Number(a.prevCoins) || 0;
    const bPrevCoins = Number(b.prevCoins) || 0;
    if (bPrevCoins !== aPrevCoins) return bPrevCoins - aPrevCoins;
    const aPrevScore = (a.prevStats?.goals ?? 0) * 4 + (a.prevStats?.assists ?? 0) * 3;
    const bPrevScore = (b.prevStats?.goals ?? 0) * 4 + (b.prevStats?.assists ?? 0) * 3;
    if (bPrevScore !== aPrevScore) return bPrevScore - aPrevScore;
    return (b.marketValue || 0) - (a.marketValue || 0);
  };

  return attachRankAndMovement(sorted, baselineCompareFn, limit);
};

// Helper to fetch leaderboard for a single timeframe
const fetchLeaderboardByTimeframe = async (query?: Record<string, any>, tf: string = "overall") => {
  const limit = parseInt(query?.limit as string) || (query?.isHome === "true" ? 20 : 50);
  const queryWithTf = {
    ...query,
    timeframe: tf,
    limit,
  };

  const [topGoalScorers, topAssists, topCleanSheets, topOverallPlayers] = await Promise.all([
    getTopGoalScorersFromDB(queryWithTf),
    getTopAssistsFromDB(queryWithTf),
    getTopCleanSheetsFromDB(queryWithTf),
    getTopOverallPlayersFromDB(queryWithTf),
  ]);

  return {
    timeframe: tf,
    topGoalScorers,
    topAssists,
    topCleanSheets,
    topOverallPlayers,
  };
};

// 5. 🏆 UNIFIED LEADERBOARDS (Supports timeframe=weekly | monthly | overall | all)
const getLeaderboardsFromDB = async (query?: Record<string, any>): Promise<any> => {
  const requestedTf = (query?.timeframe || query?.period || "overall").toString().toLowerCase();

  // If client requests "all", fetch weekly, monthly, and overall in parallel
  if (requestedTf === "all") {
    const [weekly, monthly, overall] = await Promise.all([
      fetchLeaderboardByTimeframe(query, "weekly"),
      fetchLeaderboardByTimeframe(query, "monthly"),
      fetchLeaderboardByTimeframe(query, "overall"),
    ]);

    return {
      weekly,
      monthly,
      overall,
    };
  }

  // Normalize single timeframe
  let normalizedTf = "overall";
  if (requestedTf === "weekly" || requestedTf === "week" || requestedTf === "this_week") {
    normalizedTf = "weekly";
  } else if (requestedTf === "monthly" || requestedTf === "month" || requestedTf === "this_month") {
    normalizedTf = "monthly";
  }

  return fetchLeaderboardByTimeframe(query, normalizedTf);
};

export const StatisticService = {
  getTopPlayerFromDB,
  getPlayerSeasonStatsFromDB,
  getLeagueSummaryFromDB,
  getSeasonLeaderboardFromDB,
  getTopGoalScorersFromDB,
  getTopAssistsFromDB,
  getTopCleanSheetsFromDB,
  getTopOverallPlayersFromDB,
  getLeaderboardsFromDB,
};