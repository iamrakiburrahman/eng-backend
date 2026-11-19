import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { MatchResultService } from './matchResult.service';
import { USER_ROLES } from '../../../enums/user';

// CREATE
const createMatchResult = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const userRole = user?.role;
  const isAdmin = userRole === USER_ROLES.ADMIN || userRole === USER_ROLES.SUPER_ADMIN;

  const payload = {
    ...req.body,
    addedBy: user?._id || user?.id,
    userRole,
    isAdmin,
    currentUser: user,
  };

  const result = await MatchResultService.createMatchResultToDB(payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Match event created successfully',
    data: result,
  });
});

// GET ALL
const getAllMatchResults = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchResultService.getAllMatchResultsFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match events retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});

// SINGLE
const getSingleMatchResult = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchResultService.getSingleMatchResultFromDB(
    req.params.id as string
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match event retrieved successfully',
    data: result,
  });
});

// UPDATE
const updateMatchResult = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const userRole = user?.role;
  const isAdmin = userRole === USER_ROLES.ADMIN || userRole === USER_ROLES.SUPER_ADMIN;

  const payload = {
    ...req.body,
    userRole,
    isAdmin,
    currentUser: user,
  };

  const result = await MatchResultService.updateMatchResultToDB(
    req.params.id as string,
    payload
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match event updated successfully',
    data: result,
  });
});

// DELETE
const deleteMatchResult = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchResultService.deleteMatchResultFromDB(
    req.params.id as string
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match event deleted successfully',
    data: result,
  });
});

// MATCH WISE
const getMatchWiseResults = catchAsync(async (req: Request, res: Response) => {
  const result = await MatchResultService.getMatchWiseResultsFromDB(
    req.params.matchId as string
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Match wise events retrieved successfully',
    data: result,
  });
});

export const MatchResultController = {
  createMatchResult,
  getAllMatchResults,
  getSingleMatchResult,
  updateMatchResult,
  deleteMatchResult,
  getMatchWiseResults,
};