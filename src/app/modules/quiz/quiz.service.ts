import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { IQuiz, IQuizAttempt } from './quiz.interface';
import { Quiz, QuizAttempt } from './quiz.model';
import { User } from '../user/user.model';
import { Types } from 'mongoose';
import { recordCoinTransaction } from '../../../helpers/coinLedgerHelper';
import { COIN_TRANSACTION_CATEGORY } from '../coinTransaction/coinTransaction.interface';
import { resolveEffectivePlayerForAction } from '../../../helpers/playerProfileResolver';

const parsePayload = (payload: any): any => {
  const data = { ...payload };

  if (typeof data.questions === 'string') {
    try {
      data.questions = JSON.parse(data.questions);
    } catch {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid JSON for questions.');
    }
  }

  if (data.rewardPoints !== undefined) data.rewardPoints = Number(data.rewardPoints);
  if (data.passingPercentage !== undefined) data.passingPercentage = Number(data.passingPercentage);
  if (data.timeLimitSeconds !== undefined) data.timeLimitSeconds = Number(data.timeLimitSeconds);

  if (data.startDate) data.startDate = new Date(data.startDate);
  if (data.endDate) data.endDate = new Date(data.endDate);

  if (!data.league || data.league === 'all' || data.league === '' || data.league === 'null') {
    delete data.league;
  }

  return data;
};

const createQuizInDB = async (payload: Partial<IQuiz>): Promise<IQuiz> => {
  const data = parsePayload(payload);

  if (!data.title || !data.questions || !data.startDate || !data.endDate) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Missing required fields (title, questions, startDate, endDate).'
    );
  }

  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Quiz must contain at least 1 question.');
  }

  // Validate each question
  data.questions.forEach((q: any, idx: number) => {
    if (!q.question || !Array.isArray(q.options) || q.options.length < 2) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Question ${idx + 1} must have question text and at least 2 options.`
      );
    }
    if (
      q.correctOptionIndex === undefined ||
      q.correctOptionIndex < 0 ||
      q.correctOptionIndex >= q.options.length
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Question ${idx + 1} has an invalid correctOptionIndex.`
      );
    }
  });

  const quiz = await Quiz.create(data);
  return quiz;
};

const getAllQuizzesFromDB = async (
  query: Record<string, unknown>
): Promise<{ data: IQuiz[]; total: number; page: number; limit: number; totalPages: number }> => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};

  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }

  if (query.category && query.category !== 'all') {
    filter.category = query.category;
  }

  if (query.searchTerm) {
    const searchRegex = new RegExp(String(query.searchTerm), 'i');
    filter.$or = [{ title: searchRegex }, { description: searchRegex }, { category: searchRegex }];
  }

  const [quizzes, total] = await Promise.all([
    Quiz.find(filter)
      .populate('league', 'leagueName season ageGroup')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Quiz.countDocuments(filter),
  ]);

  return {
    data: quizzes as unknown as IQuiz[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

const getSingleQuizFromDB = async (id: string, includeAnswers = true): Promise<any> => {
  const quiz = await Quiz.findById(id).populate('league', 'leagueName season ageGroup').lean();
  if (!quiz) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found.');
  }

  if (!includeAnswers && Array.isArray(quiz.questions)) {
    // Strip correct answers for clients playing
    quiz.questions = quiz.questions.map((q: any) => ({
      question: q.question,
      options: q.options,
      points: q.points || 10,
    })) as any;
  }

  return quiz;
};

const getActiveQuizzesForClientFromDB = async (
  query: Record<string, unknown>,
  currentUserId?: string,
  requestedProfileId?: string
): Promise<any[]> => {
  const now = new Date();

  const filter: Record<string, any> = {
    status: 'active',
    startDate: { $lte: now },
    endDate: { $gte: now },
  };

  if (query.category && query.category !== 'all') {
    filter.category = query.category;
  }

  if (query.leagueId || query.league) {
    filter.league = query.leagueId || query.league;
  }

  const quizzes = await Quiz.find(filter)
    .populate('league', 'leagueName season ageGroup')
    .sort({ isFeatured: -1, createdAt: -1 })
    .lean();

  let userAttemptsMap = new Map<string, any>();
  if (currentUserId && quizzes.length > 0) {
    let effectivePlayerId = currentUserId;
    try {
      const resolved = await resolveEffectivePlayerForAction(
        currentUserId,
        requestedProfileId
      );
      if (resolved?._id) {
        effectivePlayerId = resolved._id.toString();
      }
    } catch {
      // Fallback to currentUserId
    }

    const quizIds = quizzes.map((q) => q._id);
    const attempts = await QuizAttempt.find({
      quiz: { $in: quizIds },
      user: effectivePlayerId,
    })
      .sort({ score: -1 })
      .lean();

    attempts.forEach((att) => {
      const qKey = att.quiz.toString();
      if (!userAttemptsMap.has(qKey)) {
        userAttemptsMap.set(qKey, att);
      }
    });
  }

  // Format safely without exposing answers
  return quizzes.map((quiz) => {
    const userAttempt = userAttemptsMap.get(quiz._id.toString());
    const safeQuestions = (quiz.questions || []).map((q: any) => ({
      question: q.question,
      options: q.options,
      points: q.points || 10,
    }));

    return {
      _id: quiz._id,
      title: quiz.title,
      description: quiz.description,
      banner: quiz.banner,
      category: quiz.category,
      league: quiz.league,
      rewardPoints: quiz.rewardPoints,
      passingPercentage: quiz.passingPercentage,
      timeLimitSeconds: quiz.timeLimitSeconds,
      totalQuestions: safeQuestions.length,
      questions: safeQuestions,
      startDate: quiz.startDate,
      endDate: quiz.endDate,
      status: quiz.status,
      hasAttempted: Boolean(userAttempt),
      isPassed: Boolean(userAttempt?.isPassed),
      lastScore: userAttempt?.score ?? null,
      lastPercentage: userAttempt?.percentage ?? null,
      rewardEarned: userAttempt?.rewardEarned ?? 0,
    };
  });
};

const submitQuizAttemptInDB = async (
  quizId: string,
  userId: string,
  submittedAnswers: { questionIndex: number; selectedOptionIndex: number }[],
  timeTakenSeconds = 0
): Promise<any> => {
  const quiz = await Quiz.findById(quizId);
  if (!quiz) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found.');
  }

  const now = new Date();
  if (quiz.status !== 'active') {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This quiz is not currently active.');
  }

  if (quiz.startDate > now) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Quiz has not started yet.');
  }

  if (quiz.endDate < now) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Quiz period has ended.');
  }

  // Strictly enforce 1 attempt per quiz (whether passed or failed)
  const existingAttempt = await QuizAttempt.findOne({
    quiz: quizId,
    user: userId,
  });

  if (existingAttempt) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'You have already attempted this quiz. Only 1 attempt is allowed.'
    );
  }

  // Evaluate answers
  const originalQuestions = quiz.questions || [];
  let earnedScore = 0;
  let totalPossible = 0;
  let correctCount = 0;

  const answersBreakdown = originalQuestions.map((q, idx) => {
    const qPoints = q.points || 10;
    totalPossible += qPoints;

    const submitted = (submittedAnswers || []).find((a) => a.questionIndex === idx);
    const selectedIdx = submitted ? submitted.selectedOptionIndex : -1;
    const isCorrect = selectedIdx === q.correctOptionIndex;

    let pointsForThis = 0;
    if (isCorrect) {
      pointsForThis = qPoints;
      earnedScore += qPoints;
      correctCount += 1;
    }

    return {
      questionIndex: idx,
      question: q.question,
      options: q.options,
      selectedOptionIndex: selectedIdx,
      correctOptionIndex: q.correctOptionIndex,
      explanation: q.explanation || '',
      isCorrect,
      pointsEarned: pointsForThis,
    };
  });

  const percentage = totalPossible > 0 ? Number(((earnedScore / totalPossible) * 100).toFixed(1)) : 0;
  const isPassed = percentage >= quiz.passingPercentage;

  // Determine rewards (Award ENG coins if passed on this attempt - do NOT add to rewardPoint)
  let rewardToAward = 0;
  if (isPassed && quiz.rewardPoints > 0) {
    rewardToAward = quiz.rewardPoints;

    // Credit ENG coins and record in CoinTransaction ledger (no rewardPoint modification)
    try {
      await recordCoinTransaction({
        userId,
        amount: rewardToAward,
        category: COIN_TRANSACTION_CATEGORY.QUIZ_REWARD,
        title: `Quiz Reward: ${quiz.title}`,
        description: `Earned ${rewardToAward} ENG coins for passing quiz "${quiz.title}" with score ${percentage}%.`,
        referenceId: `${quiz._id.toString()}_quiz_reward`,
      });
    } catch (coinErr) {
      console.error('Failed to record coin transaction for quiz:', coinErr);
    }
  }

  // Save attempt
  let attempt;
  try {
    attempt = await QuizAttempt.create({
      quiz: quizId,
      user: userId,
      score: earnedScore,
      totalPossiblePoints: totalPossible,
      percentage,
      isPassed,
      rewardEarned: rewardToAward,
      answers: answersBreakdown.map((a) => ({
        questionIndex: a.questionIndex,
        selectedOptionIndex: a.selectedOptionIndex,
        isCorrect: a.isCorrect,
        pointsEarned: a.pointsEarned,
      })),
      timeTakenSeconds,
      completedAt: now,
    });
  } catch (err: any) {
    if (err.code === 11000) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'You have already attempted this quiz. Only 1 attempt is allowed.'
      );
    }
    throw err;
  }

  // Update quiz counters
  await Quiz.findByIdAndUpdate(quizId, {
    $inc: {
      totalAttempts: 1,
      totalPassed: isPassed ? 1 : 0,
      totalRewardsDistributed: rewardToAward,
    },
  });

  return {
    attemptId: attempt._id,
    quizId: quiz._id,
    quizTitle: quiz.title,
    score: earnedScore,
    totalPossiblePoints: totalPossible,
    correctCount,
    totalQuestions: originalQuestions.length,
    percentage,
    isPassed,
    passingPercentage: quiz.passingPercentage,
    rewardEarned: rewardToAward,
    timeTakenSeconds,
    review: answersBreakdown,
  };
};

const getQuizLeaderboardFromDB = async (quizId: string, limit = 20): Promise<any[]> => {
  return QuizAttempt.find({ quiz: quizId, isPassed: true })
    .populate('user', 'firstName lastName profile userName')
    .sort({ score: -1, timeTakenSeconds: 1, completedAt: 1 })
    .limit(limit)
    .lean();
};

const getMyQuizAttemptsFromDB = async (userId: string): Promise<any[]> => {
  return QuizAttempt.find({ user: userId })
    .populate('quiz', 'title category banner rewardPoints passingPercentage')
    .sort({ completedAt: -1 })
    .lean();
};

const updateQuizInDB = async (id: string, payload: Partial<IQuiz>): Promise<IQuiz | null> => {
  const data = parsePayload(payload);
  const updated = await Quiz.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found.');
  }
  return updated;
};

const deleteQuizInDB = async (id: string): Promise<IQuiz | null> => {
  const deleted = await Quiz.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found.');
  }
  await QuizAttempt.deleteMany({ quiz: id });
  return deleted;
};

const toggleQuizStatusInDB = async (id: string, status: string): Promise<IQuiz | null> => {
  if (!['draft', 'active', 'completed', 'archived'].includes(status)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid quiz status.');
  }
  const updated = await Quiz.findByIdAndUpdate(id, { status }, { new: true });
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Quiz not found.');
  }
  return updated;
};

export const QuizService = {
  createQuizInDB,
  getAllQuizzesFromDB,
  getSingleQuizFromDB,
  getActiveQuizzesForClientFromDB,
  submitQuizAttemptInDB,
  getQuizLeaderboardFromDB,
  getMyQuizAttemptsFromDB,
  updateQuizInDB,
  deleteQuizInDB,
  toggleQuizStatusInDB,
};
