import { Schema, model } from 'mongoose';
import { ITransfer } from './transfer.interface';

const partyApprovalSchema = new Schema(
  {
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    rejectReason: {
      type: String,
      default: null,
    },
    respondedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { _id: false }
);

const transferSchema = new Schema<ITransfer>(
  {
    player: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    fromTeam: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
      index: true,
    },

    toTeam: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      required: true,
      index: true,
    },

    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    transferType: {
      type: String,
      enum: ['FREE_AGENT', 'CLUB_TO_CLUB'],
      required: true,
    },

    status: {
      type: String,
      enum: [
        'PENDING',
        'MANAGER_APPROVED',
        'BOTH_APPROVED',
        'APPROVED',
        'REJECTED',
        'WITHDRAWN',
      ],
      default: 'PENDING',
      index: true,
    },

    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    rejectReason: {
      type: String,
      default: null,
    },

    // 🌟 Live Transfer Market Fields
    isLiveMarket: {
      type: Boolean,
      default: false,
      index: true,
    },

    liveMarketListing: {
      type: Schema.Types.ObjectId,
      ref: 'LiveTransferMarket',
      default: null,
    },

    playerApproval: {
      type: partyApprovalSchema,
      default: () => ({ status: 'PENDING', respondedAt: null, rejectReason: null, respondedBy: null }),
    },

    managerApproval: {
      type: partyApprovalSchema,
      default: () => ({ status: 'PENDING', respondedAt: null, rejectReason: null, respondedBy: null }),
    },

    note: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

transferSchema.index({ player: 1, toTeam: 1, status: 1 });
transferSchema.index({ isLiveMarket: 1, status: 1 });

export const Transfer = model<ITransfer>('Transfer', transferSchema);
