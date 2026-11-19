import { model, Schema } from 'mongoose';
import { IVideo, VideoModel } from './video.interface';

const videoSchema = new Schema<IVideo, VideoModel>(
  {
    title: {
      type: String,
      required: true,
    },
    category: {
      type: Schema.Types.ObjectId,
      ref: 'EngTvCategory',
      required: true,
    },
    subCategory: {
      type: Schema.Types.ObjectId,
      ref: 'EngTvCategory',
      default: null,
    },
    description: {
      type: String,
      required: true,
    },

    // VIDEO FILE
    videoUrl: {
      type: String,
      required: true,
    },
    hlsUrl: {
      type: String,
      default: '',
    },
    processingStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    thumbnail: {
      type: String,
      required: false,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    status: {
      type: String,
      enum: ['draft', 'publish', 'schedule'],
      default: 'publish',
    },

    publishDateTime: {
      type: Date,
      default: null,
    },
    isHighlight: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

videoSchema.index({ category: 1, status: 1 });
videoSchema.index({ subCategory: 1 });
videoSchema.index({ status: 1, publishDateTime: 1 });
videoSchema.index({ createdBy: 1 });
videoSchema.index({ isHighlight: -1, order: 1, createdAt: -1 });

export const Video = model<IVideo, VideoModel>('Video', videoSchema);