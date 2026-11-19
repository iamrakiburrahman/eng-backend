import express from "express";
import auth from "../../middlewares/auth";
import { ROLE_GROUPS, USER_ROLES } from "../../../enums/user";
import { MatchController } from "./match.controller";

const router = express.Router();

router.get(
  "/manager-upcoming-matches",
  auth(USER_ROLES.MANAGER),
  MatchController.getUpcomingMatchesForManager,
);
// CREATE + GET ALL
router
  .route("/")
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    MatchController.createMatch,
  )
  .get(MatchController.getAllMatches);

router.get(
  "/my-matches",
  auth(USER_ROLES.REFEREE),
  MatchController.getMatchesForReferee,
);

router.get("/schedule-dates", MatchController.getMatchScheduleDates);

// DYNAMIC FEEDBACK WINDOW SETTING (GET & ADMIN UPDATE)
router.get(
  "/feedback-setting",
  auth(...ROLE_GROUPS.All),
  MatchController.getMatchFeedbackSetting,
);
router.patch(
  "/feedback-setting",
  auth(...ROLE_GROUPS.ADMINS),
  MatchController.updateMatchFeedbackSetting,
);

router.patch(
  "/review/:id",
  auth(
    USER_ROLES.MANAGER,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPER_ADMIN,
    USER_ROLES.REFEREE,
  ),
  MatchController.addMatchReview,
);

router.get("/overview", MatchController.getMatchOverview);

// SINGLE + UPDATE + DELETE
router
  .route("/:id")
  .get(MatchController.getSingleMatch)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    MatchController.updateMatch,
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    MatchController.deleteMatch,
  );

// TOGGLE STATUS
router.patch(
  "/toggle-status/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.REFEREE),
  MatchController.toggleMatchStatus,
);

// ⏱MATCH TIMER CONTROL (START, PAUSE, RESUME, FINISH)
router.patch(
  "/:id/timer",
  auth(USER_ROLES.REFEREE, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  MatchController.updateMatchTimer,
);

// MODIFY SCORE (ADMIN/SUPER ADMIN/REFEREE)
router.patch(
  "/:id/modify-score",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.REFEREE),
  MatchController.modifyMatchScore,
);

// DIRECT STATUS UPDATE (ADMIN / SUPER ADMIN / REFEREE)
router.patch(
  "/:id/status",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.REFEREE),
  MatchController.updateMatchStatus,
);

// CLEAN SHEET MANAGEMENT (AUTO + MANUAL OVERRIDE)
router.get(
  "/:id/clean-sheets",
  auth(...ROLE_GROUPS.All),
  MatchController.getMatchCleanSheets,
);

router.post(
  "/:id/clean-sheets",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  MatchController.manualAwardCleanSheet,
);

router.delete(
  "/:id/clean-sheets/:playerId",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  MatchController.manualRevokeCleanSheet,
);

export default router;
