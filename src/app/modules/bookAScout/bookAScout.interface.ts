import { Model, Types } from 'mongoose';

export type TBookAScoutStatus = 'active' | 'inactive' | 'archived';

export interface IBookAScout {
  _id?: Types.ObjectId | string;
  sectionTitle: string;
  badgeText: string;
  title: string;
  description: string;
  buttonText: string;
  redirectUrl: string;
  image: string;
  status: TBookAScoutStatus;
  isFeatured: boolean;
  priority: number;
  startDate?: Date;
  endDate?: Date | null;
  viewsCount: number;
  clicksCount: number;
  createdBy?: Types.ObjectId | string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type BookAScoutModel = Model<IBookAScout, Record<string, unknown>>;

