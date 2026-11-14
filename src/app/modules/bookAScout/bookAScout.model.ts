import { Schema, model } from 'mongoose';
import { BookAScoutModel, IBookAScout } from './bookAScout.interface';

const bookAScoutSchema = new Schema<IBookAScout, BookAScoutModel>(
  {
    sectionTitle: {
      type: String,
      trim: true,
      default: 'Book A Scout',
    },
    badgeText: {
      type: String,
      trim: true,
      default: 'Professional scouting',
    },
    title: {
      type: String,
      required: [true, 'Card title is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    buttonText: {
      type: String,
      trim: true,
      default: 'Book Now',
    },
    redirectUrl: {
      type: String,
      required: [true, 'Redirect URL is required'],
      trim: true,
    },
    image: {
      type: String,
      required: [true, 'Section image is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    priority: {
      type: Number,
      default: 0,
      index: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null,
    },
    viewsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    clicksCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

bookAScoutSchema.index({ status: 1, isFeatured: -1, priority: -1, createdAt: -1 });
bookAScoutSchema.index({ startDate: 1, endDate: 1 });

export const BookAScout = model<IBookAScout, BookAScoutModel>(
  'BookAScout',
  bookAScoutSchema
);

