import { Types } from 'mongoose';

export interface IMatchResult {
  league?: Types.ObjectId;
  match: Types.ObjectId;

  team: Types.ObjectId;

  player?: Types.ObjectId;

  eventType:
    | 'goal'
    | 'assist'
    | 'yellow_card'
    | 'red_card'
    | 'foul'
    | 'substitution'
    | 'clean_sheet'
    | 'player_of_the_day';

  // NEW: event details meta
  eventMeta?: {
    goalType?: 'normal' | 'penalty' | 'header' | 'own_goal' | 'free_kick';
    cardType?: 'yellow' | 'red';
    substitutionType?: 'in' | 'out';
  };

  minute: number;

  addedBy: Types.ObjectId;
}