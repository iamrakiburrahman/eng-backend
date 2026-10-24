import { Model, Types } from 'mongoose';

export type TPromotionType = 'COACH_SESSION' | 'TEAM_SHOWCASE';
export type TPromotionStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ISessionDetails {
  coachSpeciality?: string;
  duration?: string;
  schedule?: string;
  fee?: number;
  currency?: string;
  maxSeats?: number;
}

export interface ITeamDetails {
  leagueName?: string;
  seekingPositions?: string[];
  trialDate?: Date;
  clubAchievements?: string;
}

export interface IContactInfo {
  phone: string;
  whatsapp?: string;
  email: string;
  registrationLink?: string;
}

export interface IPromotionalZone {
  _id?: Types.ObjectId;
  title: string;
  type: TPromotionType;
  creatorRole: string;
  userId: Types.ObjectId;
  teamId?: Types.ObjectId;
  banner: string;
  gallery?: string[];
  description: string;
  ageGroups: string[];
  city: string;
  venue: string;
  sessionDetails?: ISessionDetails;
  teamDetails?: ITeamDetails;
  contactInfo: IContactInfo;
  status: TPromotionStatus;
  isFeatured: boolean;
  startDate: Date;
  endDate: Date;
  viewsCount: number;
  inquiriesCount: number;
  rejectionReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PromotionalZoneModel = Model<IPromotionalZone>;

export type TInquiryStatus = 'pending' | 'contacted' | 'enrolled' | 'rejected';

export interface IPromotionalInquiry {
  _id?: Types.ObjectId;
  promotionId: Types.ObjectId;
  userId?: Types.ObjectId;
  applicantName: string;
  age?: number;
  playingPosition?: string;
  phone: string;
  email?: string;
  notes?: string;
  status: TInquiryStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PromotionalInquiryModel = Model<IPromotionalInquiry>;
