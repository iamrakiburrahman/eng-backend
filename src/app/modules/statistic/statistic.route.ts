import express from "express";
import { StatisticController } from "./statistic.controller";


const router = express.Router();

router.get(
  "/league-summary",
  StatisticController.getLeagueSummary
);

router.get(
  "/season-leaderboard",
  StatisticController.getSeasonLeaderboard
);


// TOP 20 LEADERBOARDS
router.get("/top-goal-scorers", StatisticController.getTopGoalScorers);

router.get("/top-assists", StatisticController.getTopAssists);

router.get("/top-clean-sheets", StatisticController.getTopCleanSheets);

router.get("/top-overall-players", StatisticController.getTopOverallPlayers);

// UNIFIED LEADERBOARDS (supports ?timeframe=weekly | monthly | overall | all)
router.get("/leaderboards", StatisticController.getLeaderboards);

router.get(
  "/top-player/:leagueId",
  StatisticController.getTopPlayer
);

router.get(
  "/player-stats/:playerId/:leagueId",
  StatisticController.getPlayerSeasonStats
);

export default router;