import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { ScorePredictionService } from './scorePrediction.service';
import { resolveEffectivePlayerForAction } from '../../../helpers/playerProfileResolver';

const createPredictionRound = catchAsync(async (req: Request, res: Response) => {
  const payload = { ...req.body };
  const files = req.files as any;

  if (files) {
    if (files.banner && files.banner[0]) {
      payload.banner = `/images/${files.banner[0].filename}`;
    } else if (files.image && files.image[0]) {
      payload.banner = `/images/${files.image[0].filename}`;
    }
  }

  const result = await ScorePredictionService.createPredictionRoundInDB(payload);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Score prediction round created successfully',
    data: result,
  });
});

const getAllPredictionRounds = catchAsync(async (req: Request, res: Response) => {
  const result = await ScorePredictionService.getAllPredictionRoundsFromDB(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Score prediction rounds retrieved successfully',
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPage: result.totalPages,
    },
    data: result.data,
  });
});

const getSinglePredictionRound = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await ScorePredictionService.getSinglePredictionRoundFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Prediction round details retrieved successfully',
    data: result,
  });
});

const getActivePredictionRounds = catchAsync(async (req: Request, res: Response) => {
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const requestedProfileId = (req.query?.profileId ||
    req.query?.childId ||
    req.query?.playerId) as string | undefined;

  const result = await ScorePredictionService.getActivePredictionRoundsForClientFromDB(
    req.query,
    currentUserId,
    requestedProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Active prediction rounds retrieved successfully',
    data: result,
  });
});

const submitUserPrediction = catchAsync(async (req: Request, res: Response) => {
  const roundId = req.params.id as string;
  const authUserId = (req.user as any)?.id || (req.user as any)?._id;
  const { predictions } = req.body;
  const requestedProfileId = (req.body?.profileId ||
    req.body?.childId ||
    req.body?.playerId ||
    req.query?.profileId ||
    req.query?.childId ||
    req.query?.playerId) as string | undefined;

  if (!Array.isArray(predictions)) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: 'Predictions must be provided as an array.',
      data: null,
    });
  }

  // Strictly resolve effective player (Parent -> Child Player or Player directly)
  const effectivePlayer = await resolveEffectivePlayerForAction(
    authUserId,
    requestedProfileId
  );
  const playerId = effectivePlayer._id.toString();

  const result = await ScorePredictionService.submitUserPredictionInDB(
    roundId,
    playerId,
    predictions
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Predictions submitted successfully! Good luck!',
    data: result,
  });
});

const settlePredictionRound = catchAsync(async (req: Request, res: Response) => {
  const roundId = req.params.id as string;
  const result = await ScorePredictionService.settlePredictionRoundInDB(roundId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Round settled successfully! Distributed ${result.totalCoinsDistributed} coins to ${result.totalWinners} winners.`,
    data: result,
  });
});

const getRoundLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const roundId = req.params.id as string;
  const limit = Number(req.query.limit) || 25;
  const result = await ScorePredictionService.getRoundLeaderboardFromDB(roundId, limit);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Prediction leaderboard retrieved successfully',
    data: result,
  });
});

const getMyPredictions = catchAsync(async (req: Request, res: Response) => {
  const authUserId = (req.user as any)?.id || (req.user as any)?._id;
  const requestedProfileId = (req.query?.profileId ||
    req.query?.childId ||
    req.query?.playerId) as string | undefined;

  const effectivePlayer = await resolveEffectivePlayerForAction(
    authUserId,
    requestedProfileId
  );
  const playerId = effectivePlayer._id.toString();

  const result = await ScorePredictionService.getMyPredictionsFromDB(playerId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'My predictions retrieved successfully',
    data: result,
  });
});

const updatePredictionRound = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const payload = { ...req.body };
  const files = req.files as any;

  if (files) {
    if (files.banner && files.banner[0]) {
      payload.banner = `/images/${files.banner[0].filename}`;
    } else if (files.image && files.image[0]) {
      payload.banner = `/images/${files.image[0].filename}`;
    }
  }

  const result = await ScorePredictionService.updatePredictionRoundInDB(id, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Prediction round updated successfully',
    data: result,
  });
});

const deletePredictionRound = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await ScorePredictionService.deletePredictionRoundInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Prediction round deleted successfully',
    data: result,
  });
});

export const ScorePredictionController = {
  createPredictionRound,
  getAllPredictionRounds,
  getSinglePredictionRound,
  getActivePredictionRounds,
  submitUserPrediction,
  settlePredictionRound,
  getRoundLeaderboard,
  getMyPredictions,
  updatePredictionRound,
  deletePredictionRound,
};
