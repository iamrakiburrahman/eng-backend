import { Schema, model } from 'mongoose';
import {
  IPromotionalInquiry,
  IPromotionalZone,
  PromotionalInquiryModel,
  PromotionalZoneModel,
} from './promotionalZone.interface';

const SessionDetailsSchema = new Schema(
  {
    coachSpeciality: { type: String, trim: true },
    duration: { type: String, trim: true },
    schedule: { type: String, trim: true },
    fee: { type: Number, default: 0 },
    currency: { type: String, default: 'GBP' },
    maxSeats: { type: Number },
  },
  { _id: false }
);

const TeamDetailsSchema = new Schema(
  {
    leagueName: { type: String, trim: true },
    seekingPositions: [{ type: String, trim: true }],
    trialDate: { type: Date },
    clubAchievements: { type: String, trim: true },
  },
  { _id: false }
);

const ContactInfoSchema = new Schema(
  {
    phone: { type: String, required: true, trim: true },
    whatsapp: { type: String, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    registrationLink: { type: String, trim: true },
  },
  { _id: false }
);

const PromotionalZoneSchema = new Schema<IPromotionalZone, PromotionalZoneModel>(
  {
    title: {
      type: String,
      required: [true, 'Promotion title is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['COACH_SESSION', 'TEAM_SHOWCASE'],
      required: [true, 'Promotion type is required'],
    },
    creatorRole: {
      type: String,
      required: true,
      default: 'COACH',
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    teamId: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
    },
    banner: {
      type: String,
      required: [true, 'Promotion banner image is required'],
    },
    gallery: [{ type: String }],
    description: {
      type: String,
      required: [true, 'Promotion description is required'],
      trim: true,
    },
    ageGroups: [{ type: String, trim: true }],
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    venue: {
      type: String,
      required: [true, 'Venue / Location is required'],
      trim: true,
    },
    sessionDetails: {
      type: SessionDetailsSchema,
    },
    teamDetails: {
      type: TeamDetailsSchema,
    },
    contactInfo: {
      type: ContactInfoSchema,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired'],
      default: 'approved', // default approved for seamless experience or pending if admin approval required
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
      required: [true, 'End date is required'],
    },
    viewsCount: {
      type: Number,
      default: 0,
    },
    inquiriesCount: {
      type: Number,
      default: 0,
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
PromotionalZoneSchema.index({ type: 1, status: 1, isFeatured: -1, createdAt: -1 });
PromotionalZoneSchema.index({ city: 1, ageGroups: 1 });
PromotionalZoneSchema.index({ userId: 1 });
PromotionalZoneSchema.index({ teamId: 1 });

export const PromotionalZone = model<IPromotionalZone, PromotionalZoneModel>(
  'PromotionalZone',
  PromotionalZoneSchema
);

// Inquiry Schema
const PromotionalInquirySchema = new Schema<IPromotionalInquiry, PromotionalInquiryModel>(
  {
    promotionId: {
      type: Schema.Types.ObjectId,
      ref: 'PromotionalZone',
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    applicantName: {
      type: String,
      required: [true, 'Applicant name is required'],
      trim: true,
    },
    age: {
      type: Number,
    },
    playingPosition: {
      type: String,
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Contact phone is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'contacted', 'enrolled', 'rejected'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  }
);

export const PromotionalInquiry = model<IPromotionalInquiry, PromotionalInquiryModel>(
  'PromotionalInquiry',
  PromotionalInquirySchema
);
