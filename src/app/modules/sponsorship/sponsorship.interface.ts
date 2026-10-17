import { Model, Types } from 'mongoose';

export type TSponsorshipType = 'sponsor' | 'partner' | 'brand_collaboration';

export type TSponsorshipTier =
  | 'title'
  | 'platinum'
  | 'gold'
  | 'silver'
  | 'bronze'
  | 'official'
  | 'community'
  | 'media'
  | 'other';

export type TSponsorshipPlacement =
  | 'home'
  | 'tournament'
  | 'match'
  | 'team'
  | 'footer'
  | 'sidebar'
  | 'popup'
  | 'all';

export type ISponsorship = {
  _id?: Types.ObjectId;
  name: string;
  title?: string;
  type: TSponsorshipType; 
  tier: TSponsorshipTier;
  logo: string; 
  banner?: string; 
  websiteUrl?: string; 
  description?: string; 
  placements: TSponsorshipPlacement[]; 
  startDate?: Date; 
  endDate?: Date; 
  order: number; 
  status: 'active' | 'inactive'; 
  clickCount: number; 
  impressionCount: number; 
  contactEmail?: string; 
  contactPhone?: string; 
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export type SponsorshipModel = Model<ISponsorship, Record<string, unknown>>;
