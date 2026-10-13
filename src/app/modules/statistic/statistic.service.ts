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
  leagueFilter: any
) => {
  const queryWithTf = {
    ...query,
    timeframe: tf,
    limit: 1,
  };

  const now = new Date();
  let timeFilter: any = null;
  if (tf === "this_week" || tf === "week" || tf === "weekly") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + diffToMonday);
    startOfWeek.setHours(0, 0, 0, 0);
    timeFilter = { createdAt: { $gte: startOfWeek } };
  } else if (tf === "this_month" || tf === "month" || tf === "monthly") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    timeFilter = { createdAt: { $gte: startOfMonth } };
  }

  const goalMatchFilter: any = {
    ...leagueFilter,
    eventType: "goal",
  };
  const assistMatchFilter: any = {
    ...leagueFilter,
    eventType: "assist",
  };

  if (timeFilter) {
    Object.assign(goalMatchFilter, timeFilter);
    Object.assign(assistMatchFilter, timeFilter);
  }

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
      filterConditions.$or = [
        { leagueName: { $regex: leagueName.trim(), $options: "i" } },
        { name: { $regex: leagueName.trim(), $options: "i" } },
      ];
    }
    if (season && season.trim()) {
      filterConditions.season = { $regex: season.trim(), $options: "i" };
    }

    const leagues = await League.find(filterConditions).select("_id");
    leagues.forEach((l) => {
      if (!matchedLeagueIds.some((id) => id.toString() === l._id.toString())) {
        matchedLeagueIds.push(l._id);
      }
    });
  }

  const leagueFilter: any = {};
  if (matchedLeagueIds.length > 0) {
    const matchesInLeague = await Match.find({
      league: { $in: matchedLeagueIds },
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
      fetchLeagueSummaryStatsByTimeframe(query, "weekly", leagueFilter),
      fetchLeagueSummaryStatsByTimeframe(query, "monthly", leagueFilter),
      fetchLeagueSummaryStatsByTimeframe(query, "overall", leagueFilter),
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
    fetchLeagueSummaryStatsByTimeframe(query, normalizedTf, leagueFilter),
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

  // 🕒 TIMEFRAME DATE BOUNDARIES (Overall, This Month, This Week)
  const tf = (timeframe || period || "overall").toString().toLowerCase();
  let timeFilter: any = null;
  let prevTimeFilter: any = null;

  const now = new Date();
  if (tf === "this_week" || tf === "week" || tf === "weekly") {
    const day = now.getDay() || 7;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - day + 1);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfPrevWeek = new Date(startOfWeek);
    startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);

    timeFilter = { createdAt: { $gte: startOfWeek } };
    prevTimeFilter = { createdAt: { $gte: startOfPrevWeek, $lt: startOfWeek } };
  } else if (tf === "this_month" || tf === "month" || tf === "monthly") {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    startOfPrevMonth.setHours(0, 0, 0, 0);

    timeFilter = { createdAt: { $gte: startOfMonth } };
    prevTimeFilter = { createdAt: { $gte: startOfPrevMonth, $lt: startOfMonth } };
  } else {
    // Overall: Baseline comparison with stats from 7 days prior for rank delta arrows
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    prevTimeFilter = { createdAt: { $lt: sevenDaysAgo } };
  }

  const matchedLeagueIds: mongoose.Types.ObjectId[] = [];
  if (directLeagueId && mongoose.Types.ObjectId.isValid(directLeagueId as string)) {
    matchedLeagueIds.push(new mongoose.Types.ObjectId(directLeagueId as string));
  }

  if (leagueName || season) {
    const filterConditions: any = {};
    if (leagueName && leagueName.trim()) {
      filterConditions.$or = [
        { leagueName: { $regex: leagueName.trim(), $options: "i" } },
        { name: { $regex: leagueName.trim(), $options: "i" } },
      ];
    }
    if (season && season.trim()) {
      filterConditions.season = { $regex: season.trim(), $options: "i" };
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
  let teamIdsInLeague: mongoose.Types.ObjectId[] = [];

  if (matchedLeagueIds.length > 0) {
    const [matchesInLeague, leagueTeamLinks, directTeams] = await Promise.all([
      Match.find({ league: { $in: matchedLeagueIds } }).select("_id homeTeam awayTeam"),
      LeagueTeam.find({ league: { $in: matchedLeagueIds } }).select("team"),
      Team.find({ league: { $in: matchedLeagueIds } }).select("_id"),
    ]);

    const matchIds = matchesInLeague.map((m) => m._id);
    const leagueTeamIds = leagueTeamLinks.map((lt) => lt.team).filter(Boolean);
    const directTeamIds = directTeams.map((t) => t._id).filter(Boolean);
    const matchTeamIds = matchesInLeague.flatMap((m) => [m.homeTeam, m.awayTeam]).filter(Boolean);

    teamIdsInLeague = [
      ...new Set([...leagueTeamIds, ...directTeamIds, ...matchTeamIds].map((id) => id.toString())),
    ].map((id) => new mongoose.Types.ObjectId(id));

    if (!teamIdsInLeague.length) {
      return [];
    }

    const baseMatchFilter: any = {
      $or: [
        { league: { $in: matchedLeagueIds } },
        { match: { $in: matchIds } },
      ],
    };
    if (timeFilter) {
      Object.assign(baseMatchFilter, timeFilter);
    }

    matchFilterOptions = {
      matchFilter: baseMatchFilter,
      matchEvaluationFilter: {
        match: { $in: matchIds },
      },
    };
  } else if (timeFilter) {
    matchFilterOptions = {
      matchFilter: timeFilter,
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
    userFilter.ageGroup = { $regex: new RegExp(`^${ageGroup.toString().trim()}$`, "i") };
  }

  if (teamId) {
    userFilter.selectTeam = mongoose.Types.ObjectId.isValid(teamId as string)
      ? new mongoose.Types.ObjectId(teamId as string)
      : teamId;
  } else if (teamIdsInLeague.length > 0) {
    userFilter.selectTeam = { $in: teamIdsInLeague };
  }

  if (playerSearch && playerSearch.trim()) {
    const searchRegex = new RegExp(playerSearch.trim(), "i");
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

  // Baseline filter for rank movements
  const prevMatchFilterOptions: any = prevTimeFilter
    ? {
        matchFilter: {
          ...(matchFilterOptions?.matchFilter || {}),
          ...prevTimeFilter,
        },
        matchEvaluationFilter: matchFilterOptions?.matchEvaluationFilter,
      }
    : undefined;

  const [statsMap, prevStatsMap] = await Promise.all([
    getBatchPlayerStatsSummary(playerIds, matchFilterOptions),
    prevMatchFilterOptions
      ? getBatchPlayerStatsSummary(playerIds, prevMatchFilterOptions)
      : Promise.resolve(new Map<string, IPlayerStatsDetails>()),
  ]);

  return players.map((p: any) => {
    const stats: IPlayerStatsDetails = statsMap.get(p._id.toString()) || {
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      playerOfTheDay: 0,
      yellowCards: 0,
      redCards: 0,
      totalMatches: 0,
      matchesPlayed: 0,
    };

    const prevStats: IPlayerStatsDetails = prevStatsMap.get(p._id.toString()) || {
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
      engCoine: p.engCoine || 0,
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

  const sorted = [...enriched].sort((a, b) => {
    if (b.goals !== a.goals) return b.goals - a.goals;
    if (b.playerOfTheDay !== a.playerOfTheDay) return b.playerOfTheDay - a.playerOfTheDay;
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

  const sorted = [...enriched].sort((a, b) => {
    if (b.assists !== a.assists) return b.assists - a.assists;
    if (b.playerOfTheDay !== a.playerOfTheDay) return b.playerOfTheDay - a.playerOfTheDay;
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

  // 🧤 Filter ONLY Goalkeepers (position: Goalkeeper / GK / Goal Keeper)
  const goalkeepers = enriched.filter((p) => {
    const pos = (p.position || "").toString().trim();
    return (
      /^(goalkeeper|gk|goal\s*keeper)$/i.test(pos) ||
      /gk|goalkeeper/i.test(pos)
    );
  });

  const sorted = [...goalkeepers].sort((a, b) => {
    if (b.cleanSheets !== a.cleanSheets) return b.cleanSheets - a.cleanSheets;
    if (b.playerOfTheDay !== a.playerOfTheDay) return b.playerOfTheDay - a.playerOfTheDay;
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

// 4. 🌟 TOP OVERALL BEST PLAYERS (Max Coin / engCoine Wise, Supports limit=100 for sections, Top 20 for Home, Rank Movement Arrows)
const getTopOverallPlayersFromDB = async (query?: Record<string, any>) => {
  const isHome = query?.isHome === "true" || query?.home === "true";
  const defaultLimit = isHome ? 20 : 100;
  const limit = parseInt(query?.limit as string) || defaultLimit;
  const enriched = await getEnrichedPlayersWithStats(query);

  const tf = (query?.timeframe || query?.period || "overall").toString().toLowerCase();
  const isPeriodSpecific =
    tf === "weekly" ||
    tf === "week" ||
    tf === "this_week" ||
    tf === "monthly" ||
    tf === "month" ||
    tf === "this_month";

  // When viewing weekly or monthly, sort by performance score earned in that timeframe
  // When viewing overall, sort strictly by max lifetime coins (engCoine), then marketValue
  const sorted = [...enriched].sort((a, b) => {
    if (isPeriodSpecific) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.goals !== a.goals) return b.goals - a.goals;
      if (b.assists !== a.assists) return b.assists - a.assists;
      return (b.marketValue || 0) - (a.marketValue || 0);
    }

    const aCoins = Number(a.engCoine) || 0;
    const bCoins = Number(b.engCoine) || 0;
    if (bCoins !== aCoins) return bCoins - aCoins;

    const aMarket = Number(a.marketValue) || 0;
    const bMarket = Number(b.marketValue) || 0;
    return bMarket - aMarket;
  });

  const baselineCompareFn = (a: any, b: any) => {
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