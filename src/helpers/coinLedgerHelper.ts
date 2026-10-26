import { Types, ClientSession } from "mongoose";
import { User } from "../app/modules/user/user.model";
import { PlayerEconomy } from "../app/modules/coinAndBudget/playerEconomySchema.model";
import { CoinTransaction } from "../app/modules/coinTransaction/coinTransaction.model";
import {
  COIN_TRANSACTION_CATEGORY,
  ICoinTransaction,
} from "../app/modules/coinTransaction/coinTransaction.interface";

export interface IRecordCoinTransactionParams {
  userId: string | Types.ObjectId;
  amount: number; // positive = credit, negative = debit
  category: COIN_TRANSACTION_CATEGORY;
  title: string;
  description?: string;
  matchId?: string | Types.ObjectId;
  referenceId?: string;
  createdBy?: string | Types.ObjectId;
  session?: ClientSession;
  syncMarketValue?: boolean;
}

const PENALTY_CATEGORIES = new Set<COIN_TRANSACTION_CATEGORY>([
  COIN_TRANSACTION_CATEGORY.YELLOW_CARD_PENALTY,
  COIN_TRANSACTION_CATEGORY.RED_CARD_PENALTY,
  COIN_TRANSACTION_CATEGORY.FOUL_PENALTY,
  COIN_TRANSACTION_CATEGORY.SIN_BIN_PENALTY,
  COIN_TRANSACTION_CATEGORY.DISRESPECT_TO_REFEREE,
  COIN_TRANSACTION_CATEGORY.GROSS_MISCONDUCT,
  COIN_TRANSACTION_CATEGORY.PRODUCT_PURCHASE,
]);

const REWARD_CATEGORIES = new Set<COIN_TRANSACTION_CATEGORY>([
  COIN_TRANSACTION_CATEGORY.GOAL,
  COIN_TRANSACTION_CATEGORY.ASSIST,
  COIN_TRANSACTION_CATEGORY.CLEAN_SHEET,
  COIN_TRANSACTION_CATEGORY.PLAYER_OF_THE_DAY,
  COIN_TRANSACTION_CATEGORY.MATCH_RATING,
  COIN_TRANSACTION_CATEGORY.ATTEND_MATCH,
  COIN_TRANSACTION_CATEGORY.PLAYING_MATCH,
  COIN_TRANSACTION_CATEGORY.WIN_MATCH,
  COIN_TRANSACTION_CATEGORY.DRAW_MATCH,
  COIN_TRANSACTION_CATEGORY.SUBSCRIPTION_BONUS,
  COIN_TRANSACTION_CATEGORY.TOURNAMENT_PRIZE,
  COIN_TRANSACTION_CATEGORY.COFFEE_REWARD,
  COIN_TRANSACTION_CATEGORY.SCORE_PREDICTION_REWARD,
  COIN_TRANSACTION_CATEGORY.QUIZ_REWARD,
]);

export const recordCoinTransaction = async (
  params: IRecordCoinTransactionParams
): Promise<{ user: any; transaction: ICoinTransaction | null }> => {
  const {
    userId,
    amount,
    category,
    title,
    description = "",
    matchId,
    referenceId,
    createdBy,
    session,
    syncMarketValue = true,
  } = params;

  if (!userId || isNaN(Number(amount)) || Number(amount) === 0) {
    const user = await User.findById(userId).session(session || null);
    return { user, transaction: null };
  }

  const user = await User.findById(userId).session(session || null);
  if (!user) {
    throw new Error(`User not found for ID: ${userId}`);
  }

  let signedAmount = Number(amount);
  if (PENALTY_CATEGORIES.has(category)) {
    // Penalties must strictly be deductions (negative amount)
    signedAmount = -Math.abs(signedAmount);
  } else if (REWARD_CATEGORIES.has(category)) {
    // Rewards are credits if positive, but allow negative for adjustments/reversals
    if (signedAmount > 0) {
      signedAmount = Math.abs(signedAmount);
    }
  }

  const balanceBefore = Number(user.engCoine) || 0;
  const balanceAfter = Math.max(0, balanceBefore + signedAmount);

  user.engCoine = balanceAfter;

  if (syncMarketValue) {
    const pe = await PlayerEconomy.findOne().session(session || null);
    const rate = Number(pe?.conversionRate) || 10;
    const floorMV = Number(pe?.startingMarketValue) || 100000;
    user.marketValue = Math.max(floorMV, balanceAfter * rate);
  }

  await user.save({ session: session || undefined });

  const transactionData: Partial<ICoinTransaction> = {
    user: user._id,
    type: signedAmount >= 0 ? "CREDIT" : "DEBIT",
    amount: Math.abs(signedAmount),
    balanceBefore,
    balanceAfter,
    category,
    title,
    description,
    match: matchId ? new Types.ObjectId(matchId.toString()) : undefined,
    referenceId: referenceId ? referenceId.toString() : undefined,
    createdBy: createdBy ? new Types.ObjectId(createdBy.toString()) : undefined,
  };

  const [transaction] = await CoinTransaction.create([transactionData], {
    session: session || undefined,
  });

  return { user, transaction };
};

