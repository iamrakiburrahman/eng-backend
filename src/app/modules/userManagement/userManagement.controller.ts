// user.controller.ts

import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { UserManagementService } from "./userManagement.service";

// GET ALL USERS
const getAllUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.getAllUsersFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Users retrieved successfully",
    pagination: result.meta,
    data: result.result,
  });
});

// TOGGLE VERIFIED
const toggleVerified = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.toggleVerifiedToDB(
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "User verification status updated successfully",
    data: result,
  });
});

// DELETE USER
const deleteUser = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.deleteUserFromDB(
    req.params.id as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "User deleted successfully",
    data: result,
  });
});

const getAllReferees = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.getAllRefereesFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Referees retrieved successfully",
    data: result,
  });
});

const getAllManagers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.getAllManagersFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Referees retrieved successfully",
    data: result,
  });
});

const getUserAnalytics = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.getUserAnalyticsFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "User management analytics retrieved successfully",
    data: result,
  });
});

const updateUserRole = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.updateUserRoleToDB(
    req.params.id as string,
    req.body.role as string,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "User role updated successfully",
    data: result,
  });
});

const updateUserProfileByAdmin = catchAsync(
  async (req: Request, res: Response) => {
    let profile = req.body.profile;
    const files = req.files as any;
    if (files) {
      const profileFile =
        files.profile?.[0] || files.image?.[0] || files.profilePic?.[0];
      if (profileFile) {
        profile = `/images/${profileFile.filename}`;
      }
    }

    const payload: Record<string, any> = {
      ...req.body,
    };
    if (profile) {
      payload.profile = profile;
    }

    const result = await UserManagementService.updateUserProfileByAdminToDB(
      req.params.id as string,
      payload,
    );

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "User profile updated successfully by Admin",
      data: result,
    });
  },
);

// GET ALL PARENTS
const getAllParents = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.getAllParentsFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Parents retrieved successfully",
    pagination: result.meta,
    data: result.result,
  });
});

// GET PARENTS OVERVIEW
const getParentOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.getParentOverviewFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Parent overview metrics retrieved successfully",
    data: result,
  });
});

// ASSIGN TEAM TO USER / PLAYER BY ADMIN
const assignTeamToUser = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { selectTeam } = req.body;

  const result = await UserManagementService.assignTeamToUserToDB(
    id,
    selectTeam,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Team assigned successfully",
    data: result,
  });
});

// GET INCOMPLETE USERS
const getIncompleteUsers = catchAsync(async (req: Request, res: Response) => {
  const result = await UserManagementService.getIncompleteUsersFromDB(
    req.query,
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Incomplete users retrieved successfully",
    pagination: result.meta,
    data: result.result,
  });
});

// GET INCOMPLETE USERS ANALYTICS / STATS
const getIncompleteUsersAnalytics = catchAsync(
  async (req: Request, res: Response) => {
    const result =
      await UserManagementService.getIncompleteUsersAnalyticsFromDB();

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Incomplete users analytics retrieved successfully",
      data: result,
    });
  },
);

// UPDATE PLAYER JERSEY NUMBER & PROFILE PICTURE
const updateJerseyNumber = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Safely extract body even if req.body is undefined or stringified
  let bodyData: Record<string, any> = {};
  if (req.body) {
    if (typeof req.body === "string") {
      try {
        bodyData = JSON.parse(req.body);
      } catch {
        bodyData = {};
      }
    } else if (typeof req.body === "object") {
      bodyData = req.body;
      if (typeof bodyData.data === "string") {
        try {
          bodyData = { ...bodyData, ...JSON.parse(bodyData.data) };
        } catch {
          // ignore
        }
      } else if (typeof bodyData.data === "object" && bodyData.data !== null) {
        bodyData = { ...bodyData, ...bodyData.data };
      }
    }
  }

  let jerseyNumber =
    bodyData.jerseyNumber ??
    bodyData.jerseyNo ??
    bodyData.jersey_number ??
    bodyData.number;
  let profile = bodyData.profile || bodyData.image;

  const files = req.files as any;
  if (files) {
    const profileFile =
      files.profile?.[0] || files.image?.[0] || files.profilePic?.[0];
    if (profileFile) {
      profile = `/images/${profileFile.filename}`;
    }
  }

  const result = await UserManagementService.updateJerseyNumberToDB(
    id,
    {
      jerseyNumber:
        jerseyNumber !== undefined && jerseyNumber !== null
          ? jerseyNumber.toString().trim()
          : undefined,
      profile: profile || undefined,
    },
    req.user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player details updated successfully",
    data: result,
  });
});

export const UserManagementController = {
  getAllUsers,
  getAllParents,
  getParentOverview,
  getIncompleteUsers,
  getIncompleteUsersAnalytics,
  assignTeamToUser,
  updateJerseyNumber,
  toggleVerified,
  deleteUser,
  getAllReferees,
  getAllManagers,
  getUserAnalytics,
  updateUserRole,
  updateUserProfileByAdmin,
};
