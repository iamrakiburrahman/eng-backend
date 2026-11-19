import express from "express";
import auth from "../../middlewares/auth";
import { ROLE_GROUPS, USER_ROLES } from "../../../enums/user";
import { NotificationController } from "./notification.controller";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// GET player's own notifications (paginated)
router.get(
  "/my",
  auth(...ROLE_GROUPS.All),
  NotificationController.getMyNotifications
);
router.get(
  "/unread-count",
  auth(...ROLE_GROUPS.All),
  NotificationController.getUnreadCount
);

router.patch(
  "/read-all",
  auth(...ROLE_GROUPS.All),
  NotificationController.markAllAsRead
);
router.patch(
  "/:id/read",
  auth(...ROLE_GROUPS.All),
  NotificationController.markAsRead
);
router.delete("/delete/:id", auth(...ROLE_GROUPS.All), NotificationController.deleteNotification);
router.delete("/clear-all", auth(...ROLE_GROUPS.All), NotificationController.deleteAllNotifications);

export default router;