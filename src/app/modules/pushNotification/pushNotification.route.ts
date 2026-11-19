import express from "express";
import { NotificationController } from "./pushNotification.controller";
import auth from "../../middlewares/auth";
import { ROLE_GROUPS } from "../../../enums/user";

const router = express.Router();

router.post("/send", auth(...ROLE_GROUPS.ADMINS), NotificationController.sendNotification);
router.patch("/cancel/:id", auth(...ROLE_GROUPS.ADMINS), NotificationController.cancelScheduledNotification);
router.post("/send-now/:id", auth(...ROLE_GROUPS.ADMINS), NotificationController.sendScheduledNow);
router.get("/", auth(...ROLE_GROUPS.ADMINS), NotificationController.getNotifications);
router.delete("/clear-all", auth(...ROLE_GROUPS.ADMINS), NotificationController.clearAllNotifications);
router.delete("/delete/:id", auth(...ROLE_GROUPS.ADMINS), NotificationController.deleteNotification);

// Dynamic Match Reminders Settings & Upcoming Match Queue
router.get("/match-reminders/settings", auth(...ROLE_GROUPS.ADMINS), NotificationController.getMatchReminderSettings);
router.patch("/match-reminders/settings", auth(...ROLE_GROUPS.ADMINS), NotificationController.updateMatchReminderSettings);
router.get("/match-reminders/upcoming", auth(...ROLE_GROUPS.ADMINS), NotificationController.getUpcomingMatchesPreview);
router.post("/match-reminders/trigger-now", auth(...ROLE_GROUPS.ADMINS), NotificationController.triggerMatchRemindersNow);
router.post("/match-reminders/send-single/:matchId", auth(...ROLE_GROUPS.ADMINS), NotificationController.sendSingleMatchReminderNow);

export default router;