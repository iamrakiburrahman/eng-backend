import { Schema, model } from 'mongoose';
import {
  IRefereeNominee,
  IRefereeVote,
  IRefereeVoting,
  RefereeVoteModel,
  RefereeVotingModel,
} from './refereeVoting.interface';

const RefereeNomineeSchema = new Schema<IRefereeNominee>(
  {
    referee: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    matchesOfficiatedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    fairPlayRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
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

const RefereeVotingSchema = new Schema<IRefereeVoting, RefereeVotingModel>(
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
      required: false,
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
      type: [RefereeNomineeSchema],
      validate: {
        validator: function (val: IRefereeNominee[]) {
          return Array.isArray(val) && val.length >= 2;
        },
        message: 'A referee voting poll must have at least 2 pre-selected referee nominees.',
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

// Compound indexes for high-speed queries
RefereeVotingSchema.index({ status: 1, votingType: 1 });
RefereeVotingSchema.index({ status: 1, startDate: 1, endDate: 1 });
RefereeVotingSchema.index({ createdAt: -1 });

// Referee Vote Record Schema
const RefereeVoteSchema = new Schema<IRefereeVote, RefereeVoteModel>(
  {
    votingId: {
      type: Schema.Types.ObjectId,
      ref: 'RefereeVoting',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refereeId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    ipAddress: {
      type: String,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Enforce 1 vote per user/profile per voting round at database level
RefereeVoteSchema.index({ votingId: 1, userId: 1 }, { unique: true });

export const RefereeVoting = model<IRefereeVoting, RefereeVotingModel>(
  'RefereeVoting',
  RefereeVotingSchema
);

export const RefereeVote = model<IRefereeVote, RefereeVoteModel>(
  'RefereeVote',
  RefereeVoteSchema
);
