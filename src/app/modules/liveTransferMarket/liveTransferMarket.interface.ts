import { Model, Types } from 'mongoose';

export type TLiveMarketListingStatus =
  | 'ACTIVE'
  | 'PENDING_TRANSFER'
  | 'TRANSFERRED'
  | 'DELISTED';

export interface ILiveTransferMarket {
  player: Types.ObjectId;
  currentTeam: Types.ObjectId;
  currentManager?: Types.ObjectId | null;
  preferredPositions?: string[];
  notes?: string | null;
  status: TLiveMarketListingStatus;
  listedAt: Date;
  delistedAt?: Date | null;
  transferredAt?: Date | null;
  lastTransferId?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type LiveTransferMarketModel = Model<ILiveTransferMarket>;
