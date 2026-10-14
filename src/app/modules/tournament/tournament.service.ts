import { Types } from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import QueryBuilder from "../../../util/queryBuilder";
import { ITournament } from "./tournament.interface";
import { Tournament } from "./tournament.model";
import { User } from "../user/user.model";
import { Subscription } from "../subscription/subscription.model";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";
import { recordCoinTransaction } from "../../../helpers/coinLedgerHelper";
import { COIN_TRANSACTION_CATEGORY } from "../coinTransaction/coinTransaction.interface";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

const getUKNow = (): Date => {
  return dayjs().tz("Europe/London").toDate();
};

const calculateTournamentStatus = (
  start: Date,
  end: Date,
  now: Date = getUKNow(),
): "upcoming" | "active" | "completed" => {
  if (now < start) {
    return "upcoming";
  }
  if (now >= start && now <= end) {
    return "active";
  }
  return "completed";
};

const syncTournamentStatusesInDB = async (): Promise<{
  activated: number;
  completed: number;
  upcoming: number;
}> => {
  const now = getUKNow();

  const [completedResult, activeResult, upcomingResult] = await Promise.all([
    // 1. Tournaments whose endDate has passed -> completed
    Tournament.updateMany(
      {
        status: { $nin: ["completed", "cancelled"] },
        endDate: { $lte: now },
      },
      {
        $set: { status: "completed" },
      },
    ),

    // 2. Tournaments whose startDate has arrived and endDate has not passed -> active
    Tournament.updateMany(
      {
        status: { $nin: ["active", "cancelled"] },
        startDate: { $lte: now },
        endDate: { $gt: now },
      },
      {
        $set: { status: "active" },
      },
    ),

    // 3. Tournaments whose startDate is still in the future -> upcoming
    Tournament.updateMany(
      {
        status: { $nin: ["upcoming", "cancelled"] },
        startDate: { $gt: now },
      },
      {
        $set: { status: "upcoming" },
      },
    ),
  ]);

  return {
    completed: completedResult.modifiedCount || 0,
    activated: activeResult.modifiedCount || 0,
    upcoming: upcomingResult.modifiedCount || 0,
  };
};

const createTournamentToDB = async (
  payload: Partial<ITournament>,
  userId?: string,
): Promise<ITournament> => {
  if (
    !payload.title ||
    !payload.description ||
    !payload.startDate ||
    !payload.endDate
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Title, description, startDate, and endDate are required",
    );
  }

  const start = new Date(payload.startDate);
  const end = new Date(payload.endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid startDate or endDate");
  }

  if (start >= end) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "startDate must be before endDate",
    );
  }

  // Auto calculate status if client didn't explicitly specify 'cancelled', or if status wasn't supplied
  let determinedStatus = payload.status;
  if (!determinedStatus || determinedStatus !== "cancelled") {
    determinedStatus = calculateTournamentStatus(start, end);
  }

  const result = await Tournament.create({
    ...payload,
    status: determinedStatus,
    startDate: start,
    endDate: end,
    createdBy: userId,
  });

  return result;
};

const getAllTournamentsFromDB = async (query: Record<string, any>) => {
  await syncTournamentStatusesInDB();

  const tournamentQuery = new QueryBuilder(Tournament.find(), query)
    .search(["title", "description"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await tournamentQuery.modelQuery;
  const meta = await tournamentQuery.getPaginationInfo();

  return {
    meta,
    result,
  };
};

const getSingleTournamentFromDB = async (
  id: string,
): Promise<ITournament | null> => {
  await syncTournamentStatusesInDB();
  const result = await Tournament.findById(id).populate({
    path: "redeemedPlayers.player",
    select:
      "userName firstName lastName fullName email emergencyEmail phone emergencyPhone profile jerseyNumber role selectTeam parentId",
    populate: {
      path: "parentId",
      select: "email emergencyEmail phone emergencyPhone",
    },
  });
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Tournament not found");
  }
  return result;
};

const updateTournamentInDB = async (
  id: string,
  payload: Partial<ITournament>,
): Promise<ITournament | null> => {
  const isExist = await Tournament.findById(id);
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Tournament not found");
  }

  if (payload.startDate && payload.endDate) {
    const start = new Date(payload.startDate);
    const end = new Date(payload.endDate);
    if (start >= end) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "startDate must be before endDate",
      );
    }
  }

  const updatePayload: Partial<ITournament> = { ...payload };

  // If client explicitly passed status (e.g. 'cancelled', 'completed', 'active'), keep it
  // If client did NOT explicitly pass status and existing status is not 'cancelled', auto-determine status based on dates
  if (!payload.status && isExist.status !== "cancelled") {
    const start = payload.startDate ? new Date(payload.startDate) : new Date(isExist.startDate);
    const end = payload.endDate ? new Date(payload.endDate) : new Date(isExist.endDate);
    updatePayload.status = calculateTournamentStatus(start, end);
  }

  const result = await Tournament.findByIdAndUpdate(id, updatePayload, {
    new: true,
    runValidators: true,
  });

  return result;
};

const deleteTournamentFromDB = async (
  id: string,
): Promise<ITournament | null> => {
  const isExist = await Tournament.findById(id);
  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Tournament not found");
  }

  const result = await Tournament.findByIdAndDelete(id);
  return result;
};

const getTournamentQrCodeFromDB = async (tournamentId: string) => {
  const tournament = await Tournament.findById(tournamentId).populate({
    path: "redeemedPlayers.player",
    select:
      "userName firstName lastName fullName email emergencyEmail phone emergencyPhone profile jerseyNumber role selectTeam parentId",
    populate: {
      path: "parentId",
      select: "email emergencyEmail phone emergencyPhone",
    },
  });
  if (!tournament) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Tournament not found");
  }

  let isModified = false;
  if (!tournament.rewardToken) {
    tournament.rewardToken =
      Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    isModified = true;
  }

  if (tournament.positionRewards && tournament.positionRewards.length > 0) {
    tournament.positionRewards.forEach((reward: any) => {
      if (!reward.rewardToken) {
        reward.rewardToken =
          Math.random().toString(36).substring(2, 10) +
          Date.now().toString(36) +
          "_" +
          reward.position;
        isModified = true;
      }
    });
  }

  if (isModified) {
    await tournament.save();
  }

  const positionQrCodes = (tournament.positionRewards || []).map(
    (reward: any) => {
      const qrPayload = {
        type: "TOURNAMENT_REWARD",
        tournamentId: tournament._id?.toString(),
        position: reward.position,
        positionName: reward.positionName,
        points: reward.points,
        rewardToken: reward.rewardToken || tournament.rewardToken,
        title: tournament.title,
      };

      return {
        position: reward.position,
        positionName: reward.positionName,
        points: reward.points,
        rewardToken: reward.rewardToken || tournament.rewardToken,
        qrPayloadString: JSON.stringify(qrPayload),
        qrPayload,
      };
    },
  );

  return {
    tournamentId: tournament._id,
    title: tournament.title,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    mainRewardToken: tournament.rewardToken,
    positionQrCodes,
    redeemedCount: tournament.redeemedPlayers?.length || 0,
    redeemedPlayers: tournament.redeemedPlayers || [],
  };
};

const redeemTournamentRewardInDB = async (
  userId: string,
  payload: {
    tournamentId?: string;
    rewardToken?: string;
    position?: number;
    qrData?: string;
    playerId?: string;
  },
) => {
  let tournamentId = payload.tournamentId;
  let rewardToken = payload.rewardToken;
  let targetPosition = payload.position;
  let targetPlayerId = payload.playerId;

  if (payload.qrData) {
    try {
      const parsed =
        typeof payload.qrData === "string"
          ? JSON.parse(payload.qrData)
          : payload.qrData;
      if (parsed.tournamentId) tournamentId = parsed.tournamentId;
      if (parsed.rewardToken) rewardToken = parsed.rewardToken;
      if (parsed.position !== undefined)
        targetPosition = Number(parsed.position);
      if (parsed.playerId) targetPlayerId = parsed.playerId;
    } catch {
      // ignore
    }
  }

  // Target player defaults to authenticated user if playerId is not explicitly provided
  const finalPlayerId = targetPlayerId || userId;
  if (!finalPlayerId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Player ID or User ID is required for reward redemption",
    );
  }

  if (!tournamentId || !rewardToken) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Tournament ID and QR reward token are required",
    );
  }

  const tournament = await Tournament.findById(tournamentId);
  if (!tournament) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Tournament not found");
  }

  const now = new Date();
  const startDate = new Date(tournament.startDate);
  const endDate = new Date(tournament.endDate);

  if (now < startDate) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Tournament has not started yet. Reward redemption is not active.",
    );
  }

  if (now > endDate) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Tournament reward redemption period has expired!",
    );
  }

  let matchedPosition = (tournament.positionRewards || []).find(
    (pr: any) =>
      pr.rewardToken === rewardToken ||
      (targetPosition !== undefined && pr.position === targetPosition),
  );

  if (!matchedPosition && tournament.rewardToken === rewardToken) {
    if (targetPosition !== undefined) {
      matchedPosition = (tournament.positionRewards || []).find(
        (pr: any) => pr.position === targetPosition,
      );
    }
    if (!matchedPosition && tournament.positionRewards?.length > 0) {
      matchedPosition = tournament.positionRewards[0];
    }
  }

  if (!matchedPosition) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid or expired QR code for this tournament position",
    );
  }

  const playerObjectId = new Types.ObjectId(finalPlayerId);

  const hasAlreadyRedeemed = tournament.redeemedPlayers?.some(
    (rp: any) => rp.player.toString() === finalPlayerId.toString(),
  );

  if (hasAlreadyRedeemed) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This player has already redeemed a prize for this tournament!",
    );
  }

  const prizeCoins = Number(matchedPosition.points) || 0;
  if (prizeCoins <= 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No prize points set for this position",
    );
  }

  const user = await User.findById(finalPlayerId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
  }

  // 🟢 1. Player Status must be APPROVED
  if (user.status !== "APPROVED") {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only approved players can redeem tournament prize rewards!",
    );
  }

  // 💳 2. Player must have an active subscription package
  const activeSubscription = await Subscription.findOne({
    user: user._id,
    status: "active",
  });

  if (!activeSubscription) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Player must have an active subscription package to redeem tournament prize rewards!",
    );
  }

  const { user: updatedUser } = await recordCoinTransaction({
    userId: playerObjectId,
    amount: prizeCoins,
    category: COIN_TRANSACTION_CATEGORY.TOURNAMENT_PRIZE,
    title: "Tournament Prize Reward",
    description: `Claimed prize for ${matchedPosition.positionName || `Position ${matchedPosition.position}`} in tournament "${tournament.title || "Tournament"}"`,
    referenceId: tournament._id.toString(),
  });

  if (updatedUser) {
    user.engCoine = updatedUser.engCoine;
    user.marketValue = updatedUser.marketValue;
  }

  if (!tournament.redeemedPlayers) {
    tournament.redeemedPlayers = [];
  }

  tournament.redeemedPlayers.push({
    player: playerObjectId,
    position: matchedPosition.position,
    positionName: matchedPosition.positionName,
    redeemedAt: new Date(),
    coins: prizeCoins,
  });

  await tournament.save();

  const getValidEmail = (val?: string | null) =>
    val && typeof val === "string" && val.includes("@") ? val : "";

  let userEmail =
    getValidEmail(user.email) ||
    getValidEmail(user.emergencyEmail);

  if (!userEmail && user.parentId) {
    const parentUser = await User.findById(user.parentId).select("email emergencyEmail");
    if (parentUser) {
      userEmail =
        getValidEmail(parentUser.email) ||
        getValidEmail(parentUser.emergencyEmail);
    }
  }

  const computedName =
    (user as any).fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.userName ||
    "Player";

  return {
    tournamentId: tournament._id,
    tournamentTitle: tournament.title,
    playerId: user._id,
    playerName: computedName,
    email: userEmail,
    position: matchedPosition.position,
    positionName: matchedPosition.positionName,
    redeemedCoins: prizeCoins,
    totalCoins: user.engCoine,
    marketValue: user.marketValue,
    redeemedAt: new Date(),
  };
};

const getTournamentAnalyticsFromDB = async () => {
  await syncTournamentStatusesInDB();
  const [total, active, upcoming, completed] = await Promise.all([
    Tournament.countDocuments(),
    Tournament.countDocuments({ status: { $in: ['active', 'ongoing'] } }),
    Tournament.countDocuments({ status: 'upcoming' }),
    Tournament.countDocuments({ status: { $in: ['completed', 'finished'] } }),
  ]);

  return {
    total,
    active,
    upcoming,
    completed,
  };
};

export const TournamentService = {
  createTournamentToDB,
  getAllTournamentsFromDB,
  getSingleTournamentFromDB,
  updateTournamentInDB,
  deleteTournamentFromDB,
  getTournamentQrCodeFromDB,
  redeemTournamentRewardInDB,
  getTournamentAnalyticsFromDB,
  syncTournamentStatusesInDB,
};
