import { Schema, model } from 'mongoose';
import {
  INominee,
  IPlayerVote,
  IPlayerVoting,
  PlayerVoteModel,
  PlayerVotingModel,
} from './playerVoting.interface';

const NomineeSchema = new Schema<INominee>(
  {
    player: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    team: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
    },
    statsHighlight: {
      type: String,
      trim: true,
    },
    votesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: true }
);

const PlayerVotingSchema = new Schema<IPlayerVoting, PlayerVotingModel>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    votingType: {
      type: String,
      enum: ['WEEK', 'MONTH'],
      required: true,
      default: 'WEEK',
    },
    league: {
      type: Schema.Types.ObjectId,
      ref: 'League',
      required: true,
      index: true,
    },
    ageGroup: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    season: {
      type: String,
      trim: true,
    },
    weekNumber: {
      type: Number,
      min: 1,
      max: 53,
    },
    month: {
      type: String,
      trim: true,
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'completed', 'cancelled'],
      default: 'upcoming',
      index: true,
    },
    nominees: {
      type: [NomineeSchema],
      validate: {
        validator: function (val: INominee[]) {
          return Array.isArray(val) && val.length >= 2;
        },
        message: 'A voting poll must have at least 2 pre-selected player nominees.',
      },
    },
    totalVotes: {
      type: Number,
      default: 0,
      min: 0,
    },
    winner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    winnerVotes: {
      type: Number,
      default: 0,
      min: 0,
    },
    banner: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for high-speed queries in Statistics and Mobile App
PlayerVotingSchema.index({ status: 1, votingType: 1, league: 1, ageGroup: 1 });
PlayerVotingSchema.index({ status: 1, startDate: 1, endDate: 1 });
PlayerVotingSchema.index({ createdAt: -1 });

// Vote Record Schema
const PlayerVoteSchema = new Schema<IPlayerVote, PlayerVoteModel>(
  {
    votingId: {
      type: Schema.Types.ObjectId,
      ref: 'PlayerVoting',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    playerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    nomineeId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    ipAddress: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Enforce 1 vote per user per voting round at database level!
PlayerVoteSchema.index({ votingId: 1, userId: 1 }, { unique: true });

export const PlayerVoting = model<IPlayerVoting, PlayerVotingModel>(
  'PlayerVoting',
  PlayerVotingSchema
);

export const PlayerVote = model<IPlayerVote, PlayerVoteModel>(
  'PlayerVote',
  PlayerVoteSchema
);
