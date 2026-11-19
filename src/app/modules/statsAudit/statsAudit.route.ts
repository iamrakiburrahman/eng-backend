import express from "express";
import auth from "../../middlewares/auth";
import { USER_ROLES } from "../../../enums/user";
import { StatsAuditController } from "./statsAudit.controller";

const router = express.Router();

// ADMIN: Manually edit any player stats with audit reason
router.patch(
  "/edit/:playerId",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  StatsAuditController.adminEditPlayerStats
);

// ADMIN: View player stats edit audit history
router.get(
  "/audit-logs/:playerId",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  StatsAuditController.getPlayerStatsAuditLogs
);

export default router;
