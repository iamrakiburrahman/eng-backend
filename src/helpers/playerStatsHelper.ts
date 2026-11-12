import mongoose, { Types } from "mongoose";
import { MatchResult } from "../app/modules/matchResult/matchResult.model";
import { PlayerStats } from "../app/modules/playerStats/playerStats.model";
import { MatchEvaluation } from "../app/modules/refereeRating/refereeRating.model";
import { Match } from "../app/modules/match/match.model";
import { MatchPlayerSelection } from "../app/modules/matchPlayerSelection/matchPlayerSelection.model";

export interface IPlayerStatsDetails {
  goals: number;
  assists: number;
  cleanSheets: number;
  playerOfTheDay: number;
  yellowCards: number;
  redCards: number;
  totalMatches: number;
  matchesPlayed: number;
}

/**
 * Calculates complete player statistics including:
 * - Goals
 * - Assists
 * - Clean Sheets
 * - Player Of The Day (Man of the Match)
 * - Yellow Cards
 * - Red Cards
 */
export const getPlayerStatsSummary = async (
  playerId: string | Types.ObjectId
): Promise<IPlayerStatsDetails> => {
  const playerObjectId =
    typeof playerId === "string" ? new mongoose.Types.ObjectId(playerId) : playerId;

  // 1. Aggregate from MatchResult (direct events + assists in eventMeta)
  const [
    matchResults,
    evalMatches,
    mrPOTDMatches,
    manualStats,
    mpsMatches,
    mrAllMatches,
    reviewMatches,
  ] = await Promise.all([
    MatchResult.aggregate([
      {
        $match: {
          $or: [
            { player: playerObjectId },
            { "eventMeta.assist": playerObjectId },
          ],
        },
      },
      {
        $group: {
          _id: null,
          goals: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$player", playerObjectId] },
                    { $eq: ["$eventType", "goal"] },
                    { $ne: ["$eventMeta.goalType", "own_goal"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          assistsDirect: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$player", playerObjectId] },
                    { $eq: ["$eventType", "assist"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          assistsMeta: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$eventMeta.assist", playerObjectId] },
                    { $eq: ["$eventType", "goal"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          yellowCards: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$player", playerObjectId] },
                    { $eq: ["$eventType", "yellow_card"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          redCards: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$player", playerObjectId] },
                    { $eq: ["$eventType", "red_card"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          cleanSheets: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$player", playerObjectId] },
                    { $eq: ["$eventType", "clean_sheet"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          playerOfTheDayEvents: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$player", playerObjectId] },
                    {
                      $in: [
                        "$eventType",
                        ["player_of_the_day", "man_of_the_match"],
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    MatchEvaluation.find({
      manOfTheMatch: playerObjectId,
    }).distinct("match"),
    MatchResult.find({
      player: playerObjectId,
      eventType: { $in: ["player_of_the_day", "man_of_the_match"] },
    }).distinct("match"),
    PlayerStats.find({ player: playerObjectId }).lean(),
    MatchPlayerSelection.find({ "players.player": playerObjectId }).distinct("match"),
    MatchResult.find({
      $or: [
        { player: playerObjectId },
        { "eventMeta.assist": playerObjectId },
      ],
    }).distinct("match"),
    Match.find({ "matchReview.player": playerObjectId }).distinct("_id"),
  ]);

  const candidateMatchIds = Array.from(
    new Set([
      ...(mpsMatches || []).map((m: any) => String(m)),
      ...(mrAllMatches || []).map((m: any) => String(m)),
      ...(reviewMatches || []).map((m: any) => String(m)),
    ])
  )
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const validExistingMatches =
    candidateMatchIds.length > 0
      ? await Match.find({
          _id: { $in: candidateMatchIds },
          status: { $ne: "cancelled" },
        }).distinct("_id")
      : [];
  const dynamicTotalMatches = validExistingMatches.length;

  const mr = matchResults[0] || {};
  const goalsMR = Number(mr.goals) || 0;
  const assistsMR = (Number(mr.assistsDirect) || 0) + (Number(mr.assistsMeta) || 0);
  const yellowMR = Number(mr.yellowCards) || 0;
  const redMR = Number(mr.redCards) || 0;
  const cleanMR = Number(mr.cleanSheets) || 0;
  const uniquePOTDMatchIds = new Set([
    ...(evalMatches || []).map((m: any) => String(m)),
    ...(mrPOTDMatches || []).map((m: any) => String(m)),
  ]);
  const potdMR = uniquePOTDMatchIds.size;

  let psGoals = 0;
  let psAssists = 0;
  let psYellow = 0;
  let psRed = 0;
  let psClean = 0;
  let psPOTD = 0;
  let psTotalMatches = 0;

  if (Array.isArray(manualStats)) {
    for (const stats of manualStats) {
      psGoals += Number(stats.goals) || 0;
      psAssists += Number(stats.assists) || 0;
      psYellow += Number(stats.yellowCards) || 0;
      psRed += Number(stats.redCards) || 0;
      psClean += Number(stats.cleanSheets) || 0;
      psPOTD += Number(stats.playerOfTheDay) || 0;
      psTotalMatches +=
        Number((stats as any).totalMatches || (stats as any).matchesPlayed) || 0;
    }
  }

  const finalTotalMatches = Math.max(dynamicTotalMatches, psTotalMatches);

  return {
    goals: Math.max(goalsMR, psGoals),
    assists: Math.max(assistsMR, psAssists),
    cleanSheets: Math.max(cleanMR, psClean),
    playerOfTheDay: Math.max(potdMR, psPOTD),
    yellowCards: Math.max(yellowMR, psYellow),
    redCards: Math.max(redMR, psRed),
    totalMatches: finalTotalMatches,
    matchesPlayed: finalTotalMatches,
  };
};

/**
 * Calculates player statistics in batch for multiple players.
 */
export const getBatchPlayerStatsSummary = async (
  playerIds: (string | Types.ObjectId)[],
  options?: {
    matchFilter?: any;
    matchEvaluationFilter?: any;
    matchSelectionFilter?: any;
    matchReviewFilter?: any;
    validMatchFilter?: any;
    includeManualStats?: boolean;
    manualStatsLeagueIds?: (string | Types.ObjectId)[];
  }
): Promise<Map<string, IPlayerStatsDetails>> => {
  const result = new Map<string, IPlayerStatsDetails>();

  if (!playerIds || playerIds.length === 0) {
    return result;
  }

  const objectIds = playerIds
    .filter((id) => Types.ObjectId.isValid(id as any))
    .map((id) => new mongoose.Types.ObjectId(id as any));

  if (objectIds.length === 0) {
    return result;
  }

  // Initialize all requested player IDs with 0
  objectIds.forEach((id) => {
    result.set(id.toString(), {
      goals: 0,
      assists: 0,
      cleanSheets: 0,
      playerOfTheDay: 0,
      yellowCards: 0,
      redCards: 0,
      totalMatches: 0,
      matchesPlayed: 0,
    });
  });

  const includeManualStats = options?.includeManualStats !== false;
  const manualLeagueObjectIds = (options?.manualStatsLeagueIds || [])
    .filter((id) => Types.ObjectId.isValid(id as any))
    .map((id) => new mongoose.Types.ObjectId(id as any));
  const playerStatsFilter: any = { player: { $in: objectIds } };
  if (manualLeagueObjectIds.length > 0) {
    playerStatsFilter.league = { $in: manualLeagueObjectIds };
  }

  const [
    matchResults,
    evalPOTDMatches,
    mrPOTDMatches,
    manualStats,
    mpsSelections,
    allMatchResultsForAppearances,
    reviewMatches,
  ] = await Promise.all([
    MatchResult.aggregate([
      {
        $match: {
          ...(options?.matchFilter || {}),
          $or: [
            { player: { $in: objectIds } },
            { "eventMeta.assist": { $in: objectIds } },
          ],
        },
      },
      {
        $facet: {
          directEvents: [
            {
              $match: { player: { $in: objectIds } },
            },
            {
              $group: {
                _id: { player: "$player", eventType: "$eventType" },
                count: { $sum: 1 },
              },
            },
          ],
          assistsFromMeta: [
            {
              $match: {
                "eventMeta.assist": { $in: objectIds },
                eventType: "goal",
              },
            },
            {
              $group: {
                _id: "$eventMeta.assist",
                count: { $sum: 1 },
              },
            },
          ],
        },
      },
    ]),
    MatchEvaluation.aggregate([
      {
        $match: {
          manOfTheMatch: { $in: objectIds },
          ...(options?.matchEvaluationFilter || {}),
        },
      },
      {
        $group: {
          _id: { player: "$manOfTheMatch", match: "$match" },
        },
      },
    ]),
    MatchResult.aggregate([
      {
        $match: {
          player: { $in: objectIds },
          eventType: { $in: ["player_of_the_day", "man_of_the_match"] },
          ...(options?.matchFilter || {}),
        },
      },
      {
        $group: {
          _id: { player: "$player", match: "$match" },
        },
      },
    ]),
    includeManualStats
      ? PlayerStats.find(playerStatsFilter).lean()
      : Promise.resolve([]),
    MatchPlayerSelection.aggregate([
      ...(options?.matchSelectionFilter
        ? [{ $match: options.matchSelectionFilter }]
        : []),
      { $unwind: "$players" },
      { $match: { "players.player": { $in: objectIds } } },
      { $group: { _id: { player: "$players.player", match: "$match" } } },
    ]),
    MatchResult.aggregate([
      {
        $match: {
          ...(options?.matchFilter || {}),
          $or: [
            { player: { $in: objectIds } },
            { "eventMeta.assist": { $in: objectIds } },
          ],
        },
      },
      {
        $project: {
          match: 1,
          players: ["$player", "$eventMeta.assist"],
        },
      },
      { $unwind: "$players" },
      { $match: { players: { $in: objectIds } } },
      { $group: { _id: { player: "$players", match: "$match" } } },
    ]),
    Match.aggregate([
      {
        $match: {
          status: { $ne: "cancelled" },
          ...(options?.matchReviewFilter || {}),
        },
      },
      { $unwind: "$matchReview" },
      { $match: { "matchReview.player": { $in: objectIds } } },
      { $group: { _id: { player: "$matchReview.player", match: "$_id" } } },
    ]),
  ]);

  const facet = matchResults[0] || { directEvents: [], assistsFromMeta: [] };

  // Map direct events (goals, assists, cards, clean sheets)
  facet.directEvents?.forEach((item: any) => {
    const pId = item._id?.player?.toString();
    const eventType = item._id?.eventType;
    if (!pId || !result.has(pId)) return;

    const stats = result.get(pId)!;
    if (eventType === "goal") stats.goals += item.count;
    if (eventType === "assist") stats.assists += item.count;
    if (eventType === "yellow_card") stats.yellowCards += item.count;
    if (eventType === "red_card") stats.redCards += item.count;
    if (eventType === "clean_sheet") stats.cleanSheets += item.count;
  });

  // Map assist in eventMeta
  facet.assistsFromMeta?.forEach((item: any) => {
    const pId = item._id?.toString();
    if (!pId || !result.has(pId)) return;
    result.get(pId)!.assists += item.count;
  });

  // Deduplicate Player of the Day by distinct match ID
  const playerPOTDMatches = new Map<string, Set<string>>();
  evalPOTDMatches?.forEach((item: any) => {
    const pId = item._id?.player?.toString();
    const mId = item._id?.match?.toString();
    if (pId && mId) {
      if (!playerPOTDMatches.has(pId)) playerPOTDMatches.set(pId, new Set());
      playerPOTDMatches.get(pId)!.add(mId);
    }
  });
  mrPOTDMatches?.forEach((item: any) => {
    const pId = item._id?.player?.toString();
    const mId = item._id?.match?.toString();
    if (pId && mId) {
      if (!playerPOTDMatches.has(pId)) playerPOTDMatches.set(pId, new Set());
      playerPOTDMatches.get(pId)!.add(mId);
    }
  });

  playerPOTDMatches.forEach((matches, pId) => {
    if (result.has(pId)) {
      result.get(pId)!.playerOfTheDay = matches.size;
    }
  });

  // Gather all unique match IDs to verify they exist and are not cancelled
  const candidateMatchIdSet = new Set<string>();
  mpsSelections?.forEach((item: any) => {
    if (item._id?.match) candidateMatchIdSet.add(item._id.match.toString());
  });
  allMatchResultsForAppearances?.forEach((item: any) => {
    if (item._id?.match) candidateMatchIdSet.add(item._id.match.toString());
  });

  const validMatchObjectIds = Array.from(candidateMatchIdSet)
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const validExistingMatchIds =
    validMatchObjectIds.length > 0
      ? await Match.find({
          _id: { $in: validMatchObjectIds },
          status: { $ne: "cancelled" },
          ...(options?.validMatchFilter || {}),
        }).distinct("_id")
      : [];

  const validMatchSet = new Set(validExistingMatchIds.map((m: any) => String(m)));

  // Track matches per player
  const playerMatchesMap = new Map<string, Set<string>>();

  const addMatchForPlayer = (pId: string, mId: string) => {
    if (!playerMatchesMap.has(pId)) {
      playerMatchesMap.set(pId, new Set());
    }
    playerMatchesMap.get(pId)!.add(mId);
  };

  mpsSelections?.forEach((item: any) => {
    const pId = item._id?.player?.toString();
    const mId = item._id?.match?.toString();
    if (pId && mId && validMatchSet.has(mId)) {
      addMatchForPlayer(pId, mId);
    }
  });

  allMatchResultsForAppearances?.forEach((item: any) => {
    const pId = item._id?.player?.toString();
    const mId = item._id?.match?.toString();
    if (pId && mId && validMatchSet.has(mId)) {
      addMatchForPlayer(pId, mId);
    }
  });

  // reviewMatches are queried from Match directly with status != cancelled
  reviewMatches?.forEach((item: any) => {
    const pId = item._id?.player?.toString();
    const mId = item._id?.match?.toString();
    if (pId && mId) {
      addMatchForPlayer(pId, mId);
    }
  });

  playerMatchesMap.forEach((matches, pId) => {
    if (result.has(pId)) {
      result.get(pId)!.totalMatches = matches.size;
      result.get(pId)!.matchesPlayed = matches.size;
    }
  });

  // Sum manual/upserted stats from PlayerStats for each player
  const summedManualMap = new Map<string, any>();
  manualStats?.forEach((item: any) => {
    const pId = item.player?.toString();
    if (!pId) return;

    const existing = summedManualMap.get(pId) || {
      goals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      cleanSheets: 0,
      playerOfTheDay: 0,
      totalMatches: 0,
      matchesPlayed: 0,
    };

    summedManualMap.set(pId, {
      goals: existing.goals + (Number(item.goals) || 0),
      assists: existing.assists + (Number(item.assists) || 0),
      yellowCards: existing.yellowCards + (Number(item.yellowCards) || 0),
      redCards: existing.redCards + (Number(item.redCards) || 0),
      cleanSheets: existing.cleanSheets + (Number(item.cleanSheets) || 0),
      playerOfTheDay: existing.playerOfTheDay + (Number(item.playerOfTheDay) || 0),
      totalMatches:
        existing.totalMatches +
        (Number((item as any).totalMatches || (item as any).matchesPlayed) || 0),
      matchesPlayed:
        existing.matchesPlayed +
        (Number((item as any).matchesPlayed || (item as any).totalMatches) || 0),
    });
  });

  // Merge summed manual stats with dynamic match results
  summedManualMap.forEach((item: any, pId: string) => {
    if (!result.has(pId)) return;

    const stats = result.get(pId)!;
    stats.goals = Math.max(stats.goals, item.goals);
    stats.assists = Math.max(stats.assists, item.assists);
    stats.yellowCards = Math.max(stats.yellowCards, item.yellowCards);
    stats.redCards = Math.max(stats.redCards, item.redCards);
    stats.cleanSheets = Math.max(stats.cleanSheets, item.cleanSheets);
    stats.playerOfTheDay = Math.max(stats.playerOfTheDay, item.playerOfTheDay);
    stats.totalMatches = Math.max(stats.totalMatches, item.totalMatches);
    stats.matchesPlayed = Math.max(stats.matchesPlayed, item.matchesPlayed);
  });

  return result;
};
