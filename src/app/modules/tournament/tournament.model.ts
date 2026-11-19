import crypto from 'crypto';
import { Schema, model } from 'mongoose';
import { ITournament, TournamentModel } from './tournament.interface';

const positionRewardSchema = new Schema(
  {
    position: {
      type: Number,
      required: true,
    },
    positionName: {
      type: String,
      required: true,
      trim: true,
    },
    points: {
      type: Number,
      required: true,
      min: 0,
    },
    rewardToken: {
      type: String,
      default: '',
    },
  },
  { _id: false }
);

const tournamentSchema = new Schema<ITournament, TournamentModel>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    banner: {
      type: String,
      default: '',
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    positionRewards: {
      type: [positionRewardSchema],
      default: [],
    },
    rewardToken: {
      type: String,
      default: '',
    },
    redeemedPlayers: {
      type: [
        {
          player: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          position: { type: Number, required: true },
          positionName: { type: String, default: 'Winner' },
          redeemedAt: { type: Date, default: Date.now },
          coins: { type: Number, required: true },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['upcoming', 'active', 'completed', 'cancelled'],
      default: 'active',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
  }
);

tournamentSchema.pre('save', function () {
  if (!this.rewardToken) {
    this.rewardToken = crypto.randomBytes(16).toString('hex');
  }
  if (this.positionRewards && this.positionRewards.length > 0) {
    this.positionRewards.forEach((r: any) => {
      if (!r.rewardToken) {
        r.rewardToken = crypto.randomBytes(12).toString('hex') + '_' + r.position;
      }
    });
  }
});

tournamentSchema.index({ status: 1 });
tournamentSchema.index({ startDate: 1, endDate: 1 });

export const Tournament = model<ITournament, TournamentModel>(
  'Tournament',
  tournamentSchema
);
