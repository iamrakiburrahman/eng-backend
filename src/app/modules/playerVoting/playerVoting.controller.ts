import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { PlayerVotingService } from './playerVoting.service';

const createVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const files = req.files as { image?: Express.Multer.File[]; banner?: Express.Multer.File[] };

  let bodyData: any = {};
  if (req.body?.data) {
    try {
      bodyData = JSON.parse(req.body.data);
    } catch {
      bodyData = req.body;
    }
  } else {
    bodyData = req.body;
  }

  // Handle uploaded banner image if present (supports both 'banner' and 'image' field)
  if (files?.banner && files.banner.length > 0 && files.banner[0]) {
    bodyData.banner = `/images/${files.banner[0].filename}`;
  } else if (files?.image && files.image.length > 0 && files.image[0]) {
    bodyData.banner = `/images/${files.image[0].filename}`;
  }

  // Handle nominees if passed as string
  if (typeof bodyData.nominees === 'string') {
    try {
      bodyData.nominees = JSON.parse(bodyData.nominees);
    } catch {
      // Keep as is
    }
  }

  const result = await PlayerVotingService.createVotingPollToDB(user.id, bodyData);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Player of the Week/Month voting poll created successfully',
    data: result,
  });
});

const getTargetProfileId = (req: Request): string | undefined => {
  const profileId =
    (Array.isArray(req.body?.profileIds) ? req.body.profileIds[0] : req.body?.profileId) ||
    req.body?.childId ||
    req.body?.voterId ||
    (Array.isArray(req.query?.profileId) ? req.query.profileId[0] : req.query?.profileId) ||
    req.query?.childId ||
    req.query?.voterId ||
    (req.headers['x-profile-id'] as string) ||
    (req.headers['x-child-id'] as string) ||
    (req.headers['x-voter-id'] as string) ||
    undefined;

  return typeof profileId === 'string' ? profileId : undefined;
};

const getTargetVoterProfiles = (req: Request): string | string[] | undefined => {
  if (Array.isArray(req.body?.profileIds) && req.body.profileIds.length > 0) {
    return req.body.profileIds;
  }
  return getTargetProfileId(req);
};

const getAllVotingPolls = catchAsync(async (req: Request, res: Response) => {
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);
  const result = await PlayerVotingService.getAllVotingPollsFromDB(
    req.query,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Voting polls retrieved successfully',
    data: result.data,
    pagination: result.pagination,
  });
});

const getSingleVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);

  const result = await PlayerVotingService.getSingleVotingPollFromDB(
    id,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Voting poll details retrieved successfully',
    data: result,
  });
});

const getActiveVotingPolls = catchAsync(async (req: Request, res: Response) => {
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);

  const result = await PlayerVotingService.getActiveVotingPollsForClientFromDB(
    req.query,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Active voting polls retrieved successfully',
    data: result,
  });
});

const castVote = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const user = req.user as any;
  const targetId =
    req.body.playerId || req.body.nomineeId || req.body.id || req.body.candidateId;
  const voterProfileId = getTargetVoterProfiles(req);

  if (!targetId) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: 'playerId or nomineeId is required to cast a vote.',
      data: null,
    });
  }

  const ipAddress =
    (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || undefined;

  const result = await PlayerVotingService.castVoteInDB(
    id,
    user.id,
    targetId,
    voterProfileId,
    ipAddress
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Vote cast successfully!',
    data: result,
  });
});

const updateVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const files = req.files as { image?: Express.Multer.File[]; banner?: Express.Multer.File[] };

  let bodyData: any = {};
  if (req.body?.data) {
    try {
      bodyData = JSON.parse(req.body.data);
    } catch {
      bodyData = req.body;
    }
  } else {
    bodyData = req.body;
  }

  // Handle uploaded banner image if present (supports both 'banner' and 'image' field)
  if (files?.banner && files.banner.length > 0 && files.banner[0]) {
    bodyData.banner = `/images/${files.banner[0].filename}`;
  } else if (files?.image && files.image.length > 0 && files.image[0]) {
    bodyData.banner = `/images/${files.image[0].filename}`;
  }

  if (typeof bodyData.nominees === 'string') {
    try {
      bodyData.nominees = JSON.parse(bodyData.nominees);
    } catch {
      // Keep as is
    }
  }

  const result = await PlayerVotingService.updateVotingPollInDB(id, bodyData);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Voting poll updated successfully',
    data: result,
  });
});

const deleteVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await PlayerVotingService.deleteVotingPollInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Voting poll and its vote records deleted successfully',
    data: result,
  });
});

const toggleVotingStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status } = req.body;

  const result = await PlayerVotingService.toggleVotingStatusInDB(id, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Voting poll status updated to ${status}`,
    data: result,
  });
});

const getVotingLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);
  const result = await PlayerVotingService.getVotingLeaderboardOrResultsFromDB(
    id,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Voting poll results retrieved successfully',
    data: result,
  });
});

const checkMyVoteInPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);

  const result = await PlayerVotingService.checkUserVoteStatusInDB(
    id,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'User vote status retrieved successfully',
    data: result,
  });
});

const getPastWinners = catchAsync(async (req: Request, res: Response) => {
  const result = await PlayerVotingService.getPastWinnersFromDB(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Player of the Week/Month winners retrieved successfully',
    data: result.winners,
  });
});

const getMyVotes = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const voterProfileId = getTargetProfileId(req);
  const result = await PlayerVotingService.getMyVotesFromDB(user.id, voterProfileId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'My voting history retrieved successfully',
    data: result,
  });
});

export const PlayerVotingController = {
  createVotingPoll,
  getAllVotingPolls,
  getSingleVotingPoll,
  getActiveVotingPolls,
  castVote,
  updateVotingPoll,
  deleteVotingPoll,
  toggleVotingStatus,
  getVotingLeaderboard,
  checkMyVoteInPoll,
  getPastWinners,
  getMyVotes,
};
