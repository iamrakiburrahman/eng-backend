import { Document, Types } from 'mongoose';

export interface IUserPredictionItem {
  match: Types.ObjectId;
  predictedHomeScore: number;
  predictedAwayScore: number;
  actualHomeScore?: number;
  actualAwayScore?: number;
  isExactMatch?: boolean;
  isOutcomeMatch?: boolean;
  coinsAwarded?: number;
  status?: 'pending' | 'exact' | 'outcome' | 'missed';
}

export interface IScorePredictionRound extends Document {
  title: string;
  description?: string;
  banner?: string;
  league?: Types.ObjectId;
  matches: Types.ObjectId[]; // The 5 selected fixtures
  lockTime: Date; // Deadline before which users must submit
  status: 'upcoming' | 'active' | 'locked' | 'settled' | 'cancelled';
  coinsPerExactScore: number; // e.g. 50 coins
  coinsPerCorrectOutcome: number; // e.g. 10 coins
  jackpotBonusCoins: number; // e.g. 500 coins for 5/5 exact
  totalParticipants: number;
  totalPredictions: number;
  totalCoinsDistributed: number;
  isSettled: boolean;
  settledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserScorePrediction extends Document {
  round: Types.ObjectId;
  user: Types.ObjectId;
  predictions: IUserPredictionItem[];
  totalExactMatches: number;
  totalOutcomeMatches: number;
  totalCoinsEarned: number;
  hasClaimedOrAwarded: boolean;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}
