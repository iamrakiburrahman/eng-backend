import { Types, ClientSession } from "mongoose";
import { Team } from "../app/modules/team/team.model";
import { ClubEconomy } from "../app/modules/coinAndBudget/clubEconomySchema.model";
import { TeamCoinTransaction } from "../app/modules/teamCoinTransaction/teamCoinTransaction.model";
import {
  TEAM_COIN_CATEGORY,
  ITeamCoinTransaction,
} from "../app/modules/teamCoinTransaction/teamCoinTransaction.interface";

export interface IRecordTeamCoinTransactionParams {
  teamId: string | Types.ObjectId;
  amount: number; // positive = credit, negative = debit
  category: TEAM_COIN_CATEGORY;
  title: string;
  description?: string;
  minBalanceAfter?: number; // Minimum balance required to remain after deduction
  matchId?: string | Types.ObjectId;
  opponentTeamId?: string | Types.ObjectId;
  transferredPlayerId?: string | Types.ObjectId;
  transferId?: string | Types.ObjectId;
  referenceId?: string;
  createdBy?: string | Types.ObjectId;
  session?: ClientSession;
  syncMarketValue?: boolean;
}

const DEDUCTION_CATEGORIES = new Set<TEAM_COIN_CATEGORY>([
  TEAM_COIN_CATEGORY.PLAYER_TRANSFER_BUY,
]);

const REWARD_CATEGORIES = new Set<TEAM_COIN_CATEGORY>([
  TEAM_COIN_CATEGORY.ATTEND_MATCH,
  TEAM_COIN_CATEGORY.WIN_MATCH,
  TEAM_COIN_CATEGORY.DRAW_MATCH,
  TEAM_COIN_CATEGORY.PLAYER_TRANSFER_SELL,
  TEAM_COIN_CATEGORY.TOURNAMENT_PRIZE,
]);

export const recordTeamCoinTransaction = async (
  params: IRecordTeamCoinTransactionParams
): Promise<{ team: any; transaction: ITeamCoinTransaction | null }> => {
  const {
    teamId,
    amount,
    category,
    title,
    description = "",
    minBalanceAfter = 0,
    matchId,
    opponentTeamId,
    transferredPlayerId,
    transferId,
    referenceId,
    createdBy,
    session,
    syncMarketValue = true,
  } = params;

  if (!teamId || isNaN(Number(amount)) || Number(amount) === 0) {
    const team = await Team.findById(teamId).session(session || null);
    return { team, transaction: null };
  }

  let signedAmount = Number(amount);
  if (DEDUCTION_CATEGORIES.has(category)) {
    signedAmount = -Math.abs(signedAmount);
  } else if (REWARD_CATEGORIES.has(category)) {
    signedAmount = Math.abs(signedAmount);
  }

  let team: any;
  let balanceBefore: number;
  let balanceAfter: number;

  if (signedAmount < 0) {
    // Concurrency-safe atomic deduction: check and deduct in one atomic operation
    const minRequired = (minBalanceAfter || 0) + Math.abs(signedAmount);

    team = await Team.findOneAndUpdate(
      {
        _id: teamId,
        coin: { $gte: minRequired },
      },
      {
        $inc: { coin: signedAmount },
      },
      { new: true, session: session || undefined }
    );

    if (!team) {
      const currentTeam = await Team.findById(teamId).session(session || null);
      const currentCoin = currentTeam?.coin || 0;
      throw new Error(
        `Insufficient team coin balance! Current balance: ${currentCoin}, required after deduction: ${minBalanceAfter}`
      );
    }

    balanceAfter = Number(team.coin) || 0;
    balanceBefore = balanceAfter - signedAmount;
  } else {
    // Concurrency-safe atomic credit
    team = await Team.findOneAndUpdate(
      { _id: teamId },
      { $inc: { coin: signedAmount } },
      { new: true, session: session || undefined }
    );

    if (!team) {
      throw new Error(`Team not found for ID: ${teamId}`);
    }

    balanceAfter = Number(team.coin) || 0;
    balanceBefore = Math.max(0, balanceAfter - signedAmount);
  }

  if (syncMarketValue) {
    const ce = await ClubEconomy.findOne().session(session || null);
    const rate = Number(ce?.conversionRate) || 10;
    team.marketValue = balanceAfter * rate;
    await Team.findByIdAndUpdate(
      teamId,
      { marketValue: team.marketValue },
      { session: session || undefined }
    );
  }

  const transactionData: Partial<ITeamCoinTransaction> = {
    team: team._id,
    type: signedAmount >= 0 ? "CREDIT" : "DEBIT",
    amount: Math.abs(signedAmount),
    balanceBefore,
    balanceAfter,
    category,
    title,
    description,
    match: matchId ? new Types.ObjectId(matchId.toString()) : undefined,
    opponentTeam: opponentTeamId
      ? new Types.ObjectId(opponentTeamId.toString())
      : undefined,
    transferredPlayer: transferredPlayerId
      ? new Types.ObjectId(transferredPlayerId.toString())
      : undefined,
    transfer: transferId
      ? new Types.ObjectId(transferId.toString())
      : undefined,
    referenceId: referenceId ? referenceId.toString() : undefined,
    createdBy: createdBy ? new Types.ObjectId(createdBy.toString()) : undefined,
  };

  const [transaction] = await TeamCoinTransaction.create([transactionData], {
    session: session || undefined,
  });

  return { team, transaction };
};
