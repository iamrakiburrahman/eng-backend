import { Schema, model } from 'mongoose';
import {
  ISponsorship,
  SponsorshipModel,
} from './sponsorship.interface';

const sponsorshipSchema = new Schema<ISponsorship, SponsorshipModel>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      enum: ['sponsor', 'partner', 'brand_collaboration'],
      default: 'sponsor',
      required: true,
    },
    tier: {
      type: String,
      enum: [
        'title',
        'platinum',
        'gold',
        'silver',
        'bronze',
        'official',
        'community',
        'media',
        'other',
      ],
      default: 'official',
      required: true,
    },
    logo: {
      type: String,
      required: true,
    },
    banner: {
      type: String,
      default: '',
    },
    websiteUrl: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    placements: {
      type: [String],
      default: ['home', 'all'],
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    order: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    clickCount: {
      type: Number,
      default: 0,
    },
    impressionCount: {
      type: Number,
      default: 0,
    },
    contactEmail: {
      type: String,
      trim: true,
      default: '',
    },
    contactPhone: {
      type: String,
      trim: true,
      default: '',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Performance & Filtering Indexes
sponsorshipSchema.index({ status: 1, type: 1, tier: 1 });
sponsorshipSchema.index({ order: 1, createdAt: -1 });
sponsorshipSchema.index({ placements: 1, status: 1 });
sponsorshipSchema.index({ name: 'text', title: 'text', description: 'text' });

export const Sponsorship = model<ISponsorship, SponsorshipModel>(
  'Sponsorship',
  sponsorshipSchema
);
