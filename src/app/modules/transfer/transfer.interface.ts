import { Types } from 'mongoose';

export type TPartyApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IPartyApproval {
  status: TPartyApprovalStatus;
  respondedAt?: Date | null;
  rejectReason?: string | null;
  respondedBy?: Types.ObjectId | null;
}

export interface ITransfer {
  player: Types.ObjectId;

  fromTeam?: Types.ObjectId | null;

  toTeam: Types.ObjectId;

  requestedBy: Types.ObjectId;

  transferType: 'FREE_AGENT' | 'CLUB_TO_CLUB';

  status: 'PENDING' | 'MANAGER_APPROVED' | 'BOTH_APPROVED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

  approvedBy?: Types.ObjectId | null;

  rejectReason?: string | null;

  // Live Transfer Market Fields
  isLiveMarket?: boolean;
  liveMarketListing?: Types.ObjectId | null;
  playerApproval?: IPartyApproval;
  managerApproval?: IPartyApproval;
  note?: string | null;

  createdAt?: Date;
  updatedAt?: Date;
}
