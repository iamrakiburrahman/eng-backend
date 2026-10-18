import { Schema, model } from 'mongoose';
import { IQuiz, IQuizAttempt } from './quiz.interface';

const QuizQuestionSchema = new Schema(
  {
    question: {
      type: String,
      required: true,
      trim: true,
    },
    options: {
      type: [String],
      required: true,
      validate: [
        (val: string[]) => Array.isArray(val) && val.length >= 2,
        'Each question must have at least 2 options.',
      ],
    },
    correctOptionIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    explanation: {
      type: String,
      trim: true,
      default: '',
    },
    points: {
      type: Number,
      default: 10,
      min: 1,
    },
  },
  { _id: false }
);

const QuizSchema = new Schema<IQuiz>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    banner: {
      type: String,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      default: 'General Sports',
    },
    league: {
      type: Schema.Types.ObjectId,
      ref: 'League',
      default: null,
    },
    rewardPoints: {
      type: Number,
      default: 50,
      min: 0,
    },
    passingPercentage: {
      type: Number,
      default: 70,
      min: 1,
      max: 100,
    },
    timeLimitSeconds: {
      type: Number,
      default: 120, // 2 minutes default
      min: 15,
    },
    questions: {
      type: [QuizQuestionSchema],
      required: true,
      validate: [
        (val: any[]) => Array.isArray(val) && val.length >= 1,
        'Quiz must contain at least 1 question.',
      ],
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ['draft', 'active', 'completed', 'archived'],
      default: 'draft',
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    totalAttempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPassed: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRewardsDistributed: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

QuizSchema.index({ status: 1, startDate: 1, endDate: 1 });
QuizSchema.index({ category: 1 });

const QuizAttemptSchema = new Schema<IQuizAttempt>(
  {
    quiz: {
      type: Schema.Types.ObjectId,
      ref: 'Quiz',
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    score: {
      type: Number,
      required: true,
      default: 0,
    },
    totalPossiblePoints: {
      type: Number,
      required: true,
      default: 0,
    },
    percentage: {
      type: Number,
      required: true,
      default: 0,
    },
    isPassed: {
      type: Boolean,
      required: true,
      default: false,
    },
    rewardEarned: {
      type: Number,
      default: 0,
    },
    answers: [
      {
        questionIndex: { type: Number, required: true },
        selectedOptionIndex: { type: Number, required: true },
        isCorrect: { type: Boolean, required: true },
        pointsEarned: { type: Number, default: 0 },
      },
    ],
    timeTakenSeconds: {
      type: Number,
      default: 0,
    },
    completedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

QuizAttemptSchema.index({ quiz: 1, user: 1 });
QuizAttemptSchema.index({ quiz: 1, score: -1, timeTakenSeconds: 1 });

export const Quiz = model<IQuiz>('Quiz', QuizSchema);
export const QuizAttempt = model<IQuizAttempt>('QuizAttempt', QuizAttemptSchema);
