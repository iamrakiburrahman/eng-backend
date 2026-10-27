import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { QuizService } from './quiz.service';
import { resolveEffectivePlayerForAction } from '../../../helpers/playerProfileResolver';

const createQuiz = catchAsync(async (req: Request, res: Response) => {
  const payload = { ...req.body };
  const files = req.files as any;

  if (files) {
    if (files.banner && files.banner[0]) {
      payload.banner = `/images/${files.banner[0].filename}`;
    } else if (files.image && files.image[0]) {
      payload.banner = `/images/${files.image[0].filename}`;
    }
  }

  const result = await QuizService.createQuizInDB(payload);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Quiz created successfully',
    data: result,
  });
});

const getAllQuizzes = catchAsync(async (req: Request, res: Response) => {
  const result = await QuizService.getAllQuizzesFromDB(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Quizzes retrieved successfully',
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPage: result.totalPages,
    },
    data: result.data,
  });
});

const getSingleQuiz = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const isPlayMode = req.query.mode === 'play';
  const result = await QuizService.getSingleQuizFromDB(id, !isPlayMode);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Quiz details retrieved successfully',
    data: result,
  });
});

const getActiveQuizzes = catchAsync(async (req: Request, res: Response) => {
  const currentUserId = (req.user as any)?.id || (req.user as any)?._id;
  const requestedProfileId = (req.query?.profileId ||
    req.query?.childId ||
    req.query?.playerId) as string | undefined;

  const result = await QuizService.getActiveQuizzesForClientFromDB(
    req.query,
    currentUserId,
    requestedProfileId
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Active quizzes retrieved successfully',
    data: result,
  });
});

const submitQuizAttempt = catchAsync(async (req: Request, res: Response) => {
  const quizId = req.params.id as string;
  const authUserId = (req.user as any)?.id || (req.user as any)?._id;
  const { answers, timeTakenSeconds } = req.body;
  const requestedProfileId = (req.body?.profileId ||
    req.body?.childId ||
    req.body?.playerId ||
    req.query?.profileId ||
    req.query?.childId ||
    req.query?.playerId) as string | undefined;

  if (!Array.isArray(answers)) {
    return sendResponse(res, {
      statusCode: StatusCodes.BAD_REQUEST,
      success: false,
      message: 'Answers must be provided as an array.',
      data: null,
    });
  }

  // Strictly resolve effective player (Parent -> Child Player or Player directly)
  const effectivePlayer = await resolveEffectivePlayerForAction(
    authUserId,
    requestedProfileId
  );
  const playerId = effectivePlayer._id.toString();

  const result = await QuizService.submitQuizAttemptInDB(
    quizId,
    playerId,
    answers,
    Number(timeTakenSeconds) || 0
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: result.isPassed
      ? `Congratulations! You passed and earned ${result.rewardEarned} ENG coins!`
      : `Quiz completed. You scored ${result.percentage}%.`,
    data: result,
  });
});

const getQuizLeaderboard = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const limit = Number(req.query.limit) || 20;
  const result = await QuizService.getQuizLeaderboardFromDB(id, limit);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Quiz leaderboard retrieved successfully',
    data: result,
  });
});

const getMyQuizAttempts = catchAsync(async (req: Request, res: Response) => {
  const authUserId = (req.user as any)?.id || (req.user as any)?._id;
  const requestedProfileId = (req.query?.profileId ||
    req.query?.childId ||
    req.query?.playerId) as string | undefined;

  const effectivePlayer = await resolveEffectivePlayerForAction(
    authUserId,
    requestedProfileId
  );
  const playerId = effectivePlayer._id.toString();

  const result = await QuizService.getMyQuizAttemptsFromDB(playerId);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'My quiz attempts retrieved successfully',
    data: result,
  });
});

const updateQuiz = catchAsync(async (req: Request, res: Response) => {
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

  const result = await QuizService.updateQuizInDB(id, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Quiz updated successfully',
    data: result,
  });
});

const deleteQuiz = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await QuizService.deleteQuizInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Quiz deleted successfully',
    data: result,
  });
});

const toggleQuizStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status } = req.body;
  const result = await QuizService.toggleQuizStatusInDB(id, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Quiz status updated to ${status}`,
    data: result,
  });
});

export const QuizController = {
  createQuiz,
  getAllQuizzes,
  getSingleQuiz,
  getActiveQuizzes,
  submitQuizAttempt,
  getQuizLeaderboard,
  getMyQuizAttempts,
  updateQuiz,
  deleteQuiz,
  toggleQuizStatus,
};
