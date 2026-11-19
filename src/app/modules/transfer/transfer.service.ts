import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { Transfer } from "./transfer.model";
import { User } from "../user/user.model";
import { Team } from "../team/team.model";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { USER_ROLES } from "../../../enums/user";
import mongoose from "mongoose";
import { NotificationQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import { sendNotificationToAdmins } from "../../../helpers/notificationsHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";
import { ClubEconomy } from "../coinAndBudget/clubEconomySchema.model";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";
import { recordTeamCoinTransaction } from "../../../helpers/teamCoinLedgerHelper";
import { TEAM_COIN_CATEGORY } from "../teamCoinTransaction/teamCoinTransaction.interface";
import { carryForwardPlayerStats } from "../../../helpers/playerTransferStatsHelper";
import { LiveTransferMarket } from "../liveTransferMarket/liveTransferMarket.model";

// CREATE
const createTransferToDB = async (payload: any, userId: string) => {
  // 1. Check player
  const player = await User.findById(payload.player);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player not found");
  }

  const fromTeam = player.selectTeam || null;

  // 🛑 CANNOT REQUEST OWN TEAM'S PLAYER
  if (fromTeam && fromTeam.toString() === payload.toTeam.toString()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot send a transfer request for a player who is already in your team.",
    );
  }

  // 💰 Fetch dynamic economy settings
  const [clubEconomy, playerEconomy] = await Promise.all([
    ClubEconomy.findOne(),
    PlayerEconomy.findOne(),
  ]);

  const conversionRate = Number(playerEconomy?.conversionRate) || 10;
  const minReserveCoins =
    typeof clubEconomy?.minReserveCoins === "number"
      ? clubEconomy.minReserveCoins
      : clubEconomy?.startingBudget || 100000;

  // 💰 CHECK BUYING TEAM COIN BALANCE (ONLY FOR REGULAR PLAYERS WITH A FROM-TEAM)
  const isTrialPlayer = !fromTeam || player.role === USER_ROLES.OTHER_CLUBS;
  const playerCost = isTrialPlayer
    ? 0
    : player.engCoine !== undefined && player.engCoine !== null
    ? player.engCoine
    : Math.round((player.marketValue || 0) / conversionRate);
  const toTeamData = await Team.findById(payload.toTeam);

  if (!toTeamData) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Target buying team not found");
  }

  const buyingTeamCoin = toTeamData.coin || 0;
  if (
    !isTrialPlayer &&
    playerCost > 0 &&
    buyingTeamCoin - playerCost < minReserveCoins
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Insufficient team coin balance! Your team has ${buyingTeamCoin.toLocaleString()} coins. A minimum balance of ${minReserveCoins.toLocaleString()} coins must be maintained after transferring (Player cost: ${playerCost.toLocaleString()} coins).`,
    );
  }

  // 3. Determine transfer type
  let transferType: any = "CLUB_TO_CLUB";

  if (isTrialPlayer) {
    transferType = "FREE_AGENT";
  }

  // 4. Check manager permission
  const isManager = await ManagerTeam.findOne({
    manager: userId,
    team: payload.toTeam,
  });

  if (!isManager) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Not your team");
  }

  // 🛑 Check duplicate pending transfer request
  const existingPending = await Transfer.findOne({
    player: payload.player,
    toTeam: payload.toTeam,
    status: { $in: ["PENDING", "MANAGER_APPROVED"] },
  });

  if (existingPending) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "A pending transfer request already exists for this player.",
    );
  }

  // 5. Create transfer
  const transfer = await Transfer.create({
    player: payload.player,
    fromTeam,
    toTeam: payload.toTeam,
    requestedBy: userId,
    transferType,
  });

  const playerName = `${player.firstName || ""} ${player.lastName || player.userName || "Player"}`.trim();
  const buyingTeamName = toTeamData.teamName || "New Club";

  // 1.1 🔔 Notify Selling Club Managers (each club needs to receive a notification)
  if (fromTeam) {
    const sellingManagers = await ManagerTeam.find({ team: fromTeam });
    for (const sm of sellingManagers) {
      await NotificationQueueHelper.sendNotification(
        sm.manager.toString(),
        `${buyingTeamName} has submitted a transfer bid for your player ${playerName}. Please review and accept or decline.`,
        "New Transfer Bid Received",
        NOTIFICATION_TYPE.TRANSFER_REQUESTED,
        USER_ROLES.MANAGER,
        transfer._id.toString(),
        "Transfer",
      );
    }
  }

  // 1.1 🔔 Notify Parents (plus the parents)
  if (player.parentId) {
    await NotificationQueueHelper.sendNotification(
      player.parentId.toString(),
      `${buyingTeamName} has placed a transfer bid for your child ${playerName}. Awaiting club and league review.`,
      "Transfer Bid for Your Child",
      NOTIFICATION_TYPE.TRANSFER_REQUESTED,
      undefined,
      transfer._id.toString(),
      "Transfer",
    );
  }

  // 1.1 🔔 Notify Buying Club Manager (confirmation)
  await NotificationQueueHelper.sendNotification(
    userId,
    `Your transfer bid for ${playerName} has been submitted successfully and is awaiting review.`,
    "Transfer Bid Submitted",
    NOTIFICATION_TYPE.TRANSFER_REQUESTED,
    USER_ROLES.MANAGER,
    transfer._id.toString(),
    "Transfer",
  );

  // 🔔 Notify player: transfer request submitted via background queue helper
  await NotificationQueueHelper.sendNotification(
    payload.player.toString(),
    `A transfer request has been submitted for you by ${buyingTeamName}. Awaiting approval.`,
    "Transfer Request Submitted",
    NOTIFICATION_TYPE.TRANSFER_REQUESTED,
    USER_ROLES.PLAYER,
    transfer._id.toString(),
    "Transfer",
  );

  // 🔔 Notify admins: new transfer request
  await sendNotificationToAdmins({
    title: "New Transfer Request",
    message: `A new transfer request has been submitted for ${playerName} by ${buyingTeamName} (${transferType}). Please review.`,
    type: NOTIFICATION_TYPE.TRANSFER_REQUESTED,
    metadata: { transferId: transfer._id, transferType },
  });

  return transfer;
};

// GET ALL
const getAllTransfersFromDB = async (query: Record<string, any>) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const skip = (page - 1) * limit;

  const filter: any = {};

  if (query.status && query.status !== "ALL") {
    if (query.status === "ACTION_REQUIRED") {
      filter.status = { $in: ["PENDING", "MANAGER_APPROVED", "BOTH_APPROVED"] };
    } else {
      filter.status = query.status;
    }
  }

  if (query.isLiveMarket !== undefined && query.isLiveMarket !== "ALL" && query.isLiveMarket !== "") {
    filter.isLiveMarket = query.isLiveMarket === "true" || query.isLiveMarket === true;
  }

  const searchTerm = (query.searchTerm || query.search || query.searchValue) as string;
  if (searchTerm && searchTerm.trim()) {
    const regex = new RegExp(searchTerm.trim(), "i");
    const [matchingUsers, matchingTeams] = await Promise.all([
      User.find({
        $or: [
          { userName: { $regex: regex } },
          { email: { $regex: regex } },
          { firstName: { $regex: regex } },
          { lastName: { $regex: regex } },
        ],
      }).select("_id"),
      Team.find({ teamName: { $regex: regex } }).select("_id"),
    ]);

    const userIds = matchingUsers.map((u) => u._id);
    const teamIds = matchingTeams.map((t) => t._id);

    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        ...(userIds.length > 0
          ? [{ player: { $in: userIds } }, { requestedBy: { $in: userIds } }]
          : []),
        ...(teamIds.length > 0
          ? [{ fromTeam: { $in: teamIds } }, { toTeam: { $in: teamIds } }]
          : []),
      ],
    });
  }

  const [transfers, total] = await Promise.all([
    Transfer.find(filter)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })

      .populate({
        path: "player",
        select: "email profile role",
      })
      .populate({
        path: "requestedBy",
        select: "email profile role",
      })
      .populate({
        path: "approvedBy",
        select: "email profile role",
      })
      .populate({
        path: "fromTeam",
        select: "teamName",
      })
      .populate({
        path: "toTeam",
        select: "teamName",
      }),

    Transfer.countDocuments(filter),
  ]);

  // 🔥 STEP 1: collect all user ids
  const userIds = transfers
    .flatMap((t: any) => [t.player?._id, t.requestedBy?._id, t.approvedBy?._id])
    .filter(Boolean);

  // 🔥 STEP 2: get UserDetails (firstName + lastName)
  const details = await User.find({
    _id: { $in: userIds },
  });

  const getDetails = (id: string) =>
    details.find((d) => d._id.toString() === id?.toString());

  // 🔥 STEP 3: FLAT RESPONSE
  const result = transfers.map((t: any) => {
    const playerD = getDetails(t.player?._id);
    const reqD = getDetails(t.requestedBy?._id);
    const appD = getDetails(t.approvedBy?._id);

    return {
      id: t._id,

      // PLAYER
      playerFirstName: playerD?.firstName || null,
      playerLastName: playerD?.lastName || null,
      playerEmail: t.player?.email,
      playerProfile: t.player?.profile,

      // FROM TEAM
      fromTeamName: t.fromTeam?.teamName || null,

      // TO TEAM
      toTeamName: t.toTeam?.teamName || null,

      // REQUESTED BY
      requestedByFirstName: reqD?.firstName || null,
      requestedByLastName: reqD?.lastName || null,
      requestedByEmail: t.requestedBy?.email,

      // APPROVED BY
      approvedByFirstName: appD?.firstName || null,
      approvedByLastName: appD?.lastName || null,

      // MAIN DATA
      transferType: t.transferType,
      status: t.status,
      rejectReason: t.rejectReason,

      // LIVE TRANSFER MARKET DATA
      isLiveMarket: t.isLiveMarket || false,
      playerApproval: t.playerApproval || null,
      managerApproval: t.managerApproval || null,
      note: t.note || null,

      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  });

  return {
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    result,
  };
};
// MY TRANSFERS
const getMyTransfersFromDB = async (userId: string) => {
  const transfers = await Transfer.aggregate([
    {
      $match: {
        requestedBy: new mongoose.Types.ObjectId(userId),
      },
    },

    // User Profile
    {
      $lookup: {
        from: "users",
        localField: "player",
        foreignField: "_id",
        as: "playerUser",
      },
    },
    {
      $unwind: {
        path: "$playerUser",
        preserveNullAndEmptyArrays: true,
      },
    },

    // From Team
    {
      $lookup: {
        from: "teams",
        localField: "fromTeam",
        foreignField: "_id",
        as: "fromTeam",
      },
    },
    {
      $unwind: {
        path: "$fromTeam",
        preserveNullAndEmptyArrays: true,
      },
    },

    // To Team
    {
      $lookup: {
        from: "teams",
        localField: "toTeam",
        foreignField: "_id",
        as: "toTeam",
      },
    },
    {
      $unwind: {
        path: "$toTeam",
        preserveNullAndEmptyArrays: true,
      },
    },

    {
      $addFields: {
        player: {
          _id: "$player",
          firstName: "$playerUser.firstName",
          lastName: "$playerUser.lastName",
          profile: "$playerUser.profile",
        },
      },
    },

    {
      $project: {
        playerUser: 0,
      },
    },
  ]);

  return transfers;
};

// SINGLE
const getSingleTransferFromDB = async (id: string) => {
  const transfer = await Transfer.findById(id)
    .populate("player")
    .populate("fromTeam")
    .populate("toTeam");

  if (!transfer) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Transfer not found");
  }

  return transfer;
};

// APPROVE (2-Phase Approval: Manager Approve -> Admin Final Approve & Team Swap)
const approveTransferToDB = async (id: string, user: any) => {
  // 1. Find transfer
  const transfer = await Transfer.findById(id);

  if (!transfer) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Transfer not found");
  }

  const userId = user?._id || user?.id;
  const userRole = user?.role;

  // Fetch player details and teams for notification messages
  const player = await User.findById(transfer.player);
  const playerName = player
    ? `${player.firstName || ""} ${player.lastName || player.userName || "Player"}`.trim()
    : "Player";
  const toTeamObj = await Team.findById(transfer.toTeam);
  const fromTeamObj = transfer.fromTeam ? await Team.findById(transfer.fromTeam) : null;
  const toTeamName = toTeamObj?.teamName || "New Club";
  const fromTeamName = fromTeamObj?.teamName || "Current Club";

  // 🛑 PHASE 1: MANAGER APPROVAL (Step 1.2: Club needs to accept)
  if (userRole === USER_ROLES.MANAGER) {
    if (transfer.fromTeam) {
      const isFromTeamManager = await ManagerTeam.findOne({
        manager: userId,
        team: transfer.fromTeam,
      });

      if (!isFromTeamManager) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          "Access Denied: Only the manager of the player's current team can approve this transfer.",
        );
      }
    }

    if (transfer.status === "MANAGER_APPROVED") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "This transfer has already been accepted by the club manager.",
      );
    }
    if (transfer.status === "APPROVED") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "This transfer has already been finalized by admin.",
      );
    }

    transfer.status = "MANAGER_APPROVED";
    await transfer.save();

    // Notify Buying Club Manager
    await NotificationQueueHelper.sendNotification(
      transfer.requestedBy.toString(),
      `${fromTeamName} has accepted your transfer bid for ${playerName}. Awaiting final Admin approval.`,
      "Transfer Bid Accepted by Club",
      NOTIFICATION_TYPE.TRANSFER_REQUESTED,
      USER_ROLES.MANAGER,
      transfer._id.toString(),
      "Transfer",
    );

    // Notify Parents
    if (player?.parentId) {
      await NotificationQueueHelper.sendNotification(
        player.parentId.toString(),
        `${fromTeamName} has accepted the transfer bid for ${playerName}. Awaiting final league approval.`,
        "Transfer Bid Accepted by Club",
        NOTIFICATION_TYPE.TRANSFER_REQUESTED,
        undefined,
        transfer._id.toString(),
        "Transfer",
      );
    }

    // Notify player via background queue
    await NotificationQueueHelper.sendNotification(
      transfer.player.toString(),
      `Your club manager (${fromTeamName}) has approved the transfer request. Awaiting final Admin approval.`,
      "Manager Approved Transfer",
      NOTIFICATION_TYPE.GENERAL,
      USER_ROLES.PLAYER,
      transfer._id.toString(),
      "Transfer",
    );

    // 🔔 Notify Admins for final approval
    await sendNotificationToAdmins({
      title: "Transfer Approved by Club Manager",
      message: `${fromTeamName} manager has accepted the transfer bid for ${playerName}. Final Admin approval is required.`,
      type: NOTIFICATION_TYPE.TRANSFER_REQUESTED,
      metadata: { transferId: transfer._id },
    });

    return transfer;
  }

  // 🛑 PHASE 2: ADMIN / SUPER_ADMIN FINAL APPROVAL (TEAM SWAP & COIN TRANSFER)
  if (userRole === USER_ROLES.ADMIN || userRole === USER_ROLES.SUPER_ADMIN) {
    if (transfer.status === "APPROVED") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "This transfer is already approved.",
      );
    }

    // For club-to-club transfers, selling club manager must accept first
    if (transfer.isLiveMarket) {
      if (
        transfer.playerApproval?.status !== "APPROVED" ||
        transfer.managerApproval?.status !== "APPROVED"
      ) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Both the player and the current club manager must accept this Live Transfer Market bid before final Admin approval.",
        );
      }
    } else if (
      transfer.transferType === "CLUB_TO_CLUB" &&
      transfer.fromTeam &&
      transfer.status !== "MANAGER_APPROVED"
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "The selling club manager must accept the transfer request before final Admin approval.",
      );
    }

    const userDetails = await User.findById(transfer.player);

    if (!userDetails) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Player user not found");
    }

    const isTrialPlayer =
      !transfer.fromTeam || userDetails.role === USER_ROLES.OTHER_CLUBS;
    // 💰 1. Dynamic economy check from ClubEconomy and PlayerEconomy
    const [clubEconomy, playerEconomy] = await Promise.all([
      ClubEconomy.findOne(),
      PlayerEconomy.findOne(),
    ]);

    const conversionRate = Number(playerEconomy?.conversionRate) || 10;
    const minReserveCoins =
      typeof clubEconomy?.minReserveCoins === "number"
        ? clubEconomy.minReserveCoins
        : clubEconomy?.startingBudget || 100000;

    const playerCost = isTrialPlayer
      ? 0
      : userDetails.engCoine !== undefined && userDetails.engCoine !== null
      ? userDetails.engCoine
      : Math.round((userDetails.marketValue || 0) / conversionRate);

    // 2. Regular Player: Deduct coins from buying team (toTeam) enforcing dynamic minimum balance
    if (!isTrialPlayer && playerCost > 0) {
      if (!toTeamObj) {
        throw new ApiError(
          StatusCodes.NOT_FOUND,
          "Target buying team not found",
        );
      }

      const playerName = `${userDetails.firstName || ""} ${userDetails.lastName || userDetails.userName || "Player"}`.trim();

      // Deduct from buying team with atomic concurrency guarantee and ledger history
      try {
        await recordTeamCoinTransaction({
          teamId: toTeamObj._id,
          amount: -playerCost,
          category: TEAM_COIN_CATEGORY.PLAYER_TRANSFER_BUY,
          title: "Player Transfer Purchase",
          description: `Purchased player ${playerName} from ${fromTeamObj?.teamName || "previous club"} for ${playerCost.toLocaleString()} coins`,
          minBalanceAfter: minReserveCoins,
          transferredPlayerId: userDetails._id,
          opponentTeamId: fromTeamObj?._id,
          transferId: transfer._id,
        });
      } catch (coinErr: any) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Cannot complete transfer: Target buying team has insufficient coins. A minimum balance of ${minReserveCoins.toLocaleString()} coins must be maintained (Player cost: ${playerCost.toLocaleString()} coins).`
        );
      }

      // 3. Add coins to selling team (fromTeam) with ledger history
      if (fromTeamObj) {
        await recordTeamCoinTransaction({
          teamId: fromTeamObj._id,
          amount: playerCost,
          category: TEAM_COIN_CATEGORY.PLAYER_TRANSFER_SELL,
          title: "Player Transfer Sale",
          description: `Sold player ${playerName} to ${toTeamObj.teamName} for ${playerCost.toLocaleString()} coins`,
          transferredPlayerId: userDetails._id,
          opponentTeamId: toTeamObj._id,
          transferId: transfer._id,
        });
      }
    }

    // 4. Swap player's team to new team & promote role if Trial Player
    userDetails.selectTeam = transfer.toTeam as any;
    if (userDetails.role === USER_ROLES.OTHER_CLUBS) {
      userDetails.role = USER_ROLES.PLAYER;
      const startCoins = Number(playerEconomy?.startingCoins) || 10000;
      const startMV =
        Number(playerEconomy?.startingMarketValue) || startCoins * conversionRate;
      if (!userDetails.engCoine || userDetails.engCoine <= 0) {
        userDetails.engCoine = startCoins;
      }
      if (!userDetails.marketValue || userDetails.marketValue <= 0) {
        userDetails.marketValue = startMV;
      }
    } else {
      // Ensure regular player's market value is aligned with their coins
      if (
        userDetails.engCoine &&
        (!userDetails.marketValue || userDetails.marketValue <= 0)
      ) {
        userDetails.marketValue = userDetails.engCoine * conversionRate;
      }
    }
    await userDetails.save();

    // 5. Carry forward all player stats (PlayerStats, MatchResult events) to the new team
    await carryForwardPlayerStats(userDetails._id, transfer.toTeam);

    transfer.status = "APPROVED";
    transfer.approvedBy = userId as any;
    await transfer.save();

    // 🌟 If Live Transfer Market, mark listing as TRANSFERRED and delist player
    if (transfer.isLiveMarket) {
      await LiveTransferMarket.updateMany(
        { player: userDetails._id, status: { $in: ["ACTIVE", "PENDING_TRANSFER"] } },
        {
          status: "TRANSFERRED",
          transferredAt: new Date(),
          lastTransferId: transfer._id,
        }
      );
      userDetails.isLiveTransferListed = false;
      userDetails.liveTransferListingId = null as any;
      await userDetails.save();
    }

    // 1.3 Notify Buying Club Manager
    await NotificationQueueHelper.sendNotification(
      transfer.requestedBy.toString(),
      `Transfer Complete: ${playerName} has officially joined ${toTeamName}.`,
      "Transfer Complete",
      NOTIFICATION_TYPE.TRANSFER_APPROVED,
      USER_ROLES.MANAGER,
      transfer._id.toString(),
      "Transfer",
    );

    // 1.3 Notify Selling Club Manager(s)
    if (transfer.fromTeam) {
      const sellingManagers = await ManagerTeam.find({ team: transfer.fromTeam });
      for (const sm of sellingManagers) {
        await NotificationQueueHelper.sendNotification(
          sm.manager.toString(),
          `Transfer Complete: ${playerName} has moved to ${toTeamName}.${playerCost > 0 ? ` ${playerCost.toLocaleString()} coins have been credited to your club.` : ""}`,
          "Transfer Finalized",
          NOTIFICATION_TYPE.TRANSFER_APPROVED,
          USER_ROLES.MANAGER,
          transfer._id.toString(),
          "Transfer",
        );
      }
    }

    // 1.3 Notify Parents
    if (userDetails.parentId) {
      await NotificationQueueHelper.sendNotification(
        userDetails.parentId.toString(),
        `Transfer Complete: ${playerName} is now officially registered with ${toTeamName}.`,
        "Transfer Complete",
        NOTIFICATION_TYPE.TRANSFER_APPROVED,
        undefined,
        transfer._id.toString(),
        "Transfer",
      );
    }

    // Notify player: transfer approved via background queue
    await NotificationQueueHelper.sendNotification(
      transfer.player.toString(),
      `Your transfer request to ${toTeamName} has been approved by the Administrator. You are now registered with the new team.`,
      "Transfer Approved",
      NOTIFICATION_TYPE.TRANSFER_APPROVED,
      USER_ROLES.PLAYER,
      transfer._id.toString(),
      "Transfer",
    );

    // Notify subscribers of the new team via BullMQ
    if (transfer.toTeam) {
      try {
        await NotificationQueueHelper.notifyTeamSubscribers(
          transfer.toTeam.toString(),
          `New Player Signing: ${toTeamName}`,
          `${playerName} has officially joined ${toTeamName}.`,
          "TRANSFER",
          transfer._id.toString(),
          "Transfer",
          { playerId: transfer.player.toString(), transferId: transfer._id.toString() }
        );
      } catch (err) {
        console.error("Failed to notify toTeam subscribers:", err);
      }
    }

    // Notify subscribers of the former team via BullMQ
    if (transfer.fromTeam) {
      try {
        await NotificationQueueHelper.notifyTeamSubscribers(
          transfer.fromTeam.toString(),
          `Squad Update: ${playerName}`,
          `${playerName} has completed a transfer to ${toTeamName}.`,
          "TRANSFER",
          transfer._id.toString(),
          "Transfer",
          { playerId: transfer.player.toString(), transferId: transfer._id.toString() }
        );
      } catch (err) {
        console.error("Failed to notify fromTeam subscribers:", err);
      }
    }

    return transfer;
  }

  throw new ApiError(
    StatusCodes.FORBIDDEN,
    "Unauthorized role to approve transfer",
  );
};

// REJECT
const rejectTransferToDB = async (
  id: string,
  reason: string,
  userId: string,
  userRole?: string,
) => {
  const transfer = await Transfer.findById(id);

  if (!transfer) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Transfer not found");
  }

  if (userRole === USER_ROLES.MANAGER) {
    if (transfer.fromTeam) {
      const isFromTeamManager = await ManagerTeam.findOne({
        manager: userId,
        team: transfer.fromTeam,
      });

      if (!isFromTeamManager) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          "Access Denied: Only the manager of the player's current team can reject this transfer.",
        );
      }
    }
  }

  transfer.status = "REJECTED";
  transfer.rejectReason = reason;
  transfer.approvedBy = userId as any;

  await transfer.save();

  const player = await User.findById(transfer.player);
  const playerName = player
    ? `${player.firstName || ""} ${player.lastName || player.userName || "Player"}`.trim()
    : "Player";

  // 🔔 Notify Buying Club Manager
  await NotificationQueueHelper.sendNotification(
    transfer.requestedBy.toString(),
    `The transfer bid for ${playerName} was declined. Reason: ${reason || "No reason provided."}`,
    "Transfer Request Declined",
    NOTIFICATION_TYPE.TRANSFER_REJECTED,
    USER_ROLES.MANAGER,
    transfer._id.toString(),
    "Transfer",
  );

  // 🔔 Notify Parents
  if (player?.parentId) {
    await NotificationQueueHelper.sendNotification(
      player.parentId.toString(),
      `The transfer bid for ${playerName} was declined. Reason: ${reason || "No reason provided."}`,
      "Transfer Request Declined",
      NOTIFICATION_TYPE.TRANSFER_REJECTED,
      undefined,
      transfer._id.toString(),
      "Transfer",
    );
  }

  // 🔔 Notify player: transfer rejected via background queue
  await NotificationQueueHelper.sendNotification(
    transfer.player.toString(),
    `Your transfer request has been rejected. Reason: ${reason || "No reason provided."}`,
    "Transfer Request Rejected",
    NOTIFICATION_TYPE.TRANSFER_REJECTED,
    USER_ROLES.PLAYER,
    transfer._id.toString(),
    "Transfer",
  );

  return transfer;
};

// WITHDRAW
const withdrawTransferToDB = async (transferId: string, userId: string) => {
  const transfer = await Transfer.findById(transferId);

  if (!transfer) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Transfer not found");
  }

  if (transfer.requestedBy.toString() !== userId.toString()) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Not allowed");
  }

  if (transfer.status !== "PENDING") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Only pending can withdraw");
  }

  transfer.status = "WITHDRAWN";

  await transfer.save();

  return transfer;
};

// avilabe
const getAvailablePlayersFromDB = async (
  managerId: string,
  page = 1,
  limit = 10,
) => {
  const managerObjectId = new mongoose.Types.ObjectId(managerId);
  const skip = (page - 1) * limit;

  // Find requesting manager's assigned team
  const managerTeam = await ManagerTeam.findOne({ manager: managerObjectId });
  const managerTeamId = managerTeam ? managerTeam.team : null;

  const matchConditions: any = {
    status: "APPROVED",
    role: { $in: [USER_ROLES.OTHER_CLUBS] },
    $or: [
      { parentId: { $ne: null } },
      { password: null },
      { email: null },
      { position: { $exists: true, $ne: null } },
      { dateOfBirth: { $exists: true, $ne: null } },
    ],
  };

  // Exclude players already belonging to requesting manager's own team
  if (managerTeamId) {
    matchConditions.selectTeam = { $ne: managerTeamId };
  }

  const result = await User.aggregate([
    // 1️⃣ Filter players (Exclude Parent accounts & manager's own team players)
    {
      $match: matchConditions,
    },

    // 2️⃣ Approved transfers
    {
      $lookup: {
        from: "transfers",
        let: { playerId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$player", "$$playerId"] },
                  { $eq: ["$status", "APPROVED"] },
                ],
              },
            },
          },
        ],
        as: "approvedTransfers",
      },
    },

    // 3️⃣ Pending by this manager
    {
      $lookup: {
        from: "transfers",
        let: {
          playerId: "$_id",
          managerId: managerObjectId,
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$player", "$$playerId"] },
                  { $eq: ["$status", "PENDING"] },
                  { $eq: ["$requestedBy", "$$managerId"] },
                ],
              },
            },
          },
        ],
        as: "myPending",
      },
    },

    // 4️⃣ Flags
    {
      $addFields: {
        isApproved: { $gt: [{ $size: "$approvedTransfers" }, 0] },
        isMyPending: { $gt: [{ $size: "$myPending" }, 0] },
      },
    },

    // 5️⃣ Filters
    {
      $match: {
        approvedTransfers: { $eq: [] },
        myPending: { $eq: [] },
      },
    },

    // 7️⃣ Final projection
    {
      $project: {
        _id: 1,
        userName: 1,
        profile: 1,
        email: 1,
        role: 1,
        createdAt: 1,

        firstName: 1,
        lastName: 1,
        phone: 1,
        selectTeam: 1,

        isApproved: 1,
        isMyPending: 1,
      },
    },

    // 8️⃣ SORT
    {
      $sort: { createdAt: -1 },
    },

    // 9️⃣ PAGINATION (IMPORTANT)
    {
      $facet: {
        data: [{ $skip: skip }, { $limit: limit }],
        meta: [{ $count: "total" }],
      },
    },
  ]);

  const data = result[0]?.data || [];
  const total = result[0]?.meta[0]?.total || 0;

  return {
    meta: {
      total,
      page,
      limit,
      totalPage: Math.ceil(total / limit),
    },
    data,
  };
};

const getManagerTransferRequestsFromDB = async (
  managerId: string,
  query: Record<string, any>,
) => {
  const managerTeams = await ManagerTeam.find({
    manager: managerId,
  });

  if (!managerTeams || !managerTeams.length) {
    return [];
  }

  const myTeamIds = managerTeams.map((item) => item.team);

  // 📥 INCOMING REQUESTS ONLY: Requests sent by other teams for players in THIS manager's team (fromTeam)
  const transfers = await Transfer.find({
    fromTeam: { $in: myTeamIds },
  })
    .populate({
      path: "player",
      select: "email profile userName firstName lastName",
    })
    .populate({
      path: "fromTeam",
      select: "teamName shortName teamLogo",
    })
    .populate({
      path: "toTeam",
      select: "teamName shortName teamLogo",
    })
    .sort({ createdAt: -1 })
    .lean();

  if (!transfers.length) return [];

  // 🔥 ADD USERDETAILS MANUALLY IF NEEDED
  const userIds = transfers.map((t) => t.player?._id).filter(Boolean);

  const details = await User.find({
    _id: { $in: userIds },
  });

  const detailsMap = new Map(details.map((d) => [d._id.toString(), d]));

  const result = transfers.map((t: any) => {
    const playerObj = t.player || {};
    const d: any = detailsMap.get(playerObj._id?.toString());

    return {
      ...t,
      player: {
        ...playerObj,
        firstName: d?.firstName || playerObj.firstName || null,
        lastName: d?.lastName || playerObj.lastName || null,
      },
    };
  });

  return result;
};

const getTransferOverviewFromDB = async () => {
  const [
    total,
    pending,
    managerApproved,
    bothApproved,
    approved,
    rejected,
    withdrawn,
    liveMarket,
    activeListings,
  ] = await Promise.all([
    Transfer.countDocuments(),
    Transfer.countDocuments({ status: "PENDING" }),
    Transfer.countDocuments({ status: "MANAGER_APPROVED" }),
    Transfer.countDocuments({ status: "BOTH_APPROVED" }),
    Transfer.countDocuments({ status: "APPROVED" }),
    Transfer.countDocuments({ status: "REJECTED" }),
    Transfer.countDocuments({ status: "WITHDRAWN" }),
    Transfer.countDocuments({ isLiveMarket: true }),
    LiveTransferMarket.countDocuments({ status: "ACTIVE" }),
  ]);

  return {
    totalTransfers: total,
    pendingTransfers: pending,
    managerApprovedTransfers: managerApproved,
    bothApprovedTransfers: bothApproved,
    actionRequiredTransfers: pending + managerApproved + bothApproved,
    approvedTransfers: approved,
    rejectedTransfers: rejected,
    withdrawnTransfers: withdrawn,
    liveMarketTransfers: liveMarket,
    activeLiveMarketListings: activeListings,
  };
};

export const TransferService = {
  createTransferToDB,
  getAllTransfersFromDB,
  getMyTransfersFromDB,
  getSingleTransferFromDB,
  approveTransferToDB,
  rejectTransferToDB,
  withdrawTransferToDB,
  getAvailablePlayersFromDB,
  getManagerTransferRequestsFromDB,
  getTransferOverviewFromDB,
};
