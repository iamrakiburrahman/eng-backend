import { Document, Types } from 'mongoose';

export interface IQuizQuestion {
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
  points?: number;
}

export interface IQuiz extends Document {
  title: string;
  description?: string;
  banner?: string;
  category?: string; // e.g. "Football Trivia", "Rules & Fair Play", "Tournament Special", "General Sports"
  league?: Types.ObjectId;
  rewardPoints: number; // Coins/Points rewarded for passing
  passingPercentage: number; // e.g. 70 means 70% required to pass
  timeLimitSeconds: number; // Total seconds allowed for the quiz, e.g. 120 (2 mins)
  questions: IQuizQuestion[];
  startDate: Date;
  endDate: Date;
  status: 'draft' | 'active' | 'completed' | 'archived';
  isFeatured?: boolean;
  totalAttempts: number;
  totalPassed: number;
  totalRewardsDistributed: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IQuizAttemptAnswer {
  questionIndex: number;
  selectedOptionIndex: number;
  isCorrect: boolean;
  pointsEarned: number;
}

export interface IQuizAttempt extends Document {
  quiz: Types.ObjectId;
  user: Types.ObjectId;
  score: number; // Total points earned
  totalPossiblePoints: number;
  percentage: number;
  isPassed: boolean;
  rewardEarned: number; // Bonus reward points awarded
  answers: IQuizAttemptAnswer[];
  timeTakenSeconds: number;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
