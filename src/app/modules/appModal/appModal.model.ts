import { Schema, model } from 'mongoose';
import { IAppModal, AppModalModel } from './appModal.interface';

const appModalSchema = new Schema<IAppModal, AppModalModel>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      default: '',
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    image: {
      type: String,
      required: true,
      trim: true,
    },
    ctaText: {
      type: String,
      default: 'ENTER NOW',
      trim: true,
    },
    actionType: {
      type: String,
      enum: ['screen', 'external_url', 'dismiss_only'],
      default: 'screen',
    },
    targetScreen: {
      type: String,
      default: '',
      trim: true,
    },
    screenName: {
      type: String,
      default: '',
      trim: true,
    },
    screenConstant: {
      type: String,
      default: '',
      trim: true,
    },
    targetUrl: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
      index: true,
    },
    showFrequency: {
      type: String,
      enum: ['once', 'once_per_day', 'always'],
      default: 'once',
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null,
    },
    priority: {
      type: Number,
      default: 0,
      index: true,
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
  },
  {
    timestamps: true,
  }
);

appModalSchema.index({ status: 1, startDate: 1, endDate: 1, priority: -1 });

export const AppModal = model<IAppModal, AppModalModel>('AppModal', appModalSchema);

