import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { MatchResultService } from "../matchResult/matchResult.service";
import { StatisticService } from "./statistic.service";



const getTopPlayer = catchAsync(async (req: Request, res: Response) => {
  const { leagueId } = req.params;

  const result = await StatisticService.getTopPlayerFromDB(leagueId as string);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Top player fetched successfully",
    data: result,
  });
});

const getPlayerSeasonStats = catchAsync(
  async (req: Request, res: Response) => {
    const { playerId, leagueId } = req.params;

    const result = await StatisticService.getPlayerSeasonStatsFromDB(
      playerId as string,
      leagueId as string
    );

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Player season stats fetched successfully",
      data: result,
    });
  }
);



const getLeagueSummary = catchAsync(async (req: Request, res: Response) => {
  const result = await StatisticService.getLeagueSummaryFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "League statistics fetched successfully",
    data: result,
  });
});


const getSeasonLeaderboard = catchAsync(
  async (req: Request, res: Response) => {
    const { season } = req.query;

    const result = await StatisticService.getSeasonLeaderboardFromDB(
      season as string
    );

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Season leaderboard fetched successfully",
      data: result,
    });
  }
);

// 1. TOP GOAL SCORERS
const getTopGoalScorers = catchAsync(async (req: Request, res: Response) => {
  const result = await StatisticService.getTopGoalScorersFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Top goal scorers retrieved successfully",
    data: result,
  });
});

// 2. TOP ASSISTS
const getTopAssists = catchAsync(async (req: Request, res: Response) => {
  const result = await StatisticService.getTopAssistsFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Top assist players retrieved successfully",
    data: result,
  });
});

// 3. TOP CLEAN SHEETS
const getTopCleanSheets = catchAsync(async (req: Request, res: Response) => {
  const result = await StatisticService.getTopCleanSheetsFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Top clean sheet players retrieved successfully",
    data: result,
  });
});

// 4. TOP OVERALL PLAYERS
const getTopOverallPlayers = catchAsync(async (req: Request, res: Response) => {
  const result = await StatisticService.getTopOverallPlayersFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Top overall players retrieved successfully",
    data: result,
  });
});

// 5. UNIFIED LEADERBOARDS (Weekly, Monthly, Overall)
const getLeaderboards = catchAsync(async (req: Request, res: Response) => {
  const result = await StatisticService.getLeaderboardsFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Leaderboards retrieved successfully",
    data: result,
  });
});

export const StatisticController = {
  getTopPlayer,
  getPlayerSeasonStats,
  getLeagueSummary,
  getSeasonLeaderboard,
  getTopGoalScorers,
  getTopAssists,
  getTopCleanSheets,
  getTopOverallPlayers,
  getLeaderboards,
};