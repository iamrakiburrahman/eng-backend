import mongoose, { Types } from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { IPlayerVoting, TVotingStatus, TVotingType } from './playerVoting.interface';
import { PlayerVote, PlayerVoting } from './playerVoting.model';
import { User } from '../user/user.model';
import { League } from '../league/league.model';
import { recordCoinTransaction } from '../../../helpers/coinLedgerHelper';
import { COIN_TRANSACTION_CATEGORY } from '../coinTransaction/coinTransaction.interface';
import { PlayerEconomy } from '../coinAndBudget/playerEconomySchema.model';

// Helper to resolve effective voter (Main Account or Child Player Profile)
const resolveEffectiveVoter = async (
  userId: string,
  requestedProfileId?: string
): Promise<{ effectiveVoterId: string; effectiveVoterUser: any }> => {
  if (!requestedProfileId || requestedProfileId.toString() === userId.toString()) {
    const user = await User.findById(userId).select('_id firstName lastName userName role parentId').lean();
    return { effectiveVoterId: userId.toString(), effectiveVoterUser: user };
  }

  // Check if requestedProfileId is a child of userId (Parent voting as child player)
  const child = await User.findOne({
    _id: requestedProfileId,
    parentId: userId,
  })
    .select('_id firstName lastName userName role parentId')
    .lean();

  if (child) {
    return { effectiveVoterId: child._id.toString(), effectiveVoterUser: child };
  }

  // Check if userId is a child and requestedProfileId is their parent or sibling
  const user = await User.findById(userId).select('_id parentId').lean();
  if (user?.parentId) {
    // If requesting parent
    if (user.parentId.toString() === requestedProfileId.toString()) {
      const parent = await User.findById(requestedProfileId)
        .select('_id firstName lastName userName role parentId')
        .lean();
      return { effectiveVoterId: requestedProfileId.toString(), effectiveVoterUser: parent };
    }

    // If requesting sibling child profile under same parent
    const sibling = await User.findOne({
      _id: requestedProfileId,
      parentId: user.parentId,
    })
      .select('_id firstName lastName userName role parentId')
      .lean();

    if (sibling) {
      return { effectiveVoterId: sibling._id.toString(), effectiveVoterUser: sibling };
    }
  }

  throw new ApiError(
    StatusCodes.FORBIDDEN,
    'The selected player profile does not belong to your account.'
  );
};

// Helper to get all family profiles (Main Account + all child players) with vote statuses
const getFamilyProfilesWithVoteStatus = async (
  userId: string,
  votingId: string | Types.ObjectId,
  effectiveVoterId: string,
  pollNominees?: any[]
) => {
  const user = await User.findById(userId).select('_id firstName lastName userName role parentId').lean();
  if (!user) return [];

  const mainAccountId = user.parentId ? user.parentId.toString() : user._id.toString();
  const mainAccount = user.parentId
    ? await User.findById(user.parentId).select('_id firstName lastName userName role').lean()
    : user;

  const children = await User.find({ parentId: mainAccountId })
    .select('_id firstName lastName userName role')
    .lean();

  const allFamilyIds = [
    new Types.ObjectId(mainAccountId),
    ...children.map((c) => c._id),
  ];

  const familyVotes = await PlayerVote.find({
    votingId,
    userId: { $in: allFamilyIds },
  }).lean();

  let nomineesList = pollNominees;
  if (!nomineesList) {
    const pollDoc = await PlayerVoting.findById(votingId).select('nominees').lean();
    nomineesList = pollDoc?.nominees || [];
  }

  const familyVotesMap = new Map<string, { playerId: string; nomineeId?: string }>();
  familyVotes.forEach((v: any) => {
    familyVotesMap.set(v.userId.toString(), {
      playerId: v.playerId ? v.playerId.toString() : '',
      nomineeId: v.nomineeId ? v.nomineeId.toString() : undefined,
    });
  });

  const resolveNomineeId = (voteInfo?: { playerId: string; nomineeId?: string }) => {
    if (!voteInfo) return null;
    if (voteInfo.nomineeId) return voteInfo.nomineeId;
    if (nomineesList && Array.isArray(nomineesList)) {
      const matched = nomineesList.find((n: any) => {
        const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
        const subId = n._id ? n._id.toString() : '';
        return (voteInfo.nomineeId && subId === voteInfo.nomineeId) || (pId && pId === voteInfo.playerId);
      });
      if (matched?._id) return matched._id.toString();
    }
    return null;
  };

  const mainVoteInfo = familyVotesMap.get(mainAccountId);
  const mainHasVoted = Boolean(mainVoteInfo);

  const profilesList = [
    {
      id: mainAccountId,
      name: `${mainAccount?.firstName || ''} ${mainAccount?.lastName || ''}`.trim() || mainAccount?.userName || 'Main Account',
      type: 'MAIN_ACCOUNT',
      isCurrent: effectiveVoterId === mainAccountId,
      hasVoted: mainHasVoted,
      isVoted: mainHasVoted,
      votedNomineeId: resolveNomineeId(mainVoteInfo),
      votedPlayerId: mainVoteInfo?.playerId || null,
    },
    ...children.map((child) => {
      const cId = child._id.toString();
      const childVoteInfo = familyVotesMap.get(cId);
      const cHasVoted = Boolean(childVoteInfo);
      return {
        id: cId,
        name: `${child.firstName || ''} ${child.lastName || ''}`.trim() || child.userName || 'Player',
        type: 'PLAYER',
        isCurrent: effectiveVoterId === cId,
        hasVoted: cHasVoted,
        isVoted: cHasVoted,
        votedNomineeId: resolveNomineeId(childVoteInfo),
        votedPlayerId: childVoteInfo?.playerId || null,
      };
    }),
  ];

  return profilesList;
};

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
      const resolvedWinnerId = (winnerId?._id ? winnerId._id : winnerId).toString();
      updateData.winner = resolvedWinnerId;
      updateData.winnerVotes = maxVotes;
      poll.winner = resolvedWinnerId;
      poll.winnerVotes = maxVotes;

      // Award points / coins to specific winning player
      try {
        const pe = await PlayerEconomy.findOne().lean();
        const potdCoin = Number(pe?.playerOfTheDay?.coin) || 5000;
        const rewardAmount = poll.votingType === 'MONTH' ? potdCoin * 2 : potdCoin;

        await recordCoinTransaction({
          userId: resolvedWinnerId,
          amount: rewardAmount,
          category: COIN_TRANSACTION_CATEGORY.TOURNAMENT_PRIZE,
          title: `${poll.votingType === 'MONTH' ? 'Player of the Month' : 'Player of the Week'} Winner Prize`,
          description: `Reward for winning ${poll.title}`,
          referenceId: `${poll._id.toString()}_winner`,
        });
      } catch (err) {
        console.error('Error awarding winner coins during auto-sync:', err);
      }
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
  query: Record<string, unknown>,
  currentUserId?: string,
  voterProfileId?: string
): Promise<{
  data: any[];
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
      .populate('nominees.player', 'firstName lastName profile userName position selectTeam')
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

  // Resolve effective voter if user is logged in
  let effectiveVoterId = currentUserId;
  let effectiveVoter: any = null;
  if (currentUserId) {
    try {
      const resolved = await resolveEffectiveVoter(currentUserId, voterProfileId);
      effectiveVoterId = resolved.effectiveVoterId;
      effectiveVoter = {
        id: effectiveVoterId,
        name: `${resolved.effectiveVoterUser?.firstName || ''} ${resolved.effectiveVoterUser?.lastName || ''}`.trim() || resolved.effectiveVoterUser?.userName || 'Voter',
        type: resolved.effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      };
    } catch {
      effectiveVoterId = currentUserId;
    }
  }

  // Check user votes if logged in
  let userVotesMap = new Map<string, { playerId: string; votedAt: Date }>();
  if (effectiveVoterId && polls.length > 0) {
    const userObjId = Types.ObjectId.isValid(effectiveVoterId)
      ? new Types.ObjectId(effectiveVoterId)
      : effectiveVoterId;
    const pollIds = polls.map((p) => p._id);
    const votes = await PlayerVote.find({
      votingId: { $in: pollIds },
      userId: userObjId,
    }).lean();

    votes.forEach((v: any) => {
      userVotesMap.set(v.votingId.toString(), {
        playerId: v.playerId.toString(),
        votedAt: v.createdAt,
      });
    });
  }

  const enrichedPolls = polls.map((poll) => {
    const totalVotes = poll.totalVotes || 0;
    const voteInfo = userVotesMap.get(poll._id.toString());
    const hasVoted = Boolean(voteInfo);
    const userVotedPlayerId = voteInfo?.playerId || null;
    const votedAt = voteInfo?.votedAt || null;

    let votedNomineeId: string | null = null;
    if (userVotedPlayerId) {
      const matched = (poll.nominees || []).find((n: any) => {
        const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
        return pId === userVotedPlayerId;
      });
      votedNomineeId = matched?._id ? matched._id.toString() : null;
    }

    const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
      const percentage = totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      const isChoice = Boolean(
        userVotedPlayerId && (
          (nom.player?._id && nom.player._id.toString() === userVotedPlayerId) ||
          (nom.player && nom.player.toString() === userVotedPlayerId)
        )
      );
      return {
        ...nom,
        votePercentage: percentage,
        isUserChoice: isChoice,
        isVoted: isChoice,
        hasVoted: isChoice,
      };
    });

    return {
      ...poll,
      nominees: nomineesWithStats,
      hasVoted,
      isVoted: hasVoted,
      userVotedPlayerId,
      votedPlayerId: userVotedPlayerId,
      userVotedNomineeId: votedNomineeId,
      votedNomineeId,
      votedAt,
      currentProfile: effectiveVoter,
    };
  });

  return {
    data: enrichedPolls,
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
  currentUserId?: string,
  voterProfileId?: string
): Promise<any> => {
  const poll = await PlayerVoting.findById(id)
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position selectTeam')
    .populate('nominees.team', 'teamName logo')
    .populate('winner', 'firstName lastName profile userName')
    .populate('createdBy', 'firstName lastName email')
    .lean();

  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Voting poll not found.');
  }

  await autoSyncPollStatus(poll);

  const totalVotes = poll.totalVotes || 0;

  // Check if current user / profile has voted in this poll
  let hasVoted = false;
  let userVotedPlayerId: string | null = null;
  let votedNomineeId: string | null = null;
  let votedAt: Date | null = null;
  let effectiveVoter: any = null;
  let profiles: any[] = [];

  if (currentUserId) {
    const { effectiveVoterId, effectiveVoterUser } = await resolveEffectiveVoter(
      currentUserId,
      voterProfileId
    );

    effectiveVoter = {
      id: effectiveVoterId,
      name: `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() || effectiveVoterUser?.userName || 'Voter',
      type: effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
    };

    const userObjId = Types.ObjectId.isValid(effectiveVoterId)
      ? new Types.ObjectId(effectiveVoterId)
      : effectiveVoterId;

    const voteRecord = await PlayerVote.findOne({
      votingId: poll._id,
      userId: userObjId,
    }).lean();

    if (voteRecord) {
      hasVoted = true;
      userVotedPlayerId = voteRecord.playerId?.toString() || null;
      votedAt = (voteRecord as any).createdAt || null;

      const matchedNom = (poll.nominees || []).find((n: any) => {
        const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
        return pId === userVotedPlayerId;
      });
      votedNomineeId = matchedNom?._id ? matchedNom._id.toString() : null;
    }

    profiles = await getFamilyProfilesWithVoteStatus(currentUserId, poll._id, effectiveVoterId, poll.nominees);
  }

  const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
    const percentage = totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
    const isChoice = Boolean(
      userVotedPlayerId && (
        (nom.player?._id && nom.player._id.toString() === userVotedPlayerId) ||
        (nom.player && nom.player.toString() === userVotedPlayerId)
      )
    );
    return {
      ...nom,
      votePercentage: percentage,
      isUserChoice: isChoice,
      isVoted: isChoice,
      hasVoted: isChoice,
    };
  });

  return {
    ...poll,
    nominees: nomineesWithStats,
    hasVoted,
    isVoted: hasVoted,
    userVotedPlayerId,
    votedPlayerId: userVotedPlayerId,
    userVotedNomineeId: votedNomineeId,
    votedNomineeId,
    votedAt,
    currentProfile: effectiveVoter,
    profiles,
  };
};

const getActiveVotingPollsForClientFromDB = async (
  query: Record<string, unknown>,
  currentUserId?: string,
  voterProfileId?: string
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
    .populate('nominees.player', 'firstName lastName profile userName position selectTeam')
    .populate('nominees.team', 'teamName logo')
    .sort({ isFeatured: -1, startDate: 1 })
    .lean();

  let effectiveVoterId = currentUserId;
  let effectiveVoter: any = null;

  if (currentUserId) {
    try {
      const resolved = await resolveEffectiveVoter(currentUserId, voterProfileId);
      effectiveVoterId = resolved.effectiveVoterId;
      effectiveVoter = {
        id: effectiveVoterId,
        name: `${resolved.effectiveVoterUser?.firstName || ''} ${resolved.effectiveVoterUser?.lastName || ''}`.trim() || resolved.effectiveVoterUser?.userName || 'Voter',
        type: resolved.effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      };
    } catch {
      effectiveVoterId = currentUserId;
    }
  }

  // Pre-fetch family profiles and all family votes across all active polls
  let familyUserProfiles: Array<{
    id: string;
    name: string;
    type: 'MAIN_ACCOUNT' | 'PLAYER';
  }> = [];

  const familyVotesByPollAndUser = new Map<string, { playerId: string; nomineeId?: string; votedAt?: Date }>();

  if (currentUserId && polls.length > 0) {
    const user = await User.findById(currentUserId)
      .select('_id firstName lastName userName role parentId')
      .lean();

    if (user) {
      const mainAccountId = user.parentId ? user.parentId.toString() : user._id.toString();
      const mainAccount = user.parentId
        ? await User.findById(user.parentId).select('_id firstName lastName userName role').lean()
        : user;

      const children = await User.find({ parentId: mainAccountId })
        .select('_id firstName lastName userName role')
        .lean();

      familyUserProfiles = [
        {
          id: mainAccountId,
          name:
            `${mainAccount?.firstName || ''} ${mainAccount?.lastName || ''}`.trim() ||
            mainAccount?.userName ||
            'Main Account',
          type: 'MAIN_ACCOUNT',
        },
        ...children.map((child) => ({
          id: child._id.toString(),
          name:
            `${child.firstName || ''} ${child.lastName || ''}`.trim() ||
            child.userName ||
            'Player',
          type: 'PLAYER' as const,
        })),
      ];

      const allFamilyObjectIds = [
        new Types.ObjectId(mainAccountId),
        ...children.map((c) => c._id),
      ];

      const pollIds = polls.map((p) => p._id);
      const allFamilyVotes = await PlayerVote.find({
        votingId: { $in: pollIds },
        userId: { $in: allFamilyObjectIds },
      }).lean();

      allFamilyVotes.forEach((v: any) => {
        const key = `${v.votingId.toString()}_${v.userId.toString()}`;
        familyVotesByPollAndUser.set(key, {
          playerId: v.playerId ? v.playerId.toString() : '',
          nomineeId: v.nomineeId ? v.nomineeId.toString() : undefined,
          votedAt: v.createdAt,
        });
      });
    }
  }

  // Format with percentages and strictly per-poll user & profile vote status
  const formattedPolls = polls.map((poll) => {
    const pollIdStr = poll._id.toString();
    const totalVotes = poll.totalVotes || 0;

    // Build the strictly scoped profiles array for THIS poll
    const pollProfiles = familyUserProfiles.map((prof) => {
      const voteKey = `${pollIdStr}_${prof.id}`;
      const voteInfo = familyVotesByPollAndUser.get(voteKey);
      const hasVoted = Boolean(voteInfo);
      let votedNomineeId: string | null = null;
      let votedPlayerId: string | null = null;

      if (voteInfo) {
        votedPlayerId = voteInfo.playerId || null;
        if (voteInfo.nomineeId) {
          votedNomineeId = voteInfo.nomineeId;
        } else if (votedPlayerId && poll.nominees) {
          const matched = (poll.nominees || []).find((n: any) => {
            const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
            return pId === votedPlayerId;
          });
          votedNomineeId = matched?._id ? matched._id.toString() : null;
        }
      }

      return {
        id: prof.id,
        name: prof.name,
        type: prof.type,
        hasVoted,
        isVoted: hasVoted,
        votedNomineeId,
        votedPlayerId,
        isCurrent: prof.id === effectiveVoterId,
      };
    });

    // Determine poll-level flags for the active profile (or logged-in user) in THIS poll
    const activeProfileVote = familyVotesByPollAndUser.get(`${pollIdStr}_${effectiveVoterId}`);
    const hasVoted = Boolean(activeProfileVote);
    const userVotedPlayerId = activeProfileVote?.playerId || null;
    const votedAt = activeProfileVote?.votedAt || null;

    let userVotedNomineeId: string | null = null;
    if (activeProfileVote?.nomineeId) {
      userVotedNomineeId = activeProfileVote.nomineeId;
    } else if (userVotedPlayerId && poll.nominees) {
      const matched = (poll.nominees || []).find((n: any) => {
        const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
        return pId === userVotedPlayerId;
      });
      userVotedNomineeId = matched?._id ? matched._id.toString() : null;
    }

    const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
      const percentage = totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      const isChoice = Boolean(
        userVotedPlayerId && (
          (nom.player?._id && nom.player._id.toString() === userVotedPlayerId) ||
          (nom.player && nom.player.toString() === userVotedPlayerId)
        )
      );
      return {
        ...nom,
        votePercentage: percentage,
        isUserChoice: isChoice,
        isVoted: isChoice,
        hasVoted: isChoice,
      };
    });

    return {
      ...poll,
      nominees: nomineesWithStats,
      hasVoted,
      isVoted: hasVoted,
      userVotedPlayerId,
      votedPlayerId: userVotedPlayerId,
      userVotedNomineeId,
      votedNomineeId: userVotedNomineeId,
      votedAt,
      currentProfile: effectiveVoter,
      profiles: pollProfiles,
    };
  });

  return formattedPolls;
};

const castVoteInDB = async (
  votingId: string,
  userId: string,
  playerId: string,
  voterProfileId?: string | string[],
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

  const profileIdList: string[] = Array.isArray(voterProfileId)
    ? voterProfileId
    : [voterProfileId || userId];

  const successfulVotes: string[] = [];
  let lastEffectiveVoterId = userId;
  let lastEffectiveVoterUser: any = null;

  for (const rawProfileId of profileIdList) {
    const { effectiveVoterId, effectiveVoterUser } = await resolveEffectiveVoter(
      userId,
      rawProfileId
    );
    lastEffectiveVoterId = effectiveVoterId;
    lastEffectiveVoterUser = effectiveVoterUser;

    const voterName = `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() || effectiveVoterUser?.userName || 'This profile';

    // Check if this specific profile already voted
    const existingVote = await PlayerVote.findOne({
      votingId: poll._id,
      userId: effectiveVoterId,
    });

    if (existingVote) {
      if (profileIdList.length === 1) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          `${voterName} has already cast a vote in this voting round.`
        );
      }
      continue;
    }

    try {
      await PlayerVote.create({
        votingId: poll._id,
        userId: new Types.ObjectId(effectiveVoterId),
        playerId: new Types.ObjectId(resolvedPlayerId),
        nomineeId: nomineeDocId ? new Types.ObjectId(nomineeDocId) : undefined,
        ipAddress,
      });
      successfulVotes.push(effectiveVoterId);
    } catch (err: any) {
      if (err.code === 11000) {
        if (profileIdList.length === 1) {
          throw new ApiError(
            StatusCodes.CONFLICT,
            `${voterName} has already cast a vote in this voting round.`
          );
        }
      } else {
        throw err;
      }
    }
  }

  if (successfulVotes.length === 0 && profileIdList.length > 1) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'All selected profiles have already cast their votes in this voting round.'
    );
  }

  const voteIncrement = successfulVotes.length || 1;

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
        'nominees.$.votesCount': voteIncrement,
        totalVotes: voteIncrement,
      },
    },
    { new: true }
  )
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position selectTeam')
    .populate('nominees.team', 'teamName logo')
    .lean();

  const totalVotes = updatedPoll?.totalVotes || 1;
  const nomineesWithStats = (updatedPoll?.nominees || []).map((nom: any) => {
    const isChoice = nom.player?._id?.toString() === resolvedPlayerId;
    return {
      ...nom,
      votePercentage: Number(((nom.votesCount / totalVotes) * 100).toFixed(1)),
      isUserChoice: isChoice,
      isVoted: isChoice,
      hasVoted: isChoice,
    };
  });

  // Fetch updated family profiles status
  const profiles = await getFamilyProfilesWithVoteStatus(
    userId,
    poll._id,
    lastEffectiveVoterId,
    updatedPoll?.nominees
  );

  return {
    ...updatedPoll,
    nominees: nomineesWithStats,
    hasVoted: true,
    isVoted: true,
    userVotedPlayerId: resolvedPlayerId,
    votedPlayerId: resolvedPlayerId,
    userVotedNomineeId: nomineeDocId || null,
    votedNomineeId: nomineeDocId || null,
    votesCastCount: successfulVotes.length,
    voterProfile: {
      id: lastEffectiveVoterId,
      name: `${lastEffectiveVoterUser?.firstName || ''} ${lastEffectiveVoterUser?.lastName || ''}`.trim() || 'Profile',
      type: lastEffectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
    },
    profiles,
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
      const resolvedWinnerId = (winnerPlayerId?._id ? winnerPlayerId._id : winnerPlayerId).toString();
      updateData.winner = resolvedWinnerId;
      updateData.winnerVotes = maxVotes;

      // Award points / coins to specific winning player
      try {
        const pe = await PlayerEconomy.findOne().lean();
        const potdCoin = Number(pe?.playerOfTheDay?.coin) || 5000;
        const rewardAmount = poll.votingType === 'MONTH' ? potdCoin * 2 : potdCoin;

        await recordCoinTransaction({
          userId: resolvedWinnerId,
          amount: rewardAmount,
          category: COIN_TRANSACTION_CATEGORY.TOURNAMENT_PRIZE,
          title: `${poll.votingType === 'MONTH' ? 'Player of the Month' : 'Player of the Week'} Winner Prize`,
          description: `Reward for winning ${poll.title}`,
          referenceId: `${poll._id.toString()}_winner`,
        });
      } catch (err) {
        console.error('Error awarding winner coins in toggleVotingStatusInDB:', err);
      }
    }
  }

  const result = await PlayerVoting.findByIdAndUpdate(id, updateData, {
    new: true,
  })
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.player', 'firstName lastName profile userName position selectTeam')
    .populate('nominees.team', 'teamName logo')
    .populate('winner', 'firstName lastName profile userName');

  return result;
};

const getVotingLeaderboardOrResultsFromDB = async (
  id: string,
  currentUserId?: string,
  voterProfileId?: string
): Promise<any> => {
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

  // Check if current user / profile voted
  let hasVoted = false;
  let userVotedPlayerId: string | null = null;
  let votedNomineeId: string | null = null;
  let effectiveVoter: any = null;
  let profiles: any[] = [];

  if (currentUserId) {
    try {
      const { effectiveVoterId, effectiveVoterUser } = await resolveEffectiveVoter(
        currentUserId,
        voterProfileId
      );

      effectiveVoter = {
        id: effectiveVoterId,
        name: `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() || effectiveVoterUser?.userName || 'Voter',
        type: effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      };

      const userObjId = Types.ObjectId.isValid(effectiveVoterId)
        ? new Types.ObjectId(effectiveVoterId)
        : effectiveVoterId;

      const voteRecord = await PlayerVote.findOne({
        votingId: poll._id,
        userId: userObjId,
      }).lean();

      if (voteRecord) {
        hasVoted = true;
        userVotedPlayerId = voteRecord.playerId?.toString() || null;
        const matched = (poll.nominees || []).find((n: any) => {
          const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
          return pId === userVotedPlayerId;
        });
        votedNomineeId = matched?._id ? matched._id.toString() : null;
      }

      profiles = await getFamilyProfilesWithVoteStatus(currentUserId, poll._id, effectiveVoterId, poll.nominees);
    } catch {
      // Ignore resolution error for public results
    }
  }

  // Rank nominees by votesCount descending
  const rankedNominees = [...(poll.nominees || [])]
    .sort((a, b) => b.votesCount - a.votesCount)
    .map((nom: any, index: number) => {
      const percentage = totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      const isChoice = Boolean(
        userVotedPlayerId && (
          (nom.player?._id && nom.player._id.toString() === userVotedPlayerId) ||
          (nom.player && nom.player.toString() === userVotedPlayerId)
        )
      );
      return {
        rank: index + 1,
        ...nom,
        votePercentage: percentage,
        isLeading: index === 0 && nom.votesCount > 0,
        isUserChoice: isChoice,
        isVoted: isChoice,
        hasVoted: isChoice,
      };
    });

  return {
    ...poll,
    nominees: rankedNominees,
    hasVoted,
    isVoted: hasVoted,
    userVotedPlayerId,
    votedPlayerId: userVotedPlayerId,
    userVotedNomineeId: votedNomineeId,
    votedNomineeId,
    currentProfile: effectiveVoter,
    profiles,
  };
};

const checkUserVoteStatusInDB = async (
  votingId: string,
  userId?: string,
  voterProfileId?: string
): Promise<any> => {
  if (!userId) {
    return {
      hasVoted: false,
      isVoted: false,
      votedPlayerId: null,
      userVotedPlayerId: null,
      votedNomineeId: null,
      votedAt: null,
      voteRecord: null,
      currentProfile: null,
      profiles: [],
    };
  }

  const { effectiveVoterId, effectiveVoterUser } = await resolveEffectiveVoter(
    userId,
    voterProfileId
  );

  const voterName = `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() || effectiveVoterUser?.userName || 'Voter';

  const userObjId = Types.ObjectId.isValid(effectiveVoterId)
    ? new Types.ObjectId(effectiveVoterId)
    : effectiveVoterId;

  const poll = await PlayerVoting.findById(votingId).select('nominees').lean();

  const voteRecord = await PlayerVote.findOne({
    votingId,
    userId: userObjId,
  })
    .populate('playerId', 'firstName lastName profile userName position selectTeam')
    .lean();

  const profiles = await getFamilyProfilesWithVoteStatus(userId, votingId, effectiveVoterId, poll?.nominees);

  if (!voteRecord) {
    return {
      hasVoted: false,
      isVoted: false,
      votedPlayerId: null,
      userVotedPlayerId: null,
      userVotedNomineeId: null,
      votedNomineeId: null,
      votedAt: null,
      voteRecord: null,
      currentProfile: {
        id: effectiveVoterId,
        name: voterName,
        type: effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      },
      profiles,
    };
  }

  const targetPlayerId = voteRecord.playerId?._id
    ? voteRecord.playerId._id.toString()
    : voteRecord.playerId?.toString();

  const matchedNom = (poll?.nominees || []).find((n: any) => {
    const pId = n.player?._id ? n.player._id.toString() : n.player?.toString();
    return pId === targetPlayerId;
  });

  return {
    hasVoted: true,
    isVoted: true,
    votedPlayerId: targetPlayerId,
    userVotedPlayerId: targetPlayerId,
    userVotedNomineeId: matchedNom?._id ? matchedNom._id.toString() : null,
    votedNomineeId: matchedNom?._id ? matchedNom._id.toString() : null,
    votedPlayer: voteRecord.playerId,
    votedAt: (voteRecord as any).createdAt,
    voteRecord,
    currentProfile: {
      id: effectiveVoterId,
      name: voterName,
      type: effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
    },
    profiles,
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
    .populate('winner', 'firstName lastName profile userName position selectTeam')
    .populate('league', 'leagueName season ageGroup')
    .sort({ endDate: -1, createdAt: -1 })
    .lean();

  return {
    total: winners.length,
    winners,
  };
};

const getMyVotesFromDB = async (userId: string, voterProfileId?: string): Promise<any[]> => {
  let targetUserIds: Types.ObjectId[] = [];

  if (voterProfileId) {
    const { effectiveVoterId } = await resolveEffectiveVoter(userId, voterProfileId);
    targetUserIds = [new Types.ObjectId(effectiveVoterId)];
  } else {
    // If no specific profile specified, fetch votes for the entire family
    const user = await User.findById(userId).select('_id parentId').lean();
    const mainAccountId = user?.parentId ? user.parentId.toString() : userId.toString();
    const children = await User.find({ parentId: mainAccountId }).select('_id').lean();
    targetUserIds = [
      new Types.ObjectId(mainAccountId),
      ...children.map((c) => c._id),
    ];
  }

  const votes = await PlayerVote.find({ userId: { $in: targetUserIds } })
    .populate({
      path: 'votingId',
      populate: [
        { path: 'league', select: 'leagueName season ageGroup' },
        { path: 'winner', select: 'firstName lastName profile userName' },
      ],
    })
    .populate('userId', 'firstName lastName profile userName')
    .populate('playerId', 'firstName lastName profile userName position selectTeam')
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
  checkUserVoteStatusInDB,
  getPastWinnersFromDB,
  getMyVotesFromDB,
};
