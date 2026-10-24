import { StatusCodes } from 'http-status-codes';
import mongoose, { Types } from 'mongoose';
import ApiError from '../../../errors/ApiErrors';
import { USER_ROLES } from '../../../enums/user';
import { recordCoinTransaction } from '../../../helpers/coinLedgerHelper';
import { PlayerEconomy } from '../coinAndBudget/playerEconomySchema.model';
import { COIN_TRANSACTION_CATEGORY } from '../coinTransaction/coinTransaction.interface';
import { League } from '../league/league.model';
import { Match } from '../match/match.model';
import { MatchEvaluation } from '../refereeRating/refereeRating.model';
import { User } from '../user/user.model';
import {
  IRefereeVoting,
  TRefereeVotingStatus,
  TRefereeVotingType,
} from './refereeVoting.interface';
import { RefereeVote, RefereeVoting } from './refereeVoting.model';

// Helper to resolve effective voter (Main Account or Child Player Profile)
const resolveEffectiveVoter = async (
  userId: string,
  requestedProfileId?: string
): Promise<{ effectiveVoterId: string; effectiveVoterUser: any }> => {
  if (!requestedProfileId || requestedProfileId.toString() === userId.toString()) {
    const user = await User.findById(userId)
      .select('_id firstName lastName userName role parentId')
      .lean();
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
    if (user.parentId.toString() === requestedProfileId.toString()) {
      const parent = await User.findById(requestedProfileId)
        .select('_id firstName lastName userName role parentId')
        .lean();
      return { effectiveVoterId: requestedProfileId.toString(), effectiveVoterUser: parent };
    }

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
    'The selected profile does not belong to your account.'
  );
};

// Helper to get all family profiles (Main Account + all child profiles) with vote statuses
const getFamilyProfilesWithVoteStatus = async (
  userId: string,
  votingId: string | Types.ObjectId,
  effectiveVoterId: string
) => {
  const user = await User.findById(userId)
    .select('_id firstName lastName userName role parentId')
    .lean();
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

  const familyVotes = await RefereeVote.find({
    votingId,
    userId: { $in: allFamilyIds },
  }).lean();

  const familyVotesMap = new Map<string, string>();
  familyVotes.forEach((v) => {
    familyVotesMap.set(v.userId.toString(), v.refereeId.toString());
  });

  const profilesList = [
    {
      id: mainAccountId,
      name:
        `${mainAccount?.firstName || ''} ${mainAccount?.lastName || ''}`.trim() ||
        mainAccount?.userName ||
        'Main Account',
      type: 'MAIN_ACCOUNT',
      isCurrent: effectiveVoterId === mainAccountId,
      hasVoted: familyVotesMap.has(mainAccountId),
      isVoted: familyVotesMap.has(mainAccountId),
      votedRefereeId: familyVotesMap.get(mainAccountId) || null,
    },
    ...children.map((child) => {
      const cId = child._id.toString();
      const cHasVoted = familyVotesMap.has(cId);
      return {
        id: cId,
        name:
          `${child.firstName || ''} ${child.lastName || ''}`.trim() ||
          child.userName ||
          'Member',
        type: 'PLAYER',
        isCurrent: effectiveVoterId === cId,
        hasVoted: cHasVoted,
        isVoted: cHasVoted,
        votedRefereeId: familyVotesMap.get(cId) || null,
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
    await RefereeVoting.findByIdAndUpdate(poll._id, { status: 'active' });
  } else if (poll.status === 'active' && poll.endDate < now) {
    poll.status = 'completed';
    let maxVotes = -1;
    let winnerId = null;
    for (const nom of poll.nominees || []) {
      if (nom.votesCount > maxVotes) {
        maxVotes = nom.votesCount;
        winnerId = nom.referee;
      }
    }
    const updateData: Record<string, any> = { status: 'completed' };
    if (winnerId && maxVotes > 0) {
      const resolvedWinnerId = (winnerId?._id ? winnerId._id : winnerId).toString();
      updateData.winner = resolvedWinnerId;
      updateData.winnerVotes = maxVotes;
      poll.winner = resolvedWinnerId;
      poll.winnerVotes = maxVotes;

      // Award points / coins to winning referee if economy configured
      try {
        const pe = await PlayerEconomy.findOne().lean();
        const potdCoin = Number(pe?.playerOfTheDay?.coin) || 5000;
        const rewardAmount = poll.votingType === 'MONTH' ? potdCoin * 2 : potdCoin;

        await recordCoinTransaction({
          userId: resolvedWinnerId,
          amount: rewardAmount,
          category: COIN_TRANSACTION_CATEGORY.TOURNAMENT_PRIZE,
          title: `${poll.votingType === 'MONTH' ? 'Referee of the Month' : 'Referee of the Week'} Winner Prize`,
          description: `Reward for winning ${poll.title}`,
          referenceId: `${poll._id.toString()}_winner`,
        });
      } catch (err) {
        console.error('Error awarding winner coins during referee poll auto-sync:', err);
      }
    }
    await RefereeVoting.findByIdAndUpdate(poll._id, updateData);
  }
};

const createVotingPollToDB = async (
  userId: string,
  payload: Partial<IRefereeVoting>
): Promise<IRefereeVoting> => {
  const { title, votingType, startDate, endDate, nominees, league } = payload;

  if (!title || !votingType || !startDate || !endDate) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Missing required fields (title, votingType, startDate, endDate).'
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

  if (league) {
    const existingLeague = await League.findById(league);
    if (!existingLeague) {
      throw new ApiError(StatusCodes.NOT_FOUND, 'Specified League was not found.');
    }
  }

  if (!Array.isArray(nominees) || nominees.length < 2) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'A referee voting poll must have at least 2 pre-selected referee nominees.'
    );
  }

  const refereeIds = nominees.map((n) => n.referee.toString());
  const uniqueRefIds = new Set(refereeIds);
  if (uniqueRefIds.size !== refereeIds.length) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Duplicate referees cannot be added as nominees in the same voting round.'
    );
  }

  // Verify all nominee referees exist in User collection and have role REFEREE
  const existingReferees = await User.find({
    _id: { $in: Array.from(uniqueRefIds) },
    role: USER_ROLES.REFEREE,
  }).select('_id firstName lastName');

  if (existingReferees.length !== uniqueRefIds.size) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'One or more selected nominees are not valid registered referees in the database.'
    );
  }

  // Determine initial status based on current time
  const now = new Date();
  let status: TRefereeVotingStatus = payload.status || 'upcoming';
  if (!payload.status) {
    if (now >= start && now <= end) {
      status = 'active';
    } else if (now > end) {
      status = 'completed';
    } else {
      status = 'upcoming';
    }
  }

  // Enrich nominees with match counts and ratings if not provided
  const enrichedNominees = await Promise.all(
    nominees.map(async (n) => {
      let matchesCount = n.matchesOfficiatedCount;
      let fairPlayRating = n.fairPlayRating;

      if (matchesCount === undefined || matchesCount === null) {
        matchesCount = await Match.countDocuments({
          referee: n.referee,
          status: 'finished',
        });
      }

      if (fairPlayRating === undefined || fairPlayRating === null) {
        const evals = await MatchEvaluation.find({ referee: n.referee }).select(
          'homeTeamRating awayTeamRating'
        );
        if (evals.length > 0) {
          const totalRating = evals.reduce((acc, curr) => {
            const h = curr.homeTeamRating || 0;
            const a = curr.awayTeamRating || 0;
            return acc + (h + a) / 2;
          }, 0);
          fairPlayRating = Math.round(totalRating / evals.length);
        } else {
          fairPlayRating = 90; // Default reputable baseline
        }
      }

      return {
        referee: new Types.ObjectId(n.referee),
        matchesOfficiatedCount: matchesCount,
        fairPlayRating,
        statsHighlight:
          n.statsHighlight ||
          `${matchesCount} Match${matchesCount === 1 ? '' : 'es'} Officiated`,
        votesCount: 0,
      };
    })
  );

  const pollData = {
    ...payload,
    startDate: start,
    endDate: end,
    status,
    totalVotes: 0,
    createdBy: new Types.ObjectId(userId),
    nominees: enrichedNominees,
  };

  const result = await RefereeVoting.create(pollData);
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

  if (query.searchValue) {
    const searchRegex = new RegExp(String(query.searchValue), 'i');
    filter.$or = [{ title: searchRegex }, { season: searchRegex }, { month: searchRegex }];
  }

  const [polls, total] = await Promise.all([
    RefereeVoting.find(filter)
      .populate('league', 'leagueName season ageGroup')
      .populate('nominees.referee', 'firstName lastName profile userName email phone role')
      .populate('winner', 'firstName lastName profile userName')
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    RefereeVoting.countDocuments(filter),
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
        name:
          `${resolved.effectiveVoterUser?.firstName || ''} ${resolved.effectiveVoterUser?.lastName || ''}`.trim() ||
          resolved.effectiveVoterUser?.userName ||
          'Voter',
        type: resolved.effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      };
    } catch {
      effectiveVoterId = currentUserId;
    }
  }

  // Check user votes if logged in
  let userVotesMap = new Map<string, { refereeId: string; votedAt: Date }>();
  if (effectiveVoterId && polls.length > 0) {
    const userObjId = Types.ObjectId.isValid(effectiveVoterId)
      ? new Types.ObjectId(effectiveVoterId)
      : effectiveVoterId;
    const pollIds = polls.map((p) => p._id);
    const votes = await RefereeVote.find({
      votingId: { $in: pollIds },
      userId: userObjId,
    }).lean();

    votes.forEach((v: any) => {
      userVotesMap.set(v.votingId.toString(), {
        refereeId: v.refereeId.toString(),
        votedAt: v.createdAt,
      });
    });
  }

  const enrichedPolls = polls.map((poll) => {
    const totalVotes = poll.totalVotes || 0;
    const voteInfo = userVotesMap.get(poll._id.toString());
    const hasVoted = Boolean(voteInfo);
    const userVotedRefereeId = voteInfo?.refereeId || null;
    const votedAt = voteInfo?.votedAt || null;

    let votedNomineeId: string | null = null;
    if (userVotedRefereeId) {
      const matched = (poll.nominees || []).find((n: any) => {
        const rId = n.referee?._id ? n.referee._id.toString() : n.referee?.toString();
        return rId === userVotedRefereeId;
      });
      votedNomineeId = matched?._id ? matched._id.toString() : null;
    }

    const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
      const percentage =
        totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      const isChoice = Boolean(
        userVotedRefereeId &&
          ((nom.referee?._id && nom.referee._id.toString() === userVotedRefereeId) ||
            (nom.referee && nom.referee.toString() === userVotedRefereeId))
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
      userVotedRefereeId,
      votedRefereeId: userVotedRefereeId,
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
  const poll = await RefereeVoting.findById(id)
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.referee', 'firstName lastName profile userName email phone role')
    .populate('winner', 'firstName lastName profile userName')
    .populate('createdBy', 'firstName lastName email')
    .lean();

  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Referee voting poll not found.');
  }

  await autoSyncPollStatus(poll);

  const totalVotes = poll.totalVotes || 0;

  let hasVoted = false;
  let userVotedRefereeId: string | null = null;
  let votedNomineeId: string | null = null;
  let votedAt: Date | null = null;
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
        name:
          `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() ||
          effectiveVoterUser?.userName ||
          'Voter',
        type: effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      };

      const userObjId = Types.ObjectId.isValid(effectiveVoterId)
        ? new Types.ObjectId(effectiveVoterId)
        : effectiveVoterId;

      const voteRecord = await RefereeVote.findOne({
        votingId: poll._id,
        userId: userObjId,
      }).lean();

      if (voteRecord) {
        hasVoted = true;
        userVotedRefereeId = voteRecord.refereeId?.toString() || null;
        votedAt = (voteRecord as any).createdAt || null;
        const matched = (poll.nominees || []).find((n: any) => {
          const rId = n.referee?._id ? n.referee._id.toString() : n.referee?.toString();
          return rId === userVotedRefereeId;
        });
        votedNomineeId = matched?._id ? matched._id.toString() : null;
      }

      profiles = await getFamilyProfilesWithVoteStatus(currentUserId, poll._id, effectiveVoterId);
    } catch {
      // Ignore voter resolution error
    }
  }

  const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
    const percentage =
      totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
    const isChoice = Boolean(
      userVotedRefereeId &&
        ((nom.referee?._id && nom.referee._id.toString() === userVotedRefereeId) ||
          (nom.referee && nom.referee.toString() === userVotedRefereeId))
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
    userVotedRefereeId,
    votedRefereeId: userVotedRefereeId,
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

  const filter: Record<string, any> = {
    status: { $in: ['active', 'upcoming'] },
    endDate: { $gte: now },
  };

  if (query.leagueId || query.league) {
    filter.league = query.leagueId || query.league;
  }

  if (query.votingType || query.type) {
    filter.votingType = query.votingType || query.type;
  }

  const polls = await RefereeVoting.find(filter)
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.referee', 'firstName lastName profile userName email phone role')
    .sort({ isFeatured: -1, startDate: 1 })
    .lean();

  let effectiveVoterId = currentUserId;
  let effectiveVoter: any = null;
  let familyProfiles: any[] = [];

  if (currentUserId) {
    try {
      const resolved = await resolveEffectiveVoter(currentUserId, voterProfileId);
      effectiveVoterId = resolved.effectiveVoterId;
      effectiveVoter = {
        id: effectiveVoterId,
        name:
          `${resolved.effectiveVoterUser?.firstName || ''} ${resolved.effectiveVoterUser?.lastName || ''}`.trim() ||
          resolved.effectiveVoterUser?.userName ||
          'Voter',
        type: resolved.effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      };
    } catch {
      effectiveVoterId = currentUserId;
    }
  }

  let userVotesMap = new Map<string, { refereeId: string; votedAt: Date }>();
  if (effectiveVoterId && polls.length > 0) {
    const userObjId = Types.ObjectId.isValid(effectiveVoterId)
      ? new Types.ObjectId(effectiveVoterId)
      : effectiveVoterId;
    const pollIds = polls.map((p) => p._id);
    const votes = await RefereeVote.find({
      votingId: { $in: pollIds },
      userId: userObjId,
    }).lean();

    votes.forEach((v: any) => {
      userVotesMap.set(v.votingId.toString(), {
        refereeId: v.refereeId.toString(),
        votedAt: v.createdAt,
      });
    });
  }

  if (currentUserId && polls.length > 0) {
    familyProfiles = await getFamilyProfilesWithVoteStatus(
      currentUserId,
      polls[0]._id,
      effectiveVoterId || currentUserId
    );
  }

  const formattedPolls = polls.map((poll) => {
    const totalVotes = poll.totalVotes || 0;
    const voteInfo = userVotesMap.get(poll._id.toString());
    const hasVoted = Boolean(voteInfo);
    const userVotedRefereeId = voteInfo?.refereeId || null;
    const votedAt = voteInfo?.votedAt || null;

    let votedNomineeId: string | null = null;
    if (userVotedRefereeId) {
      const matched = (poll.nominees || []).find((n: any) => {
        const rId = n.referee?._id ? n.referee._id.toString() : n.referee?.toString();
        return rId === userVotedRefereeId;
      });
      votedNomineeId = matched?._id ? matched._id.toString() : null;
    }

    const nomineesWithStats = (poll.nominees || []).map((nom: any) => {
      const percentage =
        totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      const isChoice = Boolean(
        userVotedRefereeId &&
          ((nom.referee?._id && nom.referee._id.toString() === userVotedRefereeId) ||
            (nom.referee && nom.referee.toString() === userVotedRefereeId))
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
      userVotedRefereeId,
      votedRefereeId: userVotedRefereeId,
      votedNomineeId,
      votedAt,
      currentProfile: effectiveVoter,
      profiles: familyProfiles,
    };
  });

  return formattedPolls;
};

const castVoteInDB = async (
  votingId: string,
  userId: string,
  refereeId: string,
  voterProfileId?: string | string[],
  ipAddress?: string
): Promise<any> => {
  const poll = await RefereeVoting.findById(votingId);
  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Referee voting poll not found.');
  }

  const now = new Date();

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

  // Check if target matches either referee ID or nominee subdocument _id
  const nomineeIndex = poll.nominees.findIndex((n: any) => {
    const rId = n.referee?._id ? n.referee._id.toString() : n.referee?.toString();
    const subId = n._id ? n._id.toString() : '';
    return rId === refereeId || subId === refereeId;
  });

  if (nomineeIndex === -1) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'The selected referee or nominee is not a nominee in this voting round.'
    );
  }

  const targetNominee = poll.nominees[nomineeIndex];
  const resolvedRefereeId = targetNominee.referee?._id
    ? targetNominee.referee._id.toString()
    : targetNominee.referee.toString();
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

    const voterName =
      `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() ||
      effectiveVoterUser?.userName ||
      'This profile';

    const existingVote = await RefereeVote.findOne({
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
      await RefereeVote.create({
        votingId: poll._id,
        userId: new Types.ObjectId(effectiveVoterId),
        refereeId: new Types.ObjectId(resolvedRefereeId),
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
    queryFilter['nominees.referee'] = new Types.ObjectId(resolvedRefereeId);
  }

  const updatedPoll = await RefereeVoting.findOneAndUpdate(
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
    .populate('nominees.referee', 'firstName lastName profile userName email phone role')
    .lean();

  const totalVotes = updatedPoll?.totalVotes || 1;
  const nomineesWithStats = (updatedPoll?.nominees || []).map((nom: any) => {
    const isChoice = nom.referee?._id?.toString() === resolvedRefereeId;
    return {
      ...nom,
      votePercentage: Number(((nom.votesCount / totalVotes) * 100).toFixed(1)),
      isUserChoice: isChoice,
      isVoted: isChoice,
      hasVoted: isChoice,
    };
  });

  const profiles = await getFamilyProfilesWithVoteStatus(
    userId,
    poll._id,
    lastEffectiveVoterId
  );

  return {
    ...updatedPoll,
    nominees: nomineesWithStats,
    hasVoted: true,
    isVoted: true,
    userVotedRefereeId: resolvedRefereeId,
    votedRefereeId: resolvedRefereeId,
    votedNomineeId: nomineeDocId || null,
    votesCastCount: successfulVotes.length,
    voterProfile: {
      id: lastEffectiveVoterId,
      name:
        `${lastEffectiveVoterUser?.firstName || ''} ${lastEffectiveVoterUser?.lastName || ''}`.trim() ||
        'Profile',
      type: lastEffectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
    },
    profiles,
  };
};

const updateVotingPollInDB = async (
  id: string,
  payload: Partial<IRefereeVoting>
): Promise<IRefereeVoting | null> => {
  const existingPoll = await RefereeVoting.findById(id);
  if (!existingPoll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Referee voting poll not found.');
  }

  if (payload.startDate && payload.endDate) {
    const start = new Date(payload.startDate);
    const end = new Date(payload.endDate);
    if (start >= end) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'startDate must be before endDate.');
    }
  }

  // Preserve existing vote counts for matched referees if nominees are updated
  if (Array.isArray(payload.nominees) && payload.nominees.length >= 2) {
    const refereeVotesMap = new Map<string, number>();
    existingPoll.nominees.forEach((n) => {
      refereeVotesMap.set(n.referee.toString(), n.votesCount || 0);
    });

    payload.nominees = payload.nominees.map((n) => ({
      referee: new Types.ObjectId(n.referee),
      matchesOfficiatedCount: n.matchesOfficiatedCount || 0,
      fairPlayRating: n.fairPlayRating || 90,
      statsHighlight: n.statsHighlight || '',
      votesCount: refereeVotesMap.get(n.referee.toString()) || 0,
    }));
  }

  const result = await RefereeVoting.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  })
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.referee', 'firstName lastName profile userName email phone role')
    .populate('winner', 'firstName lastName profile userName');

  return result;
};

const deleteVotingPollInDB = async (id: string): Promise<IRefereeVoting | null> => {
  const poll = await RefereeVoting.findById(id);
  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Referee voting poll not found.');
  }

  await Promise.all([
    RefereeVoting.findByIdAndDelete(id),
    RefereeVote.deleteMany({ votingId: id }),
  ]);

  return poll;
};

const toggleVotingStatusInDB = async (
  id: string,
  status: TRefereeVotingStatus
): Promise<IRefereeVoting | null> => {
  const poll = await RefereeVoting.findById(id);
  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Referee voting poll not found.');
  }

  const updateData: Record<string, any> = { status };

  if (status === 'completed') {
    let maxVotes = -1;
    let winnerRefereeId: Types.ObjectId | null = null;

    for (const nom of poll.nominees || []) {
      if (nom.votesCount > maxVotes) {
        maxVotes = nom.votesCount;
        winnerRefereeId = nom.referee;
      }
    }

    if (winnerRefereeId && maxVotes > 0) {
      const resolvedWinnerId = (winnerRefereeId?._id
        ? winnerRefereeId._id
        : winnerRefereeId
      ).toString();
      updateData.winner = resolvedWinnerId;
      updateData.winnerVotes = maxVotes;

      try {
        const pe = await PlayerEconomy.findOne().lean();
        const potdCoin = Number(pe?.playerOfTheDay?.coin) || 5000;
        const rewardAmount = poll.votingType === 'MONTH' ? potdCoin * 2 : potdCoin;

        await recordCoinTransaction({
          userId: resolvedWinnerId,
          amount: rewardAmount,
          category: COIN_TRANSACTION_CATEGORY.TOURNAMENT_PRIZE,
          title: `${poll.votingType === 'MONTH' ? 'Referee of the Month' : 'Referee of the Week'} Winner Prize`,
          description: `Reward for winning ${poll.title}`,
          referenceId: `${poll._id.toString()}_winner`,
        });
      } catch (err) {
        console.error('Error awarding winner coins in referee toggleVotingStatusInDB:', err);
      }
    }
  }

  const result = await RefereeVoting.findByIdAndUpdate(id, updateData, {
    new: true,
  })
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.referee', 'firstName lastName profile userName email phone role')
    .populate('winner', 'firstName lastName profile userName');

  return result;
};

const getVotingLeaderboardOrResultsFromDB = async (
  id: string,
  currentUserId?: string,
  voterProfileId?: string
): Promise<any> => {
  const poll = await RefereeVoting.findById(id)
    .populate('league', 'leagueName season ageGroup')
    .populate('nominees.referee', 'firstName lastName profile userName email phone role')
    .populate('winner', 'firstName lastName profile userName')
    .lean();

  if (!poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Referee voting poll not found.');
  }

  const totalVotes = poll.totalVotes || 0;

  let hasVoted = false;
  let userVotedRefereeId: string | null = null;
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
        name:
          `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() ||
          effectiveVoterUser?.userName ||
          'Voter',
        type: effectiveVoterUser?.parentId ? 'PLAYER' : 'MAIN_ACCOUNT',
      };

      const userObjId = Types.ObjectId.isValid(effectiveVoterId)
        ? new Types.ObjectId(effectiveVoterId)
        : effectiveVoterId;

      const voteRecord = await RefereeVote.findOne({
        votingId: poll._id,
        userId: userObjId,
      }).lean();

      if (voteRecord) {
        hasVoted = true;
        userVotedRefereeId = voteRecord.refereeId?.toString() || null;
        const matched = (poll.nominees || []).find((n: any) => {
          const rId = n.referee?._id ? n.referee._id.toString() : n.referee?.toString();
          return rId === userVotedRefereeId;
        });
        votedNomineeId = matched?._id ? matched._id.toString() : null;
      }

      profiles = await getFamilyProfilesWithVoteStatus(currentUserId, poll._id, effectiveVoterId);
    } catch {
      // Ignore resolution error
    }
  }

  // Rank nominees by votesCount descending
  const rankedNominees = [...(poll.nominees || [])]
    .sort((a, b) => b.votesCount - a.votesCount)
    .map((nom: any, index: number) => {
      const percentage =
        totalVotes > 0 ? Number(((nom.votesCount / totalVotes) * 100).toFixed(1)) : 0;
      const isChoice = Boolean(
        userVotedRefereeId &&
          ((nom.referee?._id && nom.referee._id.toString() === userVotedRefereeId) ||
            (nom.referee && nom.referee.toString() === userVotedRefereeId))
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
    userVotedRefereeId,
    votedRefereeId: userVotedRefereeId,
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
      votedRefereeId: null,
      userVotedRefereeId: null,
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

  const voterName =
    `${effectiveVoterUser?.firstName || ''} ${effectiveVoterUser?.lastName || ''}`.trim() ||
    effectiveVoterUser?.userName ||
    'Voter';

  const userObjId = Types.ObjectId.isValid(effectiveVoterId)
    ? new Types.ObjectId(effectiveVoterId)
    : effectiveVoterId;

  const voteRecord = await RefereeVote.findOne({
    votingId,
    userId: userObjId,
  })
    .populate('refereeId', 'firstName lastName profile userName email phone role')
    .lean();

  const profiles = await getFamilyProfilesWithVoteStatus(userId, votingId, effectiveVoterId);

  if (!voteRecord) {
    return {
      hasVoted: false,
      isVoted: false,
      votedRefereeId: null,
      userVotedRefereeId: null,
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

  const targetRefId = voteRecord.refereeId?._id
    ? voteRecord.refereeId._id.toString()
    : voteRecord.refereeId?.toString();

  const poll = await RefereeVoting.findById(votingId).select('nominees').lean();
  const matchedNom = (poll?.nominees || []).find((n: any) => {
    const rId = n.referee?._id ? n.referee._id.toString() : n.referee?.toString();
    return rId === targetRefId;
  });

  return {
    hasVoted: true,
    isVoted: true,
    votedRefereeId: targetRefId,
    userVotedRefereeId: targetRefId,
    votedNomineeId: matchedNom?._id ? matchedNom._id.toString() : null,
    votedReferee: voteRecord.refereeId,
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

  if (query.season) {
    filter.season = query.season;
  }

  const winners = await RefereeVoting.find(filter)
    .populate('winner', 'firstName lastName profile userName email phone role')
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
    const user = await User.findById(userId).select('_id parentId').lean();
    const mainAccountId = user?.parentId ? user.parentId.toString() : userId.toString();
    const children = await User.find({ parentId: mainAccountId }).select('_id').lean();
    targetUserIds = [
      new Types.ObjectId(mainAccountId),
      ...children.map((c) => c._id),
    ];
  }

  const votes = await RefereeVote.find({ userId: { $in: targetUserIds } })
    .populate({
      path: 'votingId',
      populate: [
        { path: 'league', select: 'leagueName season ageGroup' },
        { path: 'winner', select: 'firstName lastName profile userName' },
      ],
    })
    .populate('userId', 'firstName lastName profile userName')
    .populate('refereeId', 'firstName lastName profile userName email phone role')
    .sort({ createdAt: -1 })
    .lean();

  return votes;
};

// Endpoint to fetch eligible referees for dropdown in Admin UI
const getEligibleRefereesListFromDB = async (query?: Record<string, unknown>): Promise<any[]> => {
  const filter: Record<string, any> = {
    role: USER_ROLES.REFEREE,
  };

  if (query?.searchValue) {
    const searchRegex = new RegExp(String(query.searchValue), 'i');
    filter.$or = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { userName: searchRegex },
      { email: searchRegex },
    ];
  }

  const referees = await User.find(filter)
    .select('_id firstName lastName userName email phone profile')
    .lean();

  // Enrich with match count
  const refereeIds = referees.map((r) => r._id);
  const matchCounts = await Match.aggregate([
    { $match: { referee: { $in: refereeIds }, status: 'finished' } },
    { $group: { _id: '$referee', count: { $sum: 1 } } },
  ]);

  const matchCountMap = new Map<string, number>();
  matchCounts.forEach((m) => {
    matchCountMap.set(m._id.toString(), m.count);
  });

  return referees.map((ref) => ({
    ...ref,
    matchesOfficiatedCount: matchCountMap.get(ref._id.toString()) || 0,
    fullName: `${ref.firstName || ''} ${ref.lastName || ''}`.trim() || ref.userName,
  }));
};

export const RefereeVotingService = {
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
  getEligibleRefereesListFromDB,
};
