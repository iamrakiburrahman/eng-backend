import express from "express";
import auth from "../../middlewares/auth";
import { ROLE_GROUPS, USER_ROLES } from "../../../enums/user";
import { TeamCoinTransactionController } from "./teamCoinTransaction.controller";

const router = express.Router();

// View specific team coin history
router.get(
  "/history/:teamId",
  auth(...ROLE_GROUPS.All),
  TeamCoinTransactionController.getTeamCoinHistory
);

// ADMIN: Manually adjust (credit/debit) team coins with reason
router.patch(
  "/adjust/:teamId",
  auth(...ROLE_GROUPS.ADMINS),
  TeamCoinTransactionController.adminAdjustTeamCoins
);

export const TeamCoinTransactionRoutes = router;
