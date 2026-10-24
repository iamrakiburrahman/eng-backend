import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { RefereeVotingService } from "./refereeVoting.service";

const getTargetProfileId = (req: Request): string | undefined => {
  const profileId =
    (Array.isArray(req.body?.profileIds)
      ? req.body.profileIds[0]
      : req.body?.profileId) ||
    req.body?.childId ||
    req.body?.voterId ||
    (Array.isArray(req.query?.profileId)
      ? req.query.profileId[0]
      : req.query?.profileId) ||
    req.query?.childId ||
    req.query?.voterId ||
    (req.headers["x-profile-id"] as string) ||
    (req.headers["x-child-id"] as string) ||
    (req.headers["x-voter-id"] as string) ||
    undefined;

  return typeof profileId === "string" ? profileId : undefined;
};

const getTargetVoterProfiles = (
  req: Request
): string | string[] | undefined => {
  if (Array.isArray(req.body?.profileIds) && req.body.profileIds.length > 0) {
    return req.body.profileIds;
  }
  return getTargetProfileId(req);
};

const createVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const files = req.files as {
    image?: Express.Multer.File[];
    banner?: Express.Multer.File[];
  };

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

  // Handle uploaded banner image if present
  if (files?.banner && files.banner.length > 0 && files.banner[0]) {
    bodyData.banner = `/images/${files.banner[0].filename}`;
  } else if (files?.image && files.image.length > 0 && files.image[0]) {
    bodyData.banner = `/images/${files.image[0].filename}`;
  }

  // Handle nominees if passed as stringified JSON
  if (typeof bodyData.nominees === "string") {
    try {
      bodyData.nominees = JSON.parse(bodyData.nominees);
    } catch {
      // Keep as is
    }
  }

  const result = await RefereeVotingService.createVotingPollToDB(
    user.id,
    bodyData
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Referee of the Week/Month voting poll created successfully",
    data: result,
  });
});

const getAllVotingPolls = catchAsync(async (req: Request, res: Response) => {
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);
  const result = await RefereeVotingService.getAllVotingPollsFromDB(
    req.query,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee voting polls retrieved successfully",
    data: result.data,
    pagination: result.pagination,
  });
});

const getSingleVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);

  const result = await RefereeVotingService.getSingleVotingPollFromDB(
    id,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee voting poll details retrieved successfully",
    data: result,
  });
});

const getActiveVotingPolls = catchAsync(async (req: Request, res: Response) => {
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);

  const result = await RefereeVotingService.getActiveVotingPollsForClientFromDB(
    req.query,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Active referee voting polls retrieved successfully",
    data: result,
  });
});

const castVote = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const user = req.user as any;
  const targetId =
    req.body.refereeId ||
    req.body.nomineeId ||
    req.body.id ||
    req.body.candidateId ||
    req.body.playerId;
  const voterProfileId = getTargetVoterProfiles(req);

  if (!targetId) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: "refereeId or nomineeId is required to cast a vote.",
      data: null,
    });
  }

  const ipAddress =
    (req.headers["x-forwarded-for"] as string) ||
    req.socket.remoteAddress ||
    undefined;

  const result = await RefereeVotingService.castVoteInDB(
    id,
    user.id,
    targetId,
    voterProfileId,
    ipAddress
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee vote cast successfully!",
    data: result,
  });
});

const updateVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const files = req.files as {
    image?: Express.Multer.File[];
    banner?: Express.Multer.File[];
  };

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

  if (files?.banner && files.banner.length > 0 && files.banner[0]) {
    bodyData.banner = `/images/${files.banner[0].filename}`;
  } else if (files?.image && files.image.length > 0 && files.image[0]) {
    bodyData.banner = `/images/${files.image[0].filename}`;
  }

  if (typeof bodyData.nominees === "string") {
    try {
      bodyData.nominees = JSON.parse(bodyData.nominees);
    } catch {
      // Keep as is
    }
  }

  const result = await RefereeVotingService.updateVotingPollInDB(id, bodyData);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee voting poll updated successfully",
    data: result,
  });
});

const deleteVotingPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await RefereeVotingService.deleteVotingPollInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee voting poll and its vote records deleted successfully",
    data: result,
  });
});

const toggleVotingStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status } = req.body;

  const result = await RefereeVotingService.toggleVotingStatusInDB(id, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Referee voting poll status updated to ${status}`,
    data: result,
  });
});

const getVotingLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);
  const result = await RefereeVotingService.getVotingLeaderboardOrResultsFromDB(
    id,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee voting results retrieved successfully",
    data: result,
  });
});

const checkMyVoteInPoll = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const voterProfileId = getTargetProfileId(req);

  const result = await RefereeVotingService.checkUserVoteStatusInDB(
    id,
    currentUserId,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee vote status retrieved successfully",
    data: result,
  });
});

const getPastWinners = catchAsync(async (req: Request, res: Response) => {
  const result = await RefereeVotingService.getPastWinnersFromDB(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Referee of the Week/Month winners retrieved successfully",
    data: result.winners,
  });
});

const getMyVotes = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const voterProfileId = getTargetProfileId(req);
  const result = await RefereeVotingService.getMyVotesFromDB(
    user.id,
    voterProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "My referee voting history retrieved successfully",
    data: result,
  });
});

const getEligibleReferees = catchAsync(async (req: Request, res: Response) => {
  const result = await RefereeVotingService.getEligibleRefereesListFromDB(
    req.query
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Eligible referees retrieved successfully",
    data: result,
  });
});

export const RefereeVotingController = {
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
  getEligibleReferees,
};
