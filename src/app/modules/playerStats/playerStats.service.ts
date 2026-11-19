import { Types } from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { USER_ROLES } from '../../../enums/user';
import { Subscription } from '../subscription/subscription.model';
import { PlayerStats } from './playerStats.model';
import { JwtPayload } from 'jsonwebtoken';
import { getPlayerStatsSummary } from '../../../helpers/playerStatsHelper';
import pick from '../../../shared/pick';

const EDITABLE_PLAYER_STAT_FIELDS = [
  'goals',
  'assists',
  'cleanSheets',
  'playerOfTheDay',
  'totalMatches',
  'matchesPlayed',
  'yellowCards',
  'redCards',
] as const;

const checkCanViewOtherPlayerStats = async (user?: JwtPayload | null): Promise<boolean> => {
  if (!user || user.role !== USER_ROLES.PLAYER) return true;

  const userId = user._id || user.id;

  const subscription = await Subscription.findOne({
    user: userId,
    status: 'active',
  }).populate('package');

  if (subscription && subscription.package) {
    const pkg = subscription.package as any;
    if (pkg.canViewOtherPlayerStats === false || pkg.packageType === 'Semi Pro') {
      return false;
    }
  }
  return true;
};

// GET ALL (LEADERBOARD)
const getAllPlayerStatsFromDB = async (user?: JwtPayload | null) => {
  const canViewOther = await checkCanViewOtherPlayerStats(user);

  const filter: Record<string, any> = {};
  if (!canViewOther && user) {
    filter.player = user._id || user.id;
  }

  return await PlayerStats.find(filter)
    .populate('player', 'name image firstName lastName profile')
    .populate('team', 'teamName teamLogo')
    .sort({ goals: -1, assists: -1 });
};

// GET SINGLE PLAYER
const getSinglePlayerStatsFromDB = async (playerId: string, user?: JwtPayload | null) => {
  const currentUserId = user ? (user._id || user.id) : null;

  if (user && user.role === USER_ROLES.PLAYER && currentUserId && currentUserId.toString() !== playerId.toString()) {
    const canViewOther = await checkCanViewOtherPlayerStats(user);
    if (!canViewOther) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Your package (Semi Pro) does not allow viewing other players' stats."
      );
    }
  }

  const [result, stats] = await Promise.all([
    PlayerStats.findOne({ player: playerId })
      .populate('player', 'name image firstName lastName profile')
      .populate('team', 'teamName teamLogo shortName'),
    getPlayerStatsSummary(playerId),
  ]);

  return {
    ...(result ? result.toObject() : {}),
    player: (result as any)?.player || null,
    team: (result as any)?.team || null,
    goals: stats.goals,
    assists: stats.assists,
    cleanSheets: stats.cleanSheets,
    playerOfTheDay: stats.playerOfTheDay,
    yellowCards: stats.yellowCards,
    redCards: stats.redCards,
    totalMatches: stats.totalMatches,
    matchesPlayed: stats.matchesPlayed,
    stats: {
      goals: stats.goals,
      assists: stats.assists,
      cleanSheets: stats.cleanSheets,
      playerOfTheDay: stats.playerOfTheDay,
      yellowCards: stats.yellowCards,
      redCards: stats.redCards,
      totalMatches: stats.totalMatches,
      matchesPlayed: stats.matchesPlayed,
    },
  };
};

// ADMIN UPDATE
const updatePlayerStatsFromDB = async (
  playerId: string,
  payload: any
) => {
  if (!Types.ObjectId.isValid(playerId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid player ID');
  }

  const existing = await PlayerStats.findOne({ player: playerId });

  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Player stats not found');
  }

  const rawPicked = pick(payload, EDITABLE_PLAYER_STAT_FIELDS);
  const safePayload: Record<string, number> = {};
  for (const [key, val] of Object.entries(rawPicked)) {
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, `${key} must be a non-negative number`);
    }
    safePayload[key] = num;
  }

  return await PlayerStats.findOneAndUpdate(
    { player: playerId },
    {
      $set: safePayload,
    },
    {
      new: true,
      runValidators: true,
    }
  );
};

export const PlayerStatsService = {
  getAllPlayerStatsFromDB,
  getSinglePlayerStatsFromDB,
  updatePlayerStatsFromDB,
};