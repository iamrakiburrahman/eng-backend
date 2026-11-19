import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import QueryBuilder from '../../../util/queryBuilder';
import { ITournamentClaim } from './tournamentClaim.interface';
import { TournamentClaim } from './tournamentClaim.model';
import { Tournament } from '../tournament/tournament.model';
import { User } from '../user/user.model';
import { USER_ROLES } from '../../../enums/user';
import { NotificationQueueHelper } from '../../../helpers/bullMQ/bullHelper';
import { NOTIFICATION_TYPE } from '../notification/notification.interface';

const createClaimToDB = async (
  userId: string,
  payload: Partial<ITournamentClaim>
): Promise<ITournamentClaim> => {
  const { tournament: tournamentId, claimedPosition, proofNotes } = payload;

  if (!tournamentId || !claimedPosition) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Tournament ID and claimedPosition are required'
    );
  }

  // 1. Verify user exists & has allowed role (PLAYER or TOURNAMENT_PLAYER)
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
  }

  if (
    user.role !== USER_ROLES.PLAYER &&
    user.role !== USER_ROLES.TOURNAMENT_PLAYER
  ) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Only PLAYER or TOURNAMENT_PLAYER role can claim tournament positions'
    );
  }

  // 2. Verify tournament exists
  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Tournament not found');
  }

  // 3. Check Deadline (endDate check)
  const now = new Date();
  if (now > new Date(tournament.endDate)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Tournament submission deadline has passed. Submissions are closed.'
    );
  }

  if (now < new Date(tournament.startDate)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Tournament has not started yet'
    );
  }

  // 4. Verify position exists in tournament rewards configuration
  const rewardConfig = tournament.positionRewards?.find(
    (r) => r.position === Number(claimedPosition)
  );

  if (!rewardConfig) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Position ${claimedPosition} is not configured for rewards in this tournament`
    );
  }

  // 5. Check if position has ALREADY been approved for another user
  const alreadyApproved = await TournamentClaim.findOne({
    tournament: tournamentId,
    claimedPosition: Number(claimedPosition),
    status: 'approved',
  });

  if (alreadyApproved) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Position ${rewardConfig.positionName} has already been awarded and finalized for another participant.`
    );
  }

  // 6. Check if user already submitted a claim for this tournament
  const existingUserClaim = await TournamentClaim.findOne({
    tournament: tournamentId,
    user: userId,
  });

  if (existingUserClaim) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      'You have already submitted a claim for this tournament.'
    );
  }

  // 7. Create Claim
  const result = await TournamentClaim.create({
    tournament: tournamentId,
    user: userId,
    claimedPosition: Number(claimedPosition),
    claimedPositionName: rewardConfig.positionName,
    proofNotes: proofNotes || '',
    status: 'pending',
  });

  return result;
};

const getAllClaimsFromDB = async (query: Record<string, any>) => {
  const queryObj = { ...query };

  // If status is 'ALL' or empty, don't filter by status
  if (!queryObj.status || String(queryObj.status).toUpperCase() === 'ALL') {
    delete queryObj.status;
  }

  const searchTerm = (queryObj.searchTerm || queryObj.search || queryObj.searchValue) as string;
  let searchCondition: any = {};

  if (searchTerm && searchTerm.trim()) {
    const regex = new RegExp(searchTerm.trim(), 'i');

    const [matchingUsers, matchingTournaments] = await Promise.all([
      User.find({
        $or: [
          { userName: { $regex: regex } },
          { email: { $regex: regex } },
          { firstName: { $regex: regex } },
          { lastName: { $regex: regex } },
        ],
      }).select('_id'),
      Tournament.find({ title: { $regex: regex } }).select('_id'),
    ]);

    const userIds = matchingUsers.map((u) => u._id);
    const tournamentIds = matchingTournaments.map((t) => t._id);

    searchCondition = {
      $or: [
        { claimedPositionName: { $regex: regex } },
        { proofNotes: { $regex: regex } },
        ...(userIds.length > 0 ? [{ user: { $in: userIds } }] : []),
        ...(tournamentIds.length > 0 ? [{ tournament: { $in: tournamentIds } }] : []),
      ],
    };
  }

  const claimQuery = new QueryBuilder(TournamentClaim.find(searchCondition), queryObj)
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await claimQuery.modelQuery
    .populate('tournament')
    .populate('user', 'userName email firstName lastName profile role rewardPoint');

  const meta = await claimQuery.getPaginationInfo();

  return {
    meta,
    result,
  };
};

const getMyClaimsFromDB = async (userId: string) => {
  const result = await TournamentClaim.find({ user: userId })
    .sort({ createdAt: -1 })
    .populate('tournament');

  return result;
};

const reviewClaimInDB = async (
  claimId: string,
  adminId: string,
  status: 'approved' | 'rejected'
): Promise<ITournamentClaim | null> => {
  if (status !== 'approved' && status !== 'rejected') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Status must be either approved or rejected'
    );
  }

  const claim = await TournamentClaim.findById(claimId);
  if (!claim) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Tournament claim not found');
  }

  if (claim.status === 'approved') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This claim has already been approved and points have been credited.'
    );
  }

  const tournament = await Tournament.findById(claim.tournament);
  if (!tournament) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Associated tournament not found');
  }

  if (status === 'approved') {
    // 1-Person per Position Rule: Ensure no other user is approved for this position
    const duplicateApproval = await TournamentClaim.findOne({
      tournament: claim.tournament,
      claimedPosition: claim.claimedPosition,
      status: 'approved',
      _id: { $ne: claimId },
    });

    if (duplicateApproval) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        `Position ${claim.claimedPositionName} has already been approved for another participant in this tournament.`
      );
    }

    // Find points configured for this position
    const rewardConfig = tournament.positionRewards?.find(
      (r) => r.position === claim.claimedPosition
    );

    const pointsToAward = rewardConfig ? rewardConfig.points : 0;

    // Concurrency-safe atomic claim approval to prevent double-crediting
    const updatedClaim = await TournamentClaim.findOneAndUpdate(
      { _id: claimId, status: 'pending' },
      {
        status: 'approved',
        pointsAwarded: pointsToAward,
        approvedBy: adminId as any,
      },
      { new: true }
    );

    if (!updatedClaim) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        'Claim has already been reviewed, approved, or rejected.'
      );
    }

    // Credit reward points to user account only after atomic claim lock
    if (pointsToAward > 0) {
      await User.findByIdAndUpdate(claim.user, {
        $inc: { rewardPoint: pointsToAward },
      });
    }

    claim.status = 'approved';
    claim.pointsAwarded = pointsToAward;
    claim.approvedBy = adminId as any;

    // Send Notification to User via background queue
    await NotificationQueueHelper.sendNotification(
      claim.user.toString(),
      `Congratulations! Your position claim for "${tournament.title}" (${claim.claimedPositionName}) has been approved. ${pointsToAward} reward points have been added to your account!`,
      'Tournament Reward Credited',
      NOTIFICATION_TYPE.GENERAL,
      undefined,
      claim._id.toString(),
      'TournamentClaim'
    );
  } else {
    claim.status = 'rejected';
    claim.approvedBy = adminId as any;
    await claim.save();

    // Send Notification to User via background queue
    await NotificationQueueHelper.sendNotification(
      claim.user.toString(),
      `Your position claim for "${tournament.title}" (${claim.claimedPositionName}) was not approved by Admin.`,
      'Tournament Claim Update',
      NOTIFICATION_TYPE.GENERAL,
      undefined,
      claim._id.toString(),
      'TournamentClaim'
    );
  }

  return claim;
};

const getTournamentClaimOverviewFromDB = async () => {
  const [
    totalClaims,
    pendingClaims,
    approvedClaims,
    rejectedClaims,
    totalTournaments,
  ] = await Promise.all([
    TournamentClaim.countDocuments(),
    TournamentClaim.countDocuments({ status: 'pending' }),
    TournamentClaim.countDocuments({ status: 'approved' }),
    TournamentClaim.countDocuments({ status: 'rejected' }),
    Tournament.countDocuments(),
  ]);

  return {
    totalClaims,
    pendingClaims,
    approvedClaims,
    rejectedClaims,
    totalTournaments,
  };
};

export const TournamentClaimService = {
  createClaimToDB,
  getAllClaimsFromDB,
  getMyClaimsFromDB,
  reviewClaimInDB,
  getTournamentClaimOverviewFromDB,
};
