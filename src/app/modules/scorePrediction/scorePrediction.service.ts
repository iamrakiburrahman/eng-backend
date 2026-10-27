import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { IScorePredictionRound } from './scorePrediction.interface';
import { ScorePredictionRound, UserScorePrediction } from './scorePrediction.model';
import { Match } from '../match/match.model';
import { User } from '../user/user.model';
import { CoinTransaction } from '../coinTransaction/coinTransaction.model';
import { COIN_TRANSACTION_CATEGORY } from '../coinTransaction/coinTransaction.interface';
import { Types } from 'mongoose';
import { recordCoinTransaction } from '../../../helpers/coinLedgerHelper';
import { resolveEffectivePlayerForAction } from '../../../helpers/playerProfileResolver';

const parseRoundPayload = (payload: any): any => {
  const data = { ...payload };

  if (typeof data.matches === 'string') {
    try {
      data.matches = JSON.parse(data.matches);
    } catch {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid JSON for matches.');
    }
  }

  if (data.coinsPerExactScore !== undefined) {
    data.coinsPerExactScore = Number(data.coinsPerExactScore);
  }
  if (data.coinsPerCorrectOutcome !== undefined) {
    data.coinsPerCorrectOutcome = Number(data.coinsPerCorrectOutcome);
  }
  if (data.jackpotBonusCoins !== undefined) {
    data.jackpotBonusCoins = Number(data.jackpotBonusCoins);
  }
  if (data.lockTime) {
    data.lockTime = new Date(data.lockTime);
  }

  if (!data.league || data.league === 'all' || data.league === '' || data.league === 'null') {
    delete data.league;
  }

  return data;
};

const createPredictionRoundInDB = async (payload: Partial<IScorePredictionRound>): Promise<IScorePredictionRound> => {
  const data = parseRoundPayload(payload);

  if (!data.title || !data.matches || !data.lockTime) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Missing required fields (title, matches, lockTime).'
    );
  }

  if (!Array.isArray(data.matches) || data.matches.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Must select at least 1 match (up to 5 fixtures).');
  }

  const round = await ScorePredictionRound.create(data);
  return round;
};

const getAllPredictionRoundsFromDB = async (
  query: Record<string, unknown>
): Promise<{ data: any[]; total: number; page: number; limit: number; totalPages: number }> => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};

  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }

  if (query.searchTerm) {
    const searchRegex = new RegExp(String(query.searchTerm), 'i');
    filter.$or = [{ title: searchRegex }, { description: searchRegex }];
  }

  const [rounds, total] = await Promise.all([
    ScorePredictionRound.find(filter)
      .populate('league', 'leagueName season ageGroup')
      .populate({
        path: 'matches',
        select: 'homeTeam awayTeam matchDate venueName status homeScore awayScore',
        populate: [
          { path: 'homeTeam', select: 'teamName shortName teamLogo' },
          { path: 'awayTeam', select: 'teamName shortName teamLogo' },
        ],
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ScorePredictionRound.countDocuments(filter),
  ]);

  return {
    data: rounds,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

const getSinglePredictionRoundFromDB = async (id: string): Promise<any> => {
  const round = await ScorePredictionRound.findById(id)
    .populate('league', 'leagueName season ageGroup')
    .populate({
      path: 'matches',
      select: 'homeTeam awayTeam matchDate venueName status homeScore awayScore formation',
      populate: [
        { path: 'homeTeam', select: 'teamName shortName teamLogo' },
        { path: 'awayTeam', select: 'teamName shortName teamLogo' },
      ],
    })
    .lean();

  if (!round) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Score prediction round not found.');
  }

  return round;
};

const getActivePredictionRoundsForClientFromDB = async (
  query: Record<string, unknown>,
  currentUserId?: string,
  requestedProfileId?: string
): Promise<any[]> => {
  const now = new Date();

  // Find active rounds that haven't locked yet (or recently locked)
  const filter: Record<string, any> = {
    status: { $in: ['active', 'locked'] },
  };

  if ((query as any).leagueId || (query as any).league) {
    filter.league = (query as any).leagueId || (query as any).league;
  }

  const rounds = await ScorePredictionRound.find(filter)
    .populate('league', 'leagueName season ageGroup')
    .populate({
      path: 'matches',
      select: 'homeTeam awayTeam matchDate venueName status homeScore awayScore',
      populate: [
        { path: 'homeTeam', select: 'teamName shortName teamLogo' },
        { path: 'awayTeam', select: 'teamName shortName teamLogo' },
      ],
    })
    .sort({ lockTime: 1 })
    .lean();

  let userPredictionsMap = new Map<string, any>();
  if (currentUserId && rounds.length > 0) {
    let effectivePlayerId = currentUserId;
    try {
      const resolved = await resolveEffectivePlayerForAction(currentUserId, requestedProfileId);
      if (resolved?._id) {
        effectivePlayerId = resolved._id.toString();
      }
    } catch {
      // Fallback to currentUserId
    }

    const roundIds = rounds.map((r) => r._id);
    const userPredictions = await UserScorePrediction.find({
      round: { $in: roundIds },
      user: effectivePlayerId,
    }).lean();

    userPredictions.forEach((up) => {
      userPredictionsMap.set(up.round.toString(), up);
    });
  }

  return rounds.map((round) => {
    const userPred = userPredictionsMap.get(round._id.toString());
    const isLocked = new Date(round.lockTime) <= now;

    return {
      _id: round._id,
      title: round.title,
      description: round.description,
      banner: round.banner,
      league: round.league,
      matches: round.matches,
      totalMatches: Array.isArray(round.matches) ? round.matches.length : 0,
      lockTime: round.lockTime,
      status: isLocked && round.status === 'active' ? 'locked' : round.status,
      isLocked,
      coinsPerExactScore: round.coinsPerExactScore,
      coinsPerCorrectOutcome: round.coinsPerCorrectOutcome,
      jackpotBonusCoins: round.jackpotBonusCoins,
      totalParticipants: round.totalParticipants,
      hasPredicted: Boolean(userPred),
      myPrediction: userPred || null,
    };
  });
};

const submitUserPredictionInDB = async (
  roundId: string,
  userId: string,
  submittedPredictions: any[]
): Promise<any> => {
  const round = await ScorePredictionRound.findById(roundId);
  if (!round) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Prediction round not found.');
  }

  const now = new Date();
  if (round.status !== 'active') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This prediction round is not currently active.');
  }

  if (new Date(round.lockTime) <= now) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Prediction deadline has passed. Round is locked.');
  }

  if (!Array.isArray(submittedPredictions) || submittedPredictions.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Must provide predictions for the matches.');
  }

  const roundMatchIds = new Set(round.matches.map((m) => m.toString()));

  const formattedPredictions = submittedPredictions.map((sp) => {
    // Support both match and matchId (and _id / id)
    const rawMatchId = sp.matchId || sp.match || sp.id || sp._id;
    const matchIdStr = rawMatchId ? rawMatchId.toString() : '';

    if (!matchIdStr || !roundMatchIds.has(matchIdStr)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Match ${matchIdStr || 'unknown'} is not part of this round.`
      );
    }

    const homeScore = Math.max(
      0,
      parseInt(String(sp.homeScore ?? sp.predictedHomeScore ?? 0), 10) || 0
    );
    const awayScore = Math.max(
      0,
      parseInt(String(sp.awayScore ?? sp.predictedAwayScore ?? 0), 10) || 0
    );

    return {
      match: new Types.ObjectId(matchIdStr),
      predictedHomeScore: homeScore,
      predictedAwayScore: awayScore,
      status: 'pending' as const,
    };
  });

  // Check if existing
  const existing = await UserScorePrediction.findOne({ round: roundId, user: userId });

  let predictionDoc;
  if (existing) {
    existing.predictions = formattedPredictions as any;
    existing.submittedAt = now;
    predictionDoc = await existing.save();
  } else {
    predictionDoc = await UserScorePrediction.create({
      round: roundId,
      user: userId,
      predictions: formattedPredictions,
      submittedAt: now,
    });

    await ScorePredictionRound.findByIdAndUpdate(roundId, {
      $inc: { totalParticipants: 1, totalPredictions: formattedPredictions.length },
    });
  }

  return predictionDoc;
};

const settlePredictionRoundInDB = async (roundId: string): Promise<any> => {
  const round = await ScorePredictionRound.findById(roundId).populate('matches');
  if (!round) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Prediction round not found.');
  }

  const matches = (round.matches as any[]) || [];
  if (matches.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Round has no matches to evaluate.');
  }

  // Check how many matches are finished
  const matchesMap = new Map<string, any>();
  matches.forEach((m) => {
    matchesMap.set(m._id.toString(), m);
  });

  // Fetch all user predictions for this round
  const userPredictions = await UserScorePrediction.find({ round: roundId });

  let totalDistributedCoins = 0;
  let totalExactCount = 0;
  let totalWinnersCount = 0;

  for (const up of userPredictions) {
    let exactMatches = 0;
    let outcomeMatches = 0;
    let totalCoins = 0;

    const evaluatedPredictions = up.predictions.map((p) => {
      const actualMatch = matchesMap.get(p.match.toString());
      if (!actualMatch) return p;

      const actHome = typeof actualMatch.homeScore === 'number' ? actualMatch.homeScore : null;
      const actAway = typeof actualMatch.awayScore === 'number' ? actualMatch.awayScore : null;

      if (actHome === null || actAway === null) {
        return p; // match not played/scored yet
      }

      const isExact = p.predictedHomeScore === actHome && p.predictedAwayScore === actAway;

      // Calculate outcome (1 = Home Win, 0 = Draw, -1 = Away Win)
      const predOutcome = Math.sign(p.predictedHomeScore - p.predictedAwayScore);
      const actOutcome = Math.sign(actHome - actAway);
      const isOutcome = !isExact && predOutcome === actOutcome;

      let coinForThis = 0;
      let status: 'exact' | 'outcome' | 'missed' = 'missed';

      if (isExact) {
        coinForThis = round.coinsPerExactScore || 50;
        exactMatches += 1;
        totalExactCount += 1;
        status = 'exact';
      } else if (isOutcome) {
        coinForThis = round.coinsPerCorrectOutcome || 10;
        outcomeMatches += 1;
        status = 'outcome';
      }

      totalCoins += coinForThis;

      return {
        match: p.match,
        predictedHomeScore: p.predictedHomeScore,
        predictedAwayScore: p.predictedAwayScore,
        actualHomeScore: actHome,
        actualAwayScore: actAway,
        isExactMatch: isExact,
        isOutcomeMatch: isOutcome,
        coinsAwarded: coinForThis,
        status,
      };
    });

    // Jackpot bonus if all 5 exact!
    const isJackpot = matches.length === 5 && exactMatches === 5;
    if (isJackpot && round.jackpotBonusCoins > 0) {
      totalCoins += round.jackpotBonusCoins;
    }

    up.predictions = evaluatedPredictions as any;
    up.totalExactMatches = exactMatches;
    up.totalOutcomeMatches = outcomeMatches;
    up.totalCoinsEarned = totalCoins;

    // Award coins to player wallet if > 0 and not yet awarded
    if (totalCoins > 0 && !up.hasClaimedOrAwarded) {
      try {
        await recordCoinTransaction({
          userId: up.user.toString(),
          amount: totalCoins,
          category: COIN_TRANSACTION_CATEGORY.SCORE_PREDICTION_REWARD,
          title: `Score Prediction Reward: ${round.title}`,
          description: `Predicted ${exactMatches} exact scores and ${outcomeMatches} correct outcomes.`,
          referenceId: `${round._id.toString()}_prediction_reward`,
        });

        up.hasClaimedOrAwarded = true;
        totalDistributedCoins += totalCoins;
        totalWinnersCount += 1;
      } catch (coinErr) {
        console.error('Failed to record coin transaction for score prediction:', coinErr);
      }
    }

    await up.save();
  }

  // Update round status
  round.isSettled = true;
  round.status = 'settled';
  round.settledAt = new Date();
  round.totalCoinsDistributed = (round.totalCoinsDistributed || 0) + totalDistributedCoins;
  await round.save();

  return {
    roundId: round._id,
    title: round.title,
    totalParticipants: userPredictions.length,
    totalWinners: totalWinnersCount,
    totalExactScores: totalExactCount,
    totalCoinsDistributed: totalDistributedCoins,
    isSettled: true,
  };
};

const getRoundLeaderboardFromDB = async (roundId: string, limit = 25): Promise<any[]> => {
  return UserScorePrediction.find({ round: roundId })
    .populate('user', 'firstName lastName profile userName')
    .sort({ totalExactMatches: -1, totalCoinsEarned: -1, submittedAt: 1 })
    .limit(limit)
    .lean();
};

const getMyPredictionsFromDB = async (userId: string): Promise<any[]> => {
  return UserScorePrediction.find({ user: userId })
    .populate({
      path: 'round',
      select: 'title banner lockTime status coinsPerExactScore jackpotBonusCoins',
    })
    .populate({
      path: 'predictions.match',
      select: 'homeTeam awayTeam matchDate venueName status homeScore awayScore',
      populate: [
        { path: 'homeTeam', select: 'teamName shortName teamLogo' },
        { path: 'awayTeam', select: 'teamName shortName teamLogo' },
      ],
    })
    .sort({ submittedAt: -1 })
    .lean();
};

const updatePredictionRoundInDB = async (
  id: string,
  payload: Partial<IScorePredictionRound>
): Promise<IScorePredictionRound | null> => {
  const data = parseRoundPayload(payload);
  const updated = await ScorePredictionRound.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Prediction round not found.');
  }
  return updated;
};

const deletePredictionRoundInDB = async (id: string): Promise<IScorePredictionRound | null> => {
  const deleted = await ScorePredictionRound.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Prediction round not found.');
  }
  await UserScorePrediction.deleteMany({ round: id });
  return deleted;
};

export const ScorePredictionService = {
  createPredictionRoundInDB,
  getAllPredictionRoundsFromDB,
  getSinglePredictionRoundFromDB,
  getActivePredictionRoundsForClientFromDB,
  submitUserPredictionInDB,
  settlePredictionRoundInDB,
  getRoundLeaderboardFromDB,
  getMyPredictionsFromDB,
  updatePredictionRoundInDB,
  deletePredictionRoundInDB,
};
