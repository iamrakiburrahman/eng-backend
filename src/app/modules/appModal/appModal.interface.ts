import { Model, Types } from 'mongoose';

export type TAppModalActionType = 'screen' | 'external_url' | 'dismiss_only';
export type TAppModalStatus = 'active' | 'inactive' | 'archived';
export type TAppModalShowFrequency = 'once' | 'once_per_day' | 'always';

export interface IAppModal {
  _id?: Types.ObjectId;
  title: string;
  subtitle?: string;
  description?: string;
  image: string;
  ctaText?: string;
  actionType: TAppModalActionType; 

  // Internal App Navigation details (from AppRoutes provided by app dev)
  targetScreen?: string;
  screenName?: string;
  screenConstant?: string; 

  // External Redirect URL
  targetUrl?: string;

  // Display rules
  status: TAppModalStatus; 
  showFrequency: TAppModalShowFrequency;
  startDate?: Date;
  endDate?: Date | null;
  priority?: number; 

  // Analytics
  viewsCount?: number;
  clicksCount?: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export type AppModalModel = Model<IAppModal>;

