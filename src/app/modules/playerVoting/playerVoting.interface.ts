import { Model, Types } from 'mongoose';

export type TVotingType = 'WEEK' | 'MONTH';

export type TVotingStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';

export interface INominee {
  _id?: Types.ObjectId;
  player: Types.ObjectId;
  team?: Types.ObjectId;
  statsHighlight?: string; // e.g. "5 Goals, 2 Assists in 3 matches"
  votesCount: number;
}

export interface IPlayerVoting {
  _id?: Types.ObjectId;
  title: string; // e.g. "Player of the Week - Week 42" or "Player of the Month - October 2026"
  votingType: TVotingType;
  league: Types.ObjectId;
  ageGroup: string; // e.g. "U14", "U16", "U18", "Open", etc.
  season?: string; // e.g. "2025/2026"
  weekNumber?: number; // 1-52
  month?: string; // e.g. "2026-10" or "October 2026"
  startDate: Date;
  endDate: Date;
  status: TVotingStatus;
  nominees: INominee[];
  totalVotes: number;
  winner?: Types.ObjectId; // User ref of the winning player
  winnerVotes?: number;
  banner?: string;
  description?: string;
  isFeatured?: boolean;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPlayerVote {
  _id?: Types.ObjectId;
  votingId: Types.ObjectId;
  userId: Types.ObjectId;
  playerId: Types.ObjectId;
  nomineeId?: Types.ObjectId;
  ipAddress?: string;
  createdAt?: Date;
}

export type PlayerVotingModel = Model<IPlayerVoting, Record<string, unknown>>;
export type PlayerVoteModel = Model<IPlayerVote, Record<string, unknown>>;
