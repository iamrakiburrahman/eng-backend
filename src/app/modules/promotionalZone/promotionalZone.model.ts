import { Schema, model } from 'mongoose';
import {
  IPromotionalZone,
  PromotionalZoneModel,
} from './promotionalZone.interface';

const PromotionalZoneSchema = new Schema<IPromotionalZone, PromotionalZoneModel>(
  {
    title: {
      type: String,
      required: [true, 'Ad / Campaign title is required'],
      trim: true,
    },
    websiteUrl: {
      type: String,
      required: [true, 'Website URL is required'],
      trim: true,
    },
    banner: {
      type: String,
      required: [true, 'Ad banner image is required'],
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired'],
      default: 'approved',
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    viewsCount: {
      type: Number,
      default: 0,
    },
    clicksCount: {
      type: Number,
      default: 0,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes for high performance filtering and search
PromotionalZoneSchema.index({ status: 1, isFeatured: -1, createdAt: -1 });
PromotionalZoneSchema.index({ endDate: 1 });
PromotionalZoneSchema.index({ userId: 1 });

export const PromotionalZone = model<IPromotionalZone, PromotionalZoneModel>(
  'PromotionalZone',
  PromotionalZoneSchema
);
