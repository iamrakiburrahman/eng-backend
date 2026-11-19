import { model, Schema } from 'mongoose';
import { INews, NewsModel } from './news.interface';

const newsSchema = new Schema<INews, NewsModel>(
  {
    title: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },

    // ADD THIS FIELD
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    status: {
      type: String,
      enum: ['draft', 'publish', 'schedule'],
      default: 'draft',
    },
    publishDateTime: {
      type: Date,
      default: null,
    },
    order: {
      type: Number,
      default: 0,
    },
    isNotificationSent: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const News = model<INews, NewsModel>('News', newsSchema);