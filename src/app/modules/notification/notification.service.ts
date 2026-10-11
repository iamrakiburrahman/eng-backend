import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import QueryBuilder from "../../../util/queryBuilder";
import { Notification } from "./notification.model";
import { getNotificationCategory } from "../../../helpers/notificationsHelper";

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: GET OWN NOTIFICATIONS (paginated)
// ─────────────────────────────────────────────────────────────────────────────
const getMyNotifications = async (
  userId: string,
  query: Record<string, any>,
) => {
  const notificationQuery = new QueryBuilder(
    Notification.find({ receiver: userId }).sort({ createdAt: -1 }),
    query,
  )
    .filter()
    .paginate()
    .fields();

  const rawResult = await notificationQuery.modelQuery.lean();
  const meta = await notificationQuery.getPaginationInfo();

  // Guarantee that every notification returned has a non-null, valid category
  const result = (rawResult || []).map((notif: any) => ({
    ...notif,
    category: notif.category || getNotificationCategory(notif.type),
  }));

  return { meta, result };
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: GET UNREAD COUNT
// ─────────────────────────────────────────────────────────────────────────────
const getUnreadCount = async (userId: string) => {
  const count = await Notification.countDocuments({
    receiver: userId,
    isRead: false,
  });

  return { unreadCount: count };
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: MARK SINGLE NOTIFICATION AS READ
// ─────────────────────────────────────────────────────────────────────────────
const markAsRead = async (notificationId: string, userId: string) => {
  const notification = await Notification.findOne({
    _id: notificationId,
    receiver: userId,
  });

  if (!notification) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Notification not found or not yours",
    );
  }

  notification.isRead = true;
  await notification.save();

  return notification;
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: MARK ALL NOTIFICATIONS AS READ
// ─────────────────────────────────────────────────────────────────────────────
const markAllAsRead = async (userId: string) => {
  const result = await Notification.updateMany(
    { receiver: userId, isRead: false },
    { $set: { isRead: true } },
  );

  return {
    modifiedCount: result.modifiedCount,
    message: `${result.modifiedCount} notifications marked as read`,
  };
};

const deleteNotification = async (id: string) => {
  const result = await Notification.findByIdAndDelete(id);
  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER: DELETE ALL NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────
const deleteAllNotifications = async (userId: string) => {
  const result = await Notification.deleteMany({ receiver: userId });

  return result;
};

export const NotificationService = {
  getMyNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteAllNotifications,
  deleteNotification,
};
