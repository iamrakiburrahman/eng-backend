import express from "express";
import { ROLE_GROUPS } from "../../../enums/user";
import auth from "../../middlewares/auth";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import { PlayerVotingController } from "./playerVoting.controller";

const router = express.Router();

// 1. PUBLIC & CLIENT STATISTICS ENDPOINTS
// Get active voting rounds (supports ?leagueId=...&ageGroup=...&type=WEEK|MONTH)
router.get("/active", auth(false), PlayerVotingController.getActiveVotingPolls);

// Hall of Fame - Past winners of Player of the Week / Month
router.get("/winners", PlayerVotingController.getPastWinners);

// Live voting results / leaderboard for a poll
router.get("/:id/results", auth(false), PlayerVotingController.getVotingLeaderboard);

// Specific vote status check endpoint for mobile/client
router.get("/:id/my-vote", auth(false), PlayerVotingController.checkMyVoteInPoll);
router.get("/:id/check-vote", auth(false), PlayerVotingController.checkMyVoteInPoll);

// 2. AUTHENTICATED USER VOTING FLOW
// Cast a vote for a pre-selected nominee player
router.post(
  "/:id/vote",
  auth(...ROLE_GROUPS.All),
  PlayerVotingController.castVote,
);

// Get my voting history
router.get(
  "/my-votes",
  auth(...ROLE_GROUPS.All),
  PlayerVotingController.getMyVotes,
);

// 3. ADMIN MANAGEMENT ENDPOINTS
router
  .route("/")
  .post(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    PlayerVotingController.createVotingPoll,
  )
  .get(auth(false), PlayerVotingController.getAllVotingPolls);

router.patch(
  "/:id/status",
  auth(...ROLE_GROUPS.ADMINS),
  PlayerVotingController.toggleVotingStatus,
);

router
  .route("/:id")
  .get(auth(false), PlayerVotingController.getSingleVotingPoll)
  .patch(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    PlayerVotingController.updateVotingPoll,
  )
  .delete(auth(...ROLE_GROUPS.ADMINS), PlayerVotingController.deleteVotingPoll);

export const PlayerVotingRoutes = router;
export default router;

