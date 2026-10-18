import { Types } from "mongoose";

export enum COIN_TRANSACTION_CATEGORY {
  GOAL = "GOAL",
  ASSIST = "ASSIST",
  CLEAN_SHEET = "CLEAN_SHEET",
  PLAYER_OF_THE_DAY = "PLAYER_OF_THE_DAY",
  MATCH_RATING = "MATCH_RATING",
  ATTEND_MATCH = "ATTEND_MATCH",
  PLAYING_MATCH = "PLAYING_MATCH",
  WIN_MATCH = "WIN_MATCH",
  DRAW_MATCH = "DRAW_MATCH",
  YELLOW_CARD_PENALTY = "YELLOW_CARD_PENALTY",
  RED_CARD_PENALTY = "RED_CARD_PENALTY",
  FOUL_PENALTY = "FOUL_PENALTY",
  SIN_BIN_PENALTY = "SIN_BIN_PENALTY",
  DISRESPECT_TO_REFEREE = "DISRESPECT_TO_REFEREE",
  GROSS_MISCONDUCT = "GROSS_MISCONDUCT",
  SUBSCRIPTION_BONUS = "SUBSCRIPTION_BONUS",
  PRODUCT_PURCHASE = "PRODUCT_PURCHASE",
  ADMIN_ADJUSTMENT = "ADMIN_ADJUSTMENT",
  ROLLBACK = "ROLLBACK",
  TOURNAMENT_PRIZE = "TOURNAMENT_PRIZE",
  COFFEE_REWARD = "COFFEE_REWARD",
  SCORE_PREDICTION_REWARD = "SCORE_PREDICTION_REWARD",
  QUIZ_REWARD = "QUIZ_REWARD",
}

export type ICoinTransactionType = "CREDIT" | "DEBIT";

export interface ICoinTransaction {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  type: ICoinTransactionType;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  category: COIN_TRANSACTION_CATEGORY;
  title: string;
  description?: string;
  match?: Types.ObjectId;
  referenceId?: string;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}
