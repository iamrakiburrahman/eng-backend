import express from "express";
import { ROLE_GROUPS } from "../../../enums/user";
import auth from "../../middlewares/auth";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import { RefereeVotingController } from "./refereeVoting.controller";

const router = express.Router();

// 1. PUBLIC & CLIENT STATISTICS ENDPOINTS
// Get active voting rounds (supports ?leagueId=...&votingType=WEEK|MONTH)
router.get("/active", auth(false), RefereeVotingController.getActiveVotingPolls);

// Hall of Fame - Past winners of Referee of the Week / Month
router.get("/winners", RefereeVotingController.getPastWinners);

// Eligible registered referees for selection in admin / poll creation dropdown
router.get(
  "/eligible-referees",
  auth(false),
  RefereeVotingController.getEligibleReferees
);

// Live voting results / leaderboard for a poll
router.get(
  "/:id/results",
  auth(false),
  RefereeVotingController.getVotingLeaderboard
);

// Specific vote status check endpoint for mobile/client
router.get(
  "/:id/my-vote",
  auth(false),
  RefereeVotingController.checkMyVoteInPoll
);
router.get(
  "/:id/check-vote",
  auth(false),
  RefereeVotingController.checkMyVoteInPoll
);

// 2. AUTHENTICATED USER VOTING FLOW
// Cast a vote for a pre-selected nominee referee
router.post(
  "/:id/vote",
  auth(...ROLE_GROUPS.All),
  RefereeVotingController.castVote
);

// Get my voting history
router.get(
  "/my-votes",
  auth(...ROLE_GROUPS.All),
  RefereeVotingController.getMyVotes
);

// 3. ADMIN MANAGEMENT ENDPOINTS
router
  .route("/")
  .post(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    RefereeVotingController.createVotingPoll
  )
  .get(auth(false), RefereeVotingController.getAllVotingPolls);

router.patch(
  "/:id/status",
  auth(...ROLE_GROUPS.ADMINS),
  RefereeVotingController.toggleVotingStatus
);

router
  .route("/:id")
  .get(auth(false), RefereeVotingController.getSingleVotingPoll)
  .patch(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    RefereeVotingController.updateVotingPoll
  )
  .delete(
    auth(...ROLE_GROUPS.ADMINS),
    RefereeVotingController.deleteVotingPoll
  );

export const RefereeVotingRoutes = router;
export default router;
