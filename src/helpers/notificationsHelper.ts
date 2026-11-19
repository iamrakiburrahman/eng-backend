import {
  INotification,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_TYPE,
} from "../app/modules/notification/notification.interface";
import { Notification } from "../app/modules/notification/notification.model";
import { User } from "../app/modules/user/user.model";

// ─────────────────────────────────────────────────────────────────────────────
// Category Resolver Helper (Guarantees every notification gets a valid category)
// ─────────────────────────────────────────────────────────────────────────────
export const getNotificationCategory = (
  type?: string,
  explicitCategory?: string
): NOTIFICATION_CATEGORY => {
  if (
    explicitCategory &&
    Object.values(NOTIFICATION_CATEGORY).includes(
      explicitCategory as NOTIFICATION_CATEGORY
    )
  ) {
    return explicitCategory as NOTIFICATION_CATEGORY;
  }

  if (!type) {
    return NOTIFICATION_CATEGORY.GENERAL_NEWS;
  }

  const upperType = String(type).toUpperCase();

  // 1. Transfers Gossip (⇄ blue arrows)
  if (upperType.includes("TRANSFER")) {
    return NOTIFICATION_CATEGORY.TRANSFERS_GOSSIP;
  }

  // 2. Match Updates (red target)
  if (
    upperType.includes("MATCH") ||
    upperType.includes("CLEAN_SHEET") ||
    upperType.includes("TEAM_UPDATE")
  ) {
    return NOTIFICATION_CATEGORY.MATCH_UPDATE;
  }

  // 3. Player of the Week / Honors / Profile / Rewards (yellow trophy)
  if (
    upperType.includes("PLAYER") ||
    upperType.includes("REWARD") ||
    upperType.includes("TOURNAMENT")
  ) {
    return NOTIFICATION_CATEGORY.PLAYER_OF_THE_WEEK;
  }

  // 4. General News (purple newspaper) - Default for News, Announcements, Auth, Subscriptions, etc.
  return NOTIFICATION_CATEGORY.GENERAL_NEWS;
};

// ─────────────────────────────────────────────────────────────────────────────
// Send a notification to a SINGLE user (real-time via socket + in-app DB)
// ─────────────────────────────────────────────────────────────────────────────
export const sendNotification = async (data: {
  receiver: string;         // User _id (string or ObjectId)
  title: string;
  message: string;
  type?: NOTIFICATION_TYPE | string;
  category?: NOTIFICATION_CATEGORY | string;
  metadata?: Record<string, any>;
}): Promise<INotification | null> => {
  try {
    const resolvedCategory = getNotificationCategory(data.type, data.category);

    const notification = (await Notification.create({
      receiver: data.receiver,
      title: data.title,
      message: data.message,
      type: (data.type as NOTIFICATION_TYPE) || NOTIFICATION_TYPE.GENERAL,
      category: resolvedCategory,
      isRead: false,
      metadata: data.metadata || {},
    })) as INotification;

    // Emit to user-specific socket room
    //@ts-ignore
    const io = global.io;
    if (io) {
      io.to(`user-${data.receiver}`).emit("notification", notification);
    }

    return notification;
  } catch (error) {
    console.error("sendNotification error:", error);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Send a notification to ALL ADMINS
// ─────────────────────────────────────────────────────────────────────────────
export const sendNotificationToAdmins = async (data: {
  title: string;
  message: string;
  type?: NOTIFICATION_TYPE | string;
  category?: NOTIFICATION_CATEGORY | string;
  metadata?: Record<string, any>;
}): Promise<void> => {
  try {
    // Find all admin users
    const admins = await User.find(
      { role: { $in: ["ADMIN", "SUPER_ADMIN"] } },
      "_id"
    );

    if (!admins.length) return;

    const resolvedCategory = getNotificationCategory(data.type, data.category);

    const notifications = admins.map((admin) => ({
      receiver: admin._id,
      title: data.title,
      message: data.message,
      type: (data.type as NOTIFICATION_TYPE) || NOTIFICATION_TYPE.GENERAL,
      category: resolvedCategory,
      isRead: false,
      metadata: data.metadata || {},
    }));

    await Notification.insertMany(notifications);

    // Emit real-time socket to each admin
    //@ts-ignore
    const io = global.io;
    if (io) {
      admins.forEach((admin) => {
        io.to(`user-${admin._id}`).emit("notification", {
          title: data.title,
          message: data.message,
          type: data.type || NOTIFICATION_TYPE.GENERAL,
          category: resolvedCategory,
        });
      });
    }
  } catch (error) {
    console.error("sendNotificationToAdmins error:", error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Legacy export (backward-compatible with old code if any)
// ─────────────────────────────────────────────────────────────────────────────
export const sendNotifications = sendNotification;