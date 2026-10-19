import mongoose, { Types } from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { IPlayerVoting, TVotingStatus, TVotingType } from './playerVoting.interface';
import { PlayerVote, PlayerVoting } from './playerVoting.model';
import { User } from '../user/user.model';
import { League } from '../league/league.model';

// Helper to auto-sync statuses based on current date/time
const autoSyncPollStatus = async (poll: any) => {
  const now = new Date();
  if (poll.status === 'upcoming' && poll.startDate <= now && poll.endDate >= now) {
    poll.status = 'active';
    await PlayerVoting.findByIdAndUpdate(poll._id, { status: 'active' });
  } else if (poll.status === 'active' && poll.endDate < now) {
    poll.status = 'completed';
    // Determine winner
    let maxVotes = -1;
    let winnerId = null;
    for (const nom of poll.nominees || []) {
      if (nom.votesCount > maxVotes) {
        maxVotes = nom.votesCount;
        winnerId = nom.player;
      }
    }
    const updateData: Record<string, any> = { status: 'completed' };
    if (winnerId && maxVotes > 0) {
      updateData.winner = winnerId;
      updateData.winnerVotes = maxVotes;
      poll.winner = winnerId;
      poll.winnerVotes = maxVotes;
    }
    await PlayerVoting.findByIdAndUpdate(poll._id, updateData);
  }
};

const createVotingPollToDB = async (
  userId: string,
  payload: Partial<IPlayerVoting>
): Promise<IPlayerVoting> => {
  const { title, votingType, league, ageGroup, startDate, endDate, nominees } = payload;

  if (!title || !votingType || !league || !ageGroup || !startDate || !endDate) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Missing required fields (title, votingType, league, ageGroup, startDate, endDate).'
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid startDate or endDate format.');
  }

  if (start >= end) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'startDate must be before endDate.');
  }

  // Verify league exists
  const existingLeague = await League.findById(league);
  if (!existingLeague) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Specified League was not found.');
  }

  // Verify nominees
  if (!Array.isArray(nominees) || nominees.length < 2) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'A voting poll must have at least 2 pre-selected player nominees.'
    );
  }

  // Check for duplicate players in nominees
  const playerIds = nominees.map((n) => n.player.toString());
  const uniquePlayerIds = new Set(playerIds);
  if (uniquePlayerIds.size !== playerIds.length) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Duplicate players cannot be added as nominees in the same voting round.'
    );
  }

  // Verify all nominee players exist in User collection
  const existingUsersCount = await User.countDocuments({
    _id: { $in: Array.from(uniquePlayerIds) },
  });
  if (existingUsersCount !== uniquePlayerIds.size) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'One or more selected nominee players do not exist in the database.'
    );
  }

  // Determine initial status based on current time
  const now = new Date();
  let status: TVotingStatus = payload.status || 'upcoming';
  if (!payload.status) {
    if (now >= start && now <= end) {
      status = 'active';
    } else if (now > end) {
      status = 'completed';
    } else {
      status = 'upcoming';
    }
  }

  const pollData = {
    ...payload,
    startDate: start,
    endDate: end,
    status,
    totalVotes: 0,
    createdBy: new Types.ObjectId(userId),
    nominees: nominees.map((n) => ({
      player: new Types.ObjectId(n.player),
      team: n.team ? new Types.ObjectId(n.team) : undefined,
      statsHighlight: n.statsHighlight || '',
      votesCount: 0,
    })),
  };

  const result = await PlayerVoting.create(pollData);
  return result;
};

const getAllVotingPollsFromDB = async (
  query: Record<string, unknown>
): Promise<{
  data: IPlayerVoting[];
  pagination: { total: number; page: number; limit: number; totalPage: number };
}> => {
  const page = Number(query.pageNumber) || Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};

  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }

  if (query.votingType && query.votingType !== 'all') {
    filter.votingType = query.votingType;
  }

  if (query.league && query.league !== 'all') {
    filter.league = query.league;
  }

  if (query.ageGroup && query.ageGroup !== 'all') {
    filter.ageGroup = query.ageGroup;
  }

  if (query.searchValue) {
    const searchRegex = new RegExp(String(query.searchValue), 'i');
    filter.$or = [{ title: searchRegex }, { ageGroup: searchRegex }, { season: searchRegex }];
  }

  const [polls, total] = await Promise.all([
    PlayerVoting.find(filter)
      .populate('league', 'leagueName season ageGroup')
      .populate('nominees.player', 'firstName lastName profile userName position')
      .populate('nominees.team', 'teamName logo')
      .populate('winner', 'firstName lastName profile userName')
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PlayerVoting.countDocuments(filter),
  ]);

  // Background auto-sync statuses
  setImmediate(async () => {
    for (const p of polls) {
      await autoSyncPollStatus(p);
    }
  });

  return {
    data: polls as IPlayerVoting[],
    pagination: {
      total,
      page,
      limit,
      totalPage: Math.ceil(total / limit) || 1,
    },
  };
};

const getSingleVotingPollFromDB = async (
  id: string,
  currentUserId?: string
): Promise<any> => {
  const poll = await PlayerVoting.findById(id)
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position')
    .populate('nominees.team', 'teamName logo')
    .populate('winner', 'firstName lastName profile userName')
    .populate('createdBy', 'firstName lastName email')
    .lean();

  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Voting poll not found.');
  }

  await autoSyncPollStatus(poll);

  // Calculate vote percentages
  const totalVotes = poll.totalVotes || 0;
  const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
    const percentage = totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
    return {
      ...nom,
      votePercentage: percentage,
    };
  });

  // Check if current user has voted in this poll
  let hasVoted = false;
  let userVotedPlayerId: string | null = null;

  if (currentUserId) {
    const voteRecord = await PlayerVote.findOne({
      votingId: poll._id,
      userId: currentUserId,
    }).lean();

    if (voteRecord) {
      hasVoted = true;
      userVotedPlayerId = voteRecord.playerId?.toString() || null;
    }
  }

  return {
    ...poll,
    nominees: nomineesWithStats,
    hasVoted,
    userVotedPlayerId,
  };
};

const getActiveVotingPollsForClientFromDB = async (
  query: Record<string, unknown>,
  currentUserId?: string
): Promise<any[]> => {
  const now = new Date();

  // Find all active or newly starting polls
  const filter: Record<string, any> = {
    status: { $in: ['active', 'upcoming'] },
    endDate: { $gte: now },
  };

  if (query.leagueId || query.league) {
    filter.league = query.leagueId || query.league;
  }

  if (query.ageGroup && query.ageGroup !== 'all') {
    filter.ageGroup = query.ageGroup;
  }

  if (query.votingType || query.type) {
    filter.votingType = query.votingType || query.type;
  }

  const polls = await PlayerVoting.find(filter)
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position')
    .populate('nominees.team', 'teamName logo')
    .sort({ isFeatured: -1, startDate: 1 })
    .lean();

  // Check user votes in batch if logged in
  let userVotesMap = new Map<string, string>();
  if (currentUserId && polls.length > 0) {
    const pollIds = polls.map((p) => p._id);
    const votes = await PlayerVote.find({
      votingId: { $in: pollIds },
      userId: currentUserId,
    }).lean();

    votes.forEach((v) => {
      userVotesMap.set(v.votingId.toString(), v.playerId.toString());
    });
  }

  // Format with percentages and user vote status
  const formattedPolls = polls.map((poll) => {
    const totalVotes = poll.totalVotes || 0;
    const hasVoted = userVotesMap.has(poll._id.toString());
    const userVotedPlayerId = userVotesMap.get(poll._id.toString()) || null;

    const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
      const percentage = totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      return {
        ...nom,
        votePercentage: percentage,
        isUserChoice: userVotedPlayerId === nom.player?._id?.toString(),
      };
    });

    return {
      ...poll,
      nominees: nomineesWithStats,
      hasVoted,
      userVotedPlayerId,
    };
  });

  return formattedPolls;
};

const castVoteInDB = async (
  votingId: string,
  userId: string,
  playerId: string,
  ipAddress?: string
): Promise<any> => {
  const poll = await PlayerVoting.findById(votingId);
  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Voting poll not found.');
  }

  const now = new Date();

  // Validate timing
  if (poll.status !== 'active') {
    if (poll.status === 'upcoming') {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Voting has not started yet.');
    }
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This voting round is already closed.');
  }

  if (poll.startDate > now) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Voting period has not started yet.');
  }

  if (poll.endDate < now) {
    poll.status = 'completed';
    await poll.save();
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Voting period has expired.');
  }

  // Check if target matches either player ID or nominee subdocument _id
  const nomineeIndex = poll.nominees.findIndex((n: any) => {
    const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
    const subId = n._id ? n._id.toString() : '';
    return pId === playerId || subId === playerId;
  });

  if (nomineeIndex === -1) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'The selected player or nominee is not a nominee in this voting round.'
    );
  }

  const targetNominee = poll.nominees[nomineeIndex];
  const resolvedPlayerId = targetNominee.player?._id
    ? targetNominee.player._id.toString()
    : targetNominee.player.toString();
  const nomineeDocId = (targetNominee as any)._id?.toString();

  // Check if user already voted (also guarded by unique compound index)
  const existingVote = await PlayerVote.findOne({
    votingId: poll._id,
    userId,
  });

  if (existingVote) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'You have already cast your vote in this voting round.'
    );
  }

  // Create vote record
  try {
    await PlayerVote.create({
      votingId: poll._id,
      userId: new Types.ObjectId(userId),
      playerId: new Types.ObjectId(resolvedPlayerId),
      ipAddress,
    });
  } catch (err: any) {
    if (err.code === 11000) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'You have already cast your vote in this voting round.'
      );
    }
    throw err;
  }

  // Increment nominee vote count and total votes atomically
  const queryFilter: any = { _id: poll._id };
  if (nomineeDocId) {
    queryFilter['nominees._id'] = new Types.ObjectId(nomineeDocId);
  } else {
    queryFilter['nominees.player'] = new Types.ObjectId(resolvedPlayerId);
  }

  const updatedPoll = await PlayerVoting.findOneAndUpdate(
    queryFilter,
    {
      $inc: {
        'nominees.$.votesCount': 1,
        totalVotes: 1,
      },
    },
    { new: true }
  )
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position')
    .populate('nominees.team', 'teamName logo')
    .lean();

  const totalVotes = updatedPoll?.totalVotes || 1;
  const nomineesWithStats = (updatedPoll?.nominees || []).map((nom: any) => ({
    ...nom,
    votePercentage: Number(((nom.votesCount / totalVotes) * 100).toFixed(1)),
    isUserChoice: nom.player?._id?.toString() === resolvedPlayerId,
  }));

  return {
    ...updatedPoll,
    nominees: nomineesWithStats,
    hasVoted: true,
    userVotedPlayerId: resolvedPlayerId,
  };
};

const updateVotingPollInDB = async (
  id: string,
  payload: Partial<IPlayerVoting>
): Promise<IPlayerVoting | null> => {
  const existingPoll = await PlayerVoting.findById(id);
  if (!existingPoll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Voting poll not found.');
  }

  if (payload.startDate && payload.endDate) {
    const start = new Date(payload.startDate);
    const end = new Date(payload.endDate);
    if (start >= end) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'startDate must be before endDate.');
    }
  }

  // If nominees are updated, preserve existing vote counts for matched players
  if (Array.isArray(payload.nominees) && payload.nominees.length >= 2) {
    const playerVotesMap = new Map<string, number>();
    existingPoll.nominees.forEach((n) => {
      playerVotesMap.set(n.player.toString(), n.votesCount || 0);
    });

    payload.nominees = payload.nominees.map((n) => ({
      player: new Types.ObjectId(n.player),
      team: n.team ? new Types.ObjectId(n.team) : undefined,
      statsHighlight: n.statsHighlight || '',
      votesCount: playerVotesMap.get(n.player.toString()) || 0,
    }));
  }

  const result = await PlayerVoting.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  })
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position')
    .populate('nominees.team', 'teamName logo')
    .populate('winner', 'firstName lastName profile userName');

  return result;
};

const deleteVotingPollInDB = async (id: string): Promise<IPlayerVoting | null> => {
  const poll = await PlayerVoting.findById(id);
  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Voting poll not found.');
  }

  // Delete all votes associated with this poll
  await Promise.all([
    PlayerVoting.findByIdAndDelete(id),
    PlayerVote.deleteMany({ votingId: id }),
  ]);

  return poll;
};

const toggleVotingStatusInDB = async (
  id: string,
  status: TVotingStatus
): Promise<IPlayerVoting | null> => {
  const poll = await PlayerVoting.findById(id);
  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Voting poll not found.');
  }

  const updateData: Record<string, any> = { status };

  // If completing poll, automatically set the winner with most votes
  if (status === 'completed') {
    let maxVotes = -1;
    let winnerPlayerId: Types.ObjectId | null = null;

    for (const nom of poll.nominees || []) {
      if (nom.votesCount > maxVotes) {
        maxVotes = nom.votesCount;
        winnerPlayerId = nom.player;
      }
    }

    if (winnerPlayerId && maxVotes > 0) {
      updateData.winner = winnerPlayerId;
      updateData.winnerVotes = maxVotes;
    }
  }

  const result = await PlayerVoting.findByIdAndUpdate(id, updateData, {
    new: true,
  })
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position')
    .populate('nominees.team', 'teamName logo')
    .populate('winner', 'firstName lastName profile userName');

  return result;
};

const getVotingLeaderboardOrResultsFromDB = async (id: string): Promise<any> => {
  const poll = await PlayerVoting.findById(id)
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position selectTeam')
    .populate('nominees.team', 'teamName logo')
    .populate('winner', 'firstName lastName profile userName')
    .lean();

  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Voting poll not found.');
  }

  const totalVotes = poll.totalVotes || 0;

  // Rank nominees by votesCount descending
  const rankedNominees = [...(poll.nominees || [])]
    .sort((a, b) => b.votesCount - a.votesCount)
    .map((nom: any, index: number) => {
      const percentage = totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      return {
        rank: index + 1,
        ...nom,
        votePercentage: percentage,
        isLeading: index === 0 && nom.votesCount > 0,
      };
    });

  return {
    ...poll,
    nominees: rankedNominees,
  };
};

const getPastWinnersFromDB = async (
  query: Record<string, unknown>
): Promise<{
  winners: any[];
  total: number;
}> => {
  const filter: Record<string, any> = {
    status: 'completed',
    winner: { $exists: true, $ne: null },
  };

  if (query.votingType || query.type) {
    filter.votingType = query.votingType || query.type;
  }

  if (query.leagueId || query.league) {
    filter.league = query.leagueId || query.league;
  }

  if (query.ageGroup && query.ageGroup !== 'all') {
    filter.ageGroup = query.ageGroup;
  }

  if (query.season) {
    filter.season = query.season;
  }

  const winners = await PlayerVoting.find(filter)
    .populate('winner', 'firstName lastName profile userName position')
    .populate('league', 'leagueName season ageGroup')
    .sort({ endDate: -1, createdAt: -1 })
    .lean();

  return {
    total: winners.length,
    winners,
  };
};

const getMyVotesFromDB = async (userId: string): Promise<any[]> => {
  const votes = await PlayerVote.find({ userId })
    .populate({
      path: 'votingId',
      populate: [
        { path: 'league', select: 'leagueName season ageGroup' },
        { path: 'winner', select: 'firstName lastName profile userName' },
      ],
    })
    .populate('playerId', 'firstName lastName profile userName position')
    .sort({ createdAt: -1 })
    .lean();

  return votes;
};

export const PlayerVotingService = {
  createVotingPollToDB,
  getAllVotingPollsFromDB,
  getSingleVotingPollFromDB,
  getActiveVotingPollsForClientFromDB,
  castVoteInDB,
  updateVotingPollInDB,
  deleteVotingPollInDB,
  toggleVotingStatusInDB,
  getVotingLeaderboardOrResultsFromDB,
  getPastWinnersFromDB,
  getMyVotesFromDB,
};
