import { Model, Types } from 'mongoose';

export type TRefereeVotingType = 'WEEK' | 'MONTH';

export type TRefereeVotingStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';

export interface IRefereeNominee {
  _id?: Types.ObjectId;
  referee: Types.ObjectId; // User ref (role: REFEREE)
  matchesOfficiatedCount?: number;
  fairPlayRating?: number;
  statsHighlight?: string; // e.g. "4 Matches Officiated, 0 Red Cards, 98% Decision Accuracy"
  votesCount: number;
}

export interface IRefereeVoting {
  _id?: Types.ObjectId;
  title: string; // e.g. "Referee of the Week - Week 42" or "Referee of the Month - October 2026"
  votingType: TRefereeVotingType;
  league?: Types.ObjectId; // Optional League ref
  season?: string; // e.g. "2025/2026"
  weekNumber?: number; // 1-53
  month?: string; // e.g. "2026-10" or "October 2026"
  startDate: Date;
  endDate: Date;
  status: TRefereeVotingStatus;
  nominees: IRefereeNominee[];
  totalVotes: number;
  winner?: Types.ObjectId; // User ref of winning referee
  winnerVotes?: number;
  banner?: string;
  description?: string;
  isFeatured?: boolean;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IRefereeVote {
  _id?: Types.ObjectId;
  votingId: Types.ObjectId;
  userId: Types.ObjectId;
  refereeId: Types.ObjectId;
  ipAddress?: string;
  createdAt?: Date;
}

export type RefereeVotingModel = Model<IRefereeVoting, Record<string, unknown>>;
export type RefereeVoteModel = Model<IRefereeVote, Record<string, unknown>>;
