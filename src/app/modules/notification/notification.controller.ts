import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { NotificationService } from "./notification.service";
import ApiError from "../../../errors/ApiErrors";



// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: GET MY NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id;

  const result = await NotificationService.getMyNotifications(
    userId,
    req.query
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Your notifications retrieved successfully",
    pagination: result.meta,
    data: result.result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: GET UNREAD COUNT
// ─────────────────────────────────────────────────────────────────────────────
const getUnreadCount = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id;

  const result = await NotificationService.getUnreadCount(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Unread notification count retrieved",
    data: result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: MARK SINGLE AS READ
// ─────────────────────────────────────────────────────────────────────────────
const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id;
  const { id } = req.params;

  if (typeof id !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Notification ID must be a string");
  }

  const result = await NotificationService.markAsRead(id, userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Notification marked as read",
    data: result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: MARK ALL AS READ
// ─────────────────────────────────────────────────────────────────────────────
const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)._id;

  const result = await NotificationService.markAllAsRead(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: { modifiedCount: result.modifiedCount },
  });
});
// ─────────────────────────────────────────────────────────────────────────────
// PLAYER / USER: DELETE ALL NOTIFICATIONS 
// ─────────────────────────────────────────────────────────────────────────────
const deleteAllNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = (req.user as any)?._id || (req.user as any)?.id;

  const result = await NotificationService.deleteAllNotifications(userId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "All notifications deleted successfully",
    data: result,
  });
});

const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await NotificationService.deleteNotification(id as string, req.user);
  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Notification deleted successfully",
    data: result,
  });
});

export const NotificationController = {

  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteAllNotifications,
  deleteNotification
};