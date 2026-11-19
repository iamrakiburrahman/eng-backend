import { Team } from "../team/team.model";
import { MatchEvaluation } from "./refereeRating.model";
import { ClubEconomy } from "../coinAndBudget/clubEconomySchema.model";
import { Match } from "../match/match.model";
import { getEffectiveMatchSetting } from "../match/matchSetting.model";
import { awardClubCoinsSafely, rollbackClubCoinsSafely } from "../match/match.service";
import { TEAM_COIN_CATEGORY } from "../teamCoinTransaction/teamCoinTransaction.interface";
import ApiError from "../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

// Dynamically get coin and market value reward based on rating from ClubEconomy config
// Rating tiers:
// - Rating: Elite (9.0 - 10.0)
// - Rating: Great (8.0 - 8.9)
// - Rating: Good (7.0 - 7.9)
// - Below 7.0: 0 coin, 0 budget (Coins are NEVER deducted)
const getConductReward = async (rating: number): Promise<{ coin: number; budgetValue: number }> => {
  if (rating == null || isNaN(rating)) {
    return { coin: 0, budgetValue: 0 };
  }

  const ce = await ClubEconomy.findOne();

  // Normalize in case rating was passed as percentage (e.g. 85 -> 8.5)
  const r = rating > 10 ? rating / 10 : rating;

  // 10/10 - Exceptional
  if (r >= 10) {
    return {
      coin: Number(ce?.exceptionalConduct?.coin) || 0,
      budgetValue: Number(ce?.exceptionalConduct?.budgetValue) || 0,
    };
  }

  // 8-9/10 - Good
  if (r >= 8.0) {
    return {
      coin: Number(ce?.goodConduct?.coin) || 0,
      budgetValue: Number(ce?.goodConduct?.budgetValue) || 0,
    };
  }

  // 6-7/10 - Satisfactory
  if (r >= 6.0) {
    return {
      coin: Number(ce?.satisfactoryConduct?.coin) || 0,
      budgetValue: Number(ce?.satisfactoryConduct?.budgetValue) || 0,
    };
  }

  // 5/10 - Average/Neutral
  if (r >= 5.0) {
    return {
      coin: Number(ce?.averageConduct?.coin) || 0,
      budgetValue: Number(ce?.averageConduct?.budgetValue) || 0,
    };
  }

  // 3-4/10 - Poor
  if (r >= 3.0) {
    return {
      coin: Number(ce?.poorConduct?.coin) || 0,
      budgetValue: Number(ce?.poorConduct?.budgetValue) || 0,
    };
  }

  // 1-2/10 - Unprofessional
  return {
    coin: Number(ce?.unprofessionalConduct?.coin) || 0,
    budgetValue: Number(ce?.unprofessionalConduct?.budgetValue) || 0,
  };
};

// CREATE EVALUATION
const createEvaluationIntoDB = async (payload: any, userRole?: string) => {
  if (!payload.match) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Match ID is required");
  }

  const match = await Match.findById(payload.match);
  if (!match) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Match not found");
  }

  // ⏰ Dynamic Feedback Window (Admin Configurable)
  const setting = await getEffectiveMatchSetting();

  // If match is not marked finished, mark it finished upon review submission so evaluation succeeds smoothly
  if (match.status !== "finished") {
    match.status = "finished";
    if (!match.finishedAt) {
      match.finishedAt = new Date();
    }
    match.timerStatus = "finished";
    match.timerStartedAt = null;
    await match.save();

    try {
      const { awardMatchCleanSheets } = await import("../../../helpers/matchCleanSheetHelper");
      const { awardMatchPlayerParticipation } = await import("../../../helpers/matchPlayerParticipationHelper");
      await awardMatchCleanSheets(match._id);
      await awardMatchPlayerParticipation(match._id);
    } catch (e) {
      console.error("Failed to auto-award match completion rewards in referee rating:", e);
    }
  }

  const isAdmin =
    userRole === "ADMIN" ||
    userRole === "SUPER_ADMIN" ||
    payload.isAdminOverride;

  if (!isAdmin && setting.isFeedbackWindowRestricted && setting.feedbackWindowHours > 0) {
    const finishTime = match.finishedAt || (match as any).updatedAt || match.matchDate;
    if (finishTime) {
      const targetTz = setting.timezone || "Europe/London";
      const nowUK = dayjs().tz(targetTz);
      const finishUK = dayjs(finishTime).tz(targetTz);
      const hoursSinceFinish = nowUK.diff(finishUK, "hour", true);
      if (hoursSinceFinish > setting.feedbackWindowHours) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Feedback window expired. Ratings cannot be submitted after ${setting.feedbackWindowHours} hours of match completion (${targetTz} Time)`,
        );
      }
    }
  }

  // Support both homeTeamRating and homeTeamConductRating from payload
  const homeRating =
    payload.homeTeamRating !== undefined
      ? payload.homeTeamRating
      : payload.homeTeamConductRating;

  const awayRating =
    payload.awayTeamRating !== undefined
      ? payload.awayTeamRating
      : payload.awayTeamConductRating;

  // Find existing evaluation if any (allow editing old games)
  const existingEval = await MatchEvaluation.findOne({ match: payload.match });

  // Preserve existing referee if current submission is from manager without referee field
  if (existingEval && !payload.referee && existingEval.referee) {
    payload.referee = existingEval.referee;
  }

  const previousMOTM = existingEval?.manOfTheMatch
    ? String(existingEval.manOfTheMatch)
    : null;
  const previousHomeRating = existingEval?.homeTeamRating;
  const previousAwayRating = existingEval?.awayTeamRating;

  payload.homeTeamRating = Number(homeRating);
  payload.awayTeamRating = Number(awayRating);

  let result;
  if (existingEval) {
    Object.assign(existingEval, payload);
    result = await existingEval.save();
  } else {
    result = await MatchEvaluation.create(payload);
  }

  // Adjust conduct coins safely (only if new or rating changed)
  const teams = [
    {
      teamId: payload.homeTeam,
      rating: Number(homeRating),
      prevRating: previousHomeRating,
    },
    {
      teamId: payload.awayTeam,
      rating: Number(awayRating),
      prevRating: previousAwayRating,
    },
  ];

  for (const item of teams) {
    if (!item.teamId || item.rating == null || isNaN(item.rating)) continue;

    const ratingChanged = !existingEval || item.prevRating !== item.rating;
    if (ratingChanged) {
      // Rollback previous conduct coins if already awarded
      if (
        item.prevRating !== undefined &&
        item.prevRating !== null &&
        !isNaN(item.prevRating)
      ) {
        const prevConduct = await getConductReward(item.prevRating);
        if (prevConduct.coin > 0 || prevConduct.budgetValue > 0) {
          await rollbackClubCoinsSafely(
            payload.match,
            item.teamId,
            prevConduct.coin,
            prevConduct.budgetValue,
          );
        }
      }

      // Award new conduct coins
      const { coin, budgetValue } = await getConductReward(item.rating);
      if (coin > 0 || budgetValue > 0) {
        await awardClubCoinsSafely(
          payload.match,
          item.teamId,
          coin,
          budgetValue,
          undefined,
          TEAM_COIN_CATEGORY.CONDUCT_RATING,
          "Referee Conduct Rating",
          `Referee conduct evaluation rating: ${item.rating}`
        );
      }
    }
  }

  // Reward Man of the Match / Player of the Day
  if (payload.manOfTheMatch) {
    const targetMOTM = String(payload.manOfTheMatch);
    const alreadyHadSameMOTM = previousMOTM === targetMOTM;

    if (!alreadyHadSameMOTM) {
      try {
        const { PlayerEconomy } = await import("../coinAndBudget/playerEconomySchema.model");
        const { PlayerStats } = await import("../playerStats/playerStats.model");
        const { NotificationQueueHelper } = await import("../../../helpers/bullMQ/bullHelper");
        const { NOTIFICATION_TYPE } = await import("../notification/notification.interface");
        const { isUserPremiumPlayer } = await import("../../../helpers/packageHelper");
        const { recordCoinTransaction } = await import("../../../helpers/coinLedgerHelper");
        const { COIN_TRANSACTION_CATEGORY } = await import("../coinTransaction/coinTransaction.interface");

        const pe = await PlayerEconomy.findOne().lean();
        const potdCoin = Number(pe?.playerOfTheDay?.coin) || 5000;

        let fixtureStr = "";
        try {
          const mDoc = await Match.findById(payload.match)
            .populate("homeTeam", "teamName shortName")
            .populate("awayTeam", "teamName shortName")
            .lean();
          if (mDoc) {
            const hName = (mDoc.homeTeam as any)?.teamName || (mDoc.homeTeam as any)?.shortName || "Home";
            const aName = (mDoc.awayTeam as any)?.teamName || (mDoc.awayTeam as any)?.shortName || "Away";
            fixtureStr = ` in ${hName} vs ${aName}`;
          }
        } catch (_) {}

        // Rollback previous MOTM player if different
        if (previousMOTM && previousMOTM !== targetMOTM) {
          await PlayerStats.findOneAndUpdate(
            { player: previousMOTM },
            { $inc: { playerOfTheDay: -1 } },
          );
          if (potdCoin > 0) {
            const isProOld = await isUserPremiumPlayer(previousMOTM);
            if (isProOld) {
              await recordCoinTransaction({
                userId: previousMOTM,
                amount: -potdCoin,
                category: COIN_TRANSACTION_CATEGORY.ROLLBACK,
                title: "Player of the Day Revoked",
                description: `Player of the Day award was reassigned by referee/admin${fixtureStr}`,
                matchId: payload.match,
                referenceId: `${payload.match.toString()}_motm_revoked`,
              });
            }
          }
        }

        // Award targetMOTM strictly through coin transaction ledger (guarded against duplicate)
        if (potdCoin > 0) {
          const { CoinTransaction } = await import("../coinTransaction/coinTransaction.model");
          const alreadyAwardedMOTM = await CoinTransaction.findOne({
            match: payload.match,
            user: targetMOTM,
            category: COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
          }).lean();

          if (!alreadyAwardedMOTM) {
            const isPro = await isUserPremiumPlayer(targetMOTM);
            if (isPro) {
              await recordCoinTransaction({
                userId: targetMOTM,
                amount: potdCoin,
                category: COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
                title: "Player of the Day Bonus",
                description: `Awarded Player of the Day / Man of the Match${fixtureStr}`,
                matchId: payload.match,
                referenceId: `${payload.match.toString()}_motm`,
              });
            }
          }
        }

        await PlayerStats.findOneAndUpdate(
          { player: targetMOTM },
          { $inc: { playerOfTheDay: 1 } },
          { upsert: true, new: true }
        );

        await NotificationQueueHelper.sendNotification(
          targetMOTM,
          "Congratulations! You were awarded Player of the Day / Man of the Match!",
          "Player of the Day!",
          NOTIFICATION_TYPE.MATCH_RESULT_PUBLISHED
        );
      } catch (motmErr) {
        console.error("Failed to process Man of the Match reward:", motmErr);
      }
    }

    await Match.findByIdAndUpdate(payload.match, {
      $set: { manOfTheMatch: payload.manOfTheMatch },
    });
  }

  return result;
};

// GET ALL
const getAllEvaluationsFromDB = async (query?: Record<string, any>) => {
  const filter: any = {};
  if (query?.match) filter.match = query.match;
  if (query?.referee) filter.referee = query.referee;
  if (query?.team) {
    filter.$or = [{ homeTeam: query.team }, { awayTeam: query.team }];
  }

  return await MatchEvaluation.find(filter)
    .populate('match')
    .populate('referee', 'name email firstName lastName profile')
    .populate('homeTeam', 'teamName teamLogo shortName')
    .populate('awayTeam', 'teamName teamLogo shortName')
    .populate('manOfTheMatch', 'name image firstName lastName userName profile')
    .populate('winningTeam', 'teamName teamLogo shortName')
    .sort({ createdAt: -1 });
};

// GET EVALUATION BY MATCH ID
const getEvaluationByMatchIdFromDB = async (matchId: string) => {
  return await MatchEvaluation.findOne({ match: matchId })
    .populate('match')
    .populate('referee', 'name email firstName lastName profile')
    .populate('homeTeam', 'teamName teamLogo shortName')
    .populate('awayTeam', 'teamName teamLogo shortName')
    .populate('manOfTheMatch', 'name image firstName lastName userName profile')
    .populate('winningTeam', 'teamName teamLogo shortName');
};

// GET SINGLE
const getSingleEvaluationFromDB = async (id: string) => {
  return await MatchEvaluation.findById(id)
    .populate('match')
    .populate('referee', 'name email firstName lastName profile')
    .populate('homeTeam', 'teamName teamLogo shortName')
    .populate('awayTeam', 'teamName teamLogo shortName')
    .populate('manOfTheMatch', 'name image firstName lastName userName profile')
    .populate('winningTeam', 'teamName teamLogo shortName');
};

export const MatchEvaluationService = {
  createEvaluationIntoDB,
  getAllEvaluationsFromDB,
  getEvaluationByMatchIdFromDB,
  getSingleEvaluationFromDB,
};