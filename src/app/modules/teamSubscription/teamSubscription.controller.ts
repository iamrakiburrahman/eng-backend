import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import ApiError from "../../../errors/ApiErrors";
import { USER_ROLES } from "../../../enums/user";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { TeamSubscriptionService } from "./teamSubscription.service";

// 1. TOGGLE TEAM SUBSCRIPTION (BELL ON / OFF)
const toggleSubscription = catchAsync(async (req, res) => {
  const userId = req.user?.id as string;
  const teamId = (req.params.teamId || req.body.teamId) as string;
  const explicitState =
    req.body.isBellActive !== undefined
      ? req.body.isBellActive
      : req.body.isSubscribed;

  const result = await TeamSubscriptionService.toggleTeamSubscription(
    userId,
    teamId,
    explicitState,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

// 2. GET STATUS FOR A TEAM (IS BELL ACTIVE)
const getSubscriptionStatus = catchAsync(async (req, res) => {
  const userId = req.user?.id as string;
  const teamId = req.params.teamId as string;

  const result = await TeamSubscriptionService.getSubscriptionStatus(
    userId,
    teamId,
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Subscription status retrieved successfully",
    data: result,
  });
});

// 3. GET ALL TEAMS SUBSCRIBED BY CURRENT USER
const getMySubscribedTeams = catchAsync(async (req, res) => {
  const userId = req.user?.id as string;

  const result = await TeamSubscriptionService.getMySubscribedTeams(userId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Subscribed teams retrieved successfully",
    data: result,
  });
});

// 4. GET SUBSCRIBER COUNT FOR A TEAM
const getTeamSubscribersCount = catchAsync(async (req, res) => {
  const teamId = req.params.teamId as string;

  const result = await TeamSubscriptionService.getTeamSubscribersCount(teamId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Team subscriber count retrieved successfully",
    data: result,
  });
});

// 5. BROADCAST NOTIFICATION TO TEAM SUBSCRIBERS (ADMIN / MANAGER)
const broadcastToSubscribers = catchAsync(async (req, res) => {
  const teamId = req.params.teamId as string;
  const user = req.user as any;
  const role = user?.role;
  const userId = (user?._id || user?.id)?.toString();

  if (role === USER_ROLES.MANAGER) {
    const isAssigned = await ManagerTeam.findOne({
      manager: userId,
      team: teamId,
    });
    const isProfileTeam = (user?.selectTeam?._id || user?.selectTeam)?.toString() === teamId;
    if (!isAssigned && !isProfileTeam) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You are not authorized to broadcast notifications to this team's subscribers",
      );
    }
  }

  const { title, message, eventType, metadata } = req.body;

  await TeamSubscriptionService.notifyTeamSubscribers(teamId, {
    title,
    message,
    eventType: eventType || "ANNOUNCEMENT",
    referenceId: teamId,
    referenceModel: "Team",
    metadata,
  });

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Notification broadcast queued successfully for team subscribers",
    data: null,
  });
});

export const TeamSubscriptionController = {
  toggleSubscription,
  getSubscriptionStatus,
  getMySubscribedTeams,
  getTeamSubscribersCount,
  broadcastToSubscribers,
};
