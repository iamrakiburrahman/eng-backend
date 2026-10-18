import { Schema, model } from 'mongoose';
import {
  IScorePredictionRound,
  IUserScorePrediction,
} from './scorePrediction.interface';

const UserPredictionItemSchema = new Schema(
  {
    match: {
      type: Schema.Types.ObjectId,
      ref: 'Match',
      required: true,
    },
    predictedHomeScore: {
      type: Number,
      required: true,
      min: 0,
    },
    predictedAwayScore: {
      type: Number,
      required: true,
      min: 0,
    },
    actualHomeScore: {
      type: Number,
      default: null,
    },
    actualAwayScore: {
      type: Number,
      default: null,
    },
    isExactMatch: {
      type: Boolean,
      default: false,
    },
    isOutcomeMatch: {
      type: Boolean,
      default: false,
    },
    coinsAwarded: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'exact', 'outcome', 'missed'],
      default: 'pending',
    },
  },
  { _id: false }
);

const ScorePredictionRoundSchema = new Schema<IScorePredictionRound>(
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
    league: {
      type: Schema.Types.ObjectId,
      ref: 'League',
      default: null,
    },
    matches: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Match',
        required: true,
      },
    ],
    lockTime: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'locked', 'settled', 'cancelled'],
      default: 'active',
      index: true,
    },
    coinsPerExactScore: {
      type: Number,
      default: 50,
      min: 0,
    },
    coinsPerCorrectOutcome: {
      type: Number,
      default: 10,
      min: 0,
    },
    jackpotBonusCoins: {
      type: Number,
      default: 500,
      min: 0,
    },
    totalParticipants: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPredictions: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalCoinsDistributed: {
      type: Number,
      default: 0,
      min: 0,
    },
    isSettled: {
      type: Boolean,
      default: false,
      index: true,
    },
    settledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

ScorePredictionRoundSchema.index({ status: 1, lockTime: 1 });

const UserScorePredictionSchema = new Schema<IUserScorePrediction>(
  {
    round: {
      type: Schema.Types.ObjectId,
      ref: 'ScorePredictionRound',
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    predictions: {
      type: [UserPredictionItemSchema],
      required: true,
    },
    totalExactMatches: {
      type: Number,
      default: 0,
    },
    totalOutcomeMatches: {
      type: Number,
      default: 0,
    },
    totalCoinsEarned: {
      type: Number,
      default: 0,
    },
    hasClaimedOrAwarded: {
      type: Boolean,
      default: false,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

UserScorePredictionSchema.index({ round: 1, user: 1 }, { unique: true });
UserScorePredictionSchema.index({ round: 1, totalExactMatches: -1, totalCoinsEarned: -1 });

export const ScorePredictionRound = model<IScorePredictionRound>(
  'ScorePredictionRound',
  ScorePredictionRoundSchema
);

export const UserScorePrediction = model<IUserScorePrediction>(
  'UserScorePrediction',
  UserScorePredictionSchema
);
