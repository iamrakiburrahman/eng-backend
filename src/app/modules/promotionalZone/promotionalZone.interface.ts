import { Model, Types } from 'mongoose';

export type TPromotionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface IPromotionalZone {
  _id?: Types.ObjectId;
  title: string;
  websiteUrl: string;
  banner: string;
  description?: string;
  status: TPromotionStatus;
  isFeatured: boolean;
  startDate: Date;
  endDate: Date;
  viewsCount: number;
  clicksCount: number;
  userId?: Types.ObjectId;
  rejectionReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PromotionalZoneModel = Model<IPromotionalZone>;
