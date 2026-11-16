import { Schema, model } from 'mongoose';
import {
  ILiveTransferMarket,
  LiveTransferMarketModel,
} from './liveTransferMarket.interface';

const liveTransferMarketSchema = new Schema<ILiveTransferMarket>(
  {
    player: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    currentTeam: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true,
    },
    currentManager: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    preferredPositions: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'PENDING_TRANSFER', 'TRANSFERRED', 'DELISTED'],
      default: 'ACTIVE',
      index: true,
    },
    listedAt: {
      type: Date,
      default: Date.now,
    },
    delistedAt: {
      type: Date,
      default: null,
    },
    transferredAt: {
      type: Date,
      default: null,
    },
    lastTransferId: {
      type: Schema.Types.ObjectId,
      ref: 'Transfer',
      default: null,
    },
  },
  { timestamps: true }
);

liveTransferMarketSchema.index({ player: 1, status: 1 });
liveTransferMarketSchema.index({ currentTeam: 1, status: 1 });

export const LiveTransferMarket = model<
  ILiveTransferMarket,
  LiveTransferMarketModel
>('LiveTransferMarket', liveTransferMarketSchema);
