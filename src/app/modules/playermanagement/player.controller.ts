import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PlayerService } from "./player.service";
import ApiError from "../../../errors/ApiErrors";

const getAuthUserId = (req: Request): string => {
  const user = req.user as any;
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized access");
  }
  return user.id || user._id;
};

// ========================== PARENT PLAYER CONTROLLERS ==========================

// 1. CREATE PLAYER BY PARENT
const createPlayerByParent = catchAsync(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);

  const files = req.files as Record<string, Express.Multer.File[]> | undefined;

  let rawData = req.body;
  if (req.body?.data) {
    try {
      rawData = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
    } catch (e) {
      rawData = req.body;
    }
  }

  const payload: any = { ...rawData };

  if (files) {
    const profileFile = files.profile?.[0] || files.image?.[0] || files.avatar?.[0];
    if (profileFile) {
      payload.profile = profileFile.path.replace(/\\/g, "/").split("uploads")[1];
    }

    const docFiles = files.document || files.documents || files.file || files.idProof;
    if (docFiles && docFiles.length > 0) {
      payload.document = docFiles.map((doc) =>
        doc.path.replace(/\\/g, "/").split("uploads")[1]
      );
    }
  }

  const result = await PlayerService.createPlayerByParentToDB(userId, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: "Player profile created successfully and sent for admin review",
    data: result,
  });
});

// 2. GET MY PLAYERS (PARENT)
const getMyPlayers = catchAsync(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const result = await PlayerService.getMyPlayersFromDB(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "My players retrieved successfully",
    data: result,
  });
});

// 3. GET SINGLE PLAYER BY PARENT
const getPlayerById = catchAsync(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const playerId = req.params.id as string;
  const result = await PlayerService.getPlayerByIdFromDB(userId, playerId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player profile retrieved successfully",
    data: result,
  });
});

// 4. UPDATE PLAYER BY PARENT
const updatePlayerByParent = catchAsync(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const playerId = req.params.id as string;

  const files = req.files as {
    profile?: Express.Multer.File[];
    document?: Express.Multer.File[];
  } | undefined;

  const data = req.body?.data ? JSON.parse(req.body.data) : req.body || {};
  const payload: any = { ...data };

  if (files?.profile?.[0]) {
    payload.profile = files.profile[0].path.replace(/\\/g, "/").split("uploads")[1];
  } else {
    // If no new profile image is uploaded, do not overwrite the existing profile
    delete payload.profile;
  }

  if (files?.document && files.document.length > 0) {
    payload.document = files.document.map((doc) =>
      doc.path.replace(/\\/g, "/").split("uploads")[1]
    );
  } else {
    // If no new documents are uploaded, do not overwrite the existing documents
    delete payload.document;
  }

  const result = await PlayerService.updatePlayerByParentToDB(userId, playerId, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player profile updated successfully",
    data: result,
  });
});

// 5. DELETE PLAYER BY PARENT
const deletePlayerByParent = catchAsync(async (req: Request, res: Response) => {
  const userId = getAuthUserId(req);
  const playerId = req.params.id as string;
  const result = await PlayerService.deletePlayerByParentToDB(userId, playerId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player profile deleted successfully",
    data: result,
  });
});

// ========================== ADMIN PLAYER CONTROLLERS ==========================

// 6. GET PENDING PLAYERS FOR ADMIN
const getPendingPlayersForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await PlayerService.getPendingPlayersForAdminFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Pending players retrieved successfully for admin review",
    data: result,
  });
});

// 7. APPROVE PLAYER BY ADMIN
const approvePlayerByAdmin = catchAsync(async (req: Request, res: Response) => {
  const playerId = req.params.id as string;
  const result = await PlayerService.approvePlayerByAdminToDB(playerId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player profile approved successfully",
    data: result,
  });
});

// 8. REJECT PLAYER BY ADMIN
const rejectPlayerByAdmin = catchAsync(async (req: Request, res: Response) => {
  const playerId = req.params.id as string;
  const reason = req.body?.reason || req.body?.rejectionReason;
  const result = await PlayerService.rejectPlayerByAdminToDB(playerId, reason);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player profile rejected",
    data: result,
  });
});

// ========================== EXISTING CONTROLLERS ==========================

const getAllPlayers = catchAsync(async (req: Request, res: Response) => {
  const result = await PlayerService.getAllPlayersFromDB(req.query, req.user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Players retrieved successfully",
    data: result,
  });
});

const getPlayerOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await PlayerService.getPlayerOverviewFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player overview metrics retrieved successfully",
    data: result,
  });
});

const getFilteredPlayers = catchAsync(async (req: Request, res: Response) => {
  const result = await PlayerService.getFilteredPlayersFromDB(req.query, req.user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Filtered players retrieved successfully",
    data: result,
  });
});

const updatePlayerByAdmin = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const files = req.files as {
    image?: Express.Multer.File[];
    profile?: Express.Multer.File[];
  } | undefined;

  const image = files?.image?.[0] || files?.profile?.[0];
  const data = req.body?.data ? JSON.parse(req.body.data) : req.body || {};
  const payload: any = { ...data };

  if (image) {
    payload.profile = image.path
      .replace(/\\/g, "/")
      .split("uploads")[1];
  } else {
    delete payload.profile;
  }

  const result = await PlayerService.updatePlayerByAdminToDB(id, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player updated successfully",
    data: result,
  });
});

const deletePlayerByAdmin = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await PlayerService.deletePlayerByAdminToDB(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player deleted successfully",
    data: result,
  });
});

const assignJerseyNumber = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { jerseyNumber } = req.body;
  const result = await PlayerService.assignJerseyNumberToDB(id, jerseyNumber, req.user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player jersey number assigned successfully",
    data: result,
  });
});

export const PlayerController = {
  createPlayerByParent,
  getMyPlayers,
  getPlayerById,
  updatePlayerByParent,
  deletePlayerByParent,
  getPendingPlayersForAdmin,
  approvePlayerByAdmin,
  rejectPlayerByAdmin,
  getAllPlayers,
  getPlayerOverview,
  getFilteredPlayers,
  updatePlayerByAdmin,
  deletePlayerByAdmin,
  assignJerseyNumber,
};
