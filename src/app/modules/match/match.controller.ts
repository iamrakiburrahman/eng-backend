import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { MatchService } from './match.service';

// CREATE
const createMatch = catchAsync(async (req: Request, res: Response) => {

  const payload = req.body;

  const result =
    await MatchService.createMatchToDB(payload);


  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match created successfully',
    data: result,
  });

});


// GET ALL
const getAllMatches = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchService.getAllMatchesFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Matches retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});

// GET MATCHES FOR REFEREE
const getMatchesForReferee = catchAsync(async (req: Request, res: Response) => {
  const refereeId = (req.user as any)?._id || (req.user as any)?.id;

  const result = await MatchService.getMatchesByRefereeFromDB(
    refereeId,
    req.query
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Referee matches retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});

// SINGLE
const getSingleMatch = catchAsync(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    

  const result = await MatchService.getSingleMatchFromDB(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match retrieved successfully',
    data: result,
  });
});

// UPDATE
const updateMatch = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
    const payload = req.body;


  const result = await MatchService.updateMatchToDB(id, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match updated successfully',
    data: result,
  });
});

// DELETE
const deleteMatch = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;


  const result = await MatchService.deleteMatchFromDB(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match deleted successfully',
    data: result,
  });
});

// TOGGLE STATUS
const toggleMatchStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userRole = (req.user as any)?.role || "";

  const result = await MatchService.toggleMatchStatusToDB(id, userRole);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match status updated successfully',
    data: result,
  });
});


const addMatchReview = catchAsync(async (req: Request, res: Response) => {
  const matchId = req.params.id as string;

  const result = await MatchService.addMatchReviewToDB(matchId, req.body, req.user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match review added successfully',
    data: result,
  });
});


const getUpcomingMatchesForManager = catchAsync(
  async (req: Request, res: Response) => {
    const managerId =
      (req.user as any)?._id || (req.user as any)?.id;

    const result =
      await MatchService.getUpcomingMatchesForManagerFromDB(
        managerId,
        req.query,
      );

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Upcoming matches retrieved successfully',
      pagination: result.meta,
      data: result.result,
    });
  },
);


const updateMatchTimer = catchAsync(async (req: Request, res: Response) => {
  const matchId = req.params.id as string;
  const { action } = req.body;

  const result = await MatchService.updateMatchTimerInDB(
    matchId,
    action,
    req.user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: `Match timer action '${action}' processed successfully`,
    data: result,
  });
});

const modifyMatchScore = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await MatchService.modifyMatchScoreInDB(id as string, req.body, req.user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Match score modified successfully",
    data: result,
  });
});

const updateMatchStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const userRole = (req.user as any)?.role || "";
  const result = await MatchService.updateMatchStatusInDB(id as string, req.body, userRole);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Match status updated successfully",
    data: result,
  });
});

const getMatchScheduleDates = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchService.getMatchScheduleDatesFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Match schedule dates retrieved successfully",
    data: result,
  });
});

const getMatchFeedbackSetting = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchService.getMatchFeedbackSettingFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Match feedback setting retrieved successfully",
    data: result,
  });
});

const updateMatchFeedbackSetting = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchService.updateMatchFeedbackSettingInDB(req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Match feedback setting updated successfully",
    data: result,
  });
});

const getMatchCleanSheets = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await MatchService.getMatchCleanSheetsFromDB(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Match clean sheets retrieved successfully",
    data: result,
  });
});

const manualAwardCleanSheet = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { playerId, reason } = req.body;
  const adminId = (req.user as any)?._id || (req.user as any)?.id;

  const result = await MatchService.manualAwardCleanSheetInDB(
    id,
    playerId,
    adminId,
    reason
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result,
  });
});

const manualRevokeCleanSheet = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const playerId = req.params.playerId as string;
  const { reason } = req.body || {};
  const adminId = (req.user as any)?._id || (req.user as any)?.id;

  const result = await MatchService.manualRevokeCleanSheetInDB(
    id,
    playerId,
    adminId,
    reason
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result,
  });
});

const getMatchOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchService.getMatchOverviewFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Match overview analytics retrieved successfully",
    data: result,
  });
});

export const MatchController = {
  createMatch,
  getAllMatches,
  getSingleMatch,
  updateMatch,
  deleteMatch,
  toggleMatchStatus,
  updateMatchStatus,
  getMatchesForReferee,
  addMatchReview,
  getUpcomingMatchesForManager,
  updateMatchTimer,
  modifyMatchScore,
  getMatchScheduleDates,
  getMatchFeedbackSetting,
  updateMatchFeedbackSetting,
  getMatchCleanSheets,
  manualAwardCleanSheet,
  manualRevokeCleanSheet,
  getMatchOverview,
};