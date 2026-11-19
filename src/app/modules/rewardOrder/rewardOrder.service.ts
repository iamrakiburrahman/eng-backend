import { StatusCodes } from "http-status-codes";
import mongoose from "mongoose";
import ApiError from "../../../errors/ApiErrors";
import QueryBuilder from "../../../util/queryBuilder";
import { User } from "../user/user.model";
import { RewardProduct } from "../rewardProduct/rewardProduct.model";
import { RewardOrder } from "./rewardOrder.model";
import { Subscription } from "../subscription/subscription.model";
import { NotificationQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import { sendNotificationToAdmins } from "../../../helpers/notificationsHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";

import { isPremiumPlayerPackage } from "../../../helpers/packageHelper";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";
import { CoinTransaction } from "../coinTransaction/coinTransaction.model";
import { COIN_TRANSACTION_CATEGORY } from "../coinTransaction/coinTransaction.interface";

// CREATE ORDER
const createRewardOrderToDB = async (payload: any, userId: string) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    let targetPlayerId = userId;
    const requestedTarget = payload.player || payload.playerId || payload.user;
    if (requestedTarget && requestedTarget.toString() !== userId.toString()) {
      const parentCheck = await User.findById(requestedTarget).session(session);
      if (!parentCheck || !parentCheck.parentId || parentCheck.parentId.toString() !== userId.toString()) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          "You are not authorized to use another player's balance to create reward orders",
        );
      }
      targetPlayerId = requestedTarget;
    }

    const user = await User.findById(targetPlayerId).session(session);

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
    }

    // Check active subscription package permissions for point redemption
    const activeSubUserId = targetPlayerId || user._id;

    const subscription = await Subscription.findOne({
      user: activeSubUserId,
      status: "active",
    }).populate("package");

    if (!subscription || !subscription.package) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You must have an active subscription package to redeem rewards!",
      );
    }

    const pkg = subscription.package as any;
    const isPremium = await isPremiumPlayerPackage(pkg);

    if (!isPremium || pkg.packageType === "Semi Pro") {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Only Premium subscription package holders are allowed to redeem rewards!",
      );
    }

    const rewardProduct = await RewardProduct.findById(
      payload.rewardProduct,
    ).session(session);

    if (!rewardProduct) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Reward product not found");
    }

    if (rewardProduct.status !== "publish") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Reward product is not available",
      );
    }

    // User current ENG Coins (Must maintain minimum starting coin balance)
    const userCoin = user.engCoine || 0;

    const pe = await PlayerEconomy.findOne().session(session);
    const rate = pe?.conversionRate ?? 10;
    const minFloorMV = Number(pe?.startingMarketValue) || 10000000;
    const minFloorCoin = Number((pe as any)?.startingCoins) || (rate > 0 ? Math.round(minFloorMV / rate) : 10000);

    if (userCoin - rewardProduct.point < minFloorCoin) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Insufficient coin balance! A minimum balance of ${minFloorCoin.toLocaleString()} coins must be maintained in your account (Current: ${userCoin}, Required item cost: ${rewardProduct.point}).`,
      );
    }

    // Deduct ENG Coins & dynamically update marketValue
    user.engCoine = userCoin - rewardProduct.point;
    user.marketValue = (user.engCoine || 0) * rate;

    await user.save({ session });

    // Create Reward Order
    const order = await RewardOrder.create(
      [
        {
          user: user._id,
          rewardProduct: rewardProduct._id,
          pointUsed: rewardProduct.point,
        },
      ],
      { session },
    );

    // Record Coin Transaction Ledger
    await CoinTransaction.create(
      [
        {
          user: user._id,
          type: "DEBIT",
          amount: rewardProduct.point,
          balanceBefore: userCoin,
          balanceAfter: user.engCoine,
          category: COIN_TRANSACTION_CATEGORY.PRODUCT_PURCHASE,
          title: "Product Redemption",
          description: `Redeemed item: "${rewardProduct.brand}" for ${rewardProduct.point.toLocaleString()} ENG Coins`,
          referenceId: rewardProduct._id.toString(),
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    // Notify Player via background queue
    await NotificationQueueHelper.sendNotification(
      user._id.toString(),
      `Your reward order has been placed successfully. ${rewardProduct.point} points have been deducted from your ENG Coins.`,
      "Reward Order Placed",
      NOTIFICATION_TYPE.REWARD_ORDER_PLACED,
      undefined,
      order[0]._id.toString(),
      "RewardOrder",
    );

    if (userId && userId.toString() !== user._id.toString()) {
      await NotificationQueueHelper.sendNotification(
        userId.toString(),
        `Reward order placed for ${user.firstName || "Player"}. ${rewardProduct.point} points have been deducted.`,
        "Reward Order Placed",
        NOTIFICATION_TYPE.REWARD_ORDER_PLACED,
        undefined,
        order[0]._id.toString(),
        "RewardOrder",
      );
    }

    // Notify Admins
    console.log("Sending notification to admins...");
    await sendNotificationToAdmins({
      title: "New Reward Order",
      message:
        "A player has placed a new reward order. Please review and approve.",
      type: NOTIFICATION_TYPE.REWARD_ORDER_PLACED,
      metadata: {
        orderId: order[0]._id,
      },
    });

    console.log("Admin notification sent");
    console.log("========== SUCCESS ==========");

    return order[0];
  } catch (error) {
    console.log("========== ERROR ==========");
    console.error(error);

    await session.abortTransaction();
    session.endSession();

    console.log("Transaction aborted");

    throw error;
  }
};

// GET ALL
const getAllRewardOrdersFromDB = async (query: Record<string, any>) => {
  const rewardOrderQuery = new QueryBuilder(
    RewardOrder.find()
      .populate({
        path: "user",
        select: "userName firstName lastName",
      })
      .populate({
        path: "rewardProduct",
        select: "brand point",
      })
      .populate({
        path: "approvedBy",
        select: "firstName lastName",
      }),
    query,
  )
    .filter()
    .sort()
    .paginate()
    .fields();

  const orders = await rewardOrderQuery.modelQuery;

  const meta = await rewardOrderQuery.getPaginationInfo();

  const result = orders.map((order: any, index: number) => ({
    id: order._id,
    userId: order.user?._id,
    userName: order.user?.userName,
    firstName: order.user?.firstName,
    lastName: order.user?.lastName,
    brandName: order.rewardProduct?.brand,
    point: order.rewardProduct?.point,
    pointUsed: order.pointUsed,
    status: order.status,
    updatedAt: order.updatedAt,
  }));

  return {
    meta,
    result,
  };
};

// MY ORDERS
const getMyRewardOrdersFromDB = async (query: Record<string, any>, userId?: string) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;

  const filter: any = {};
  if (userId) {
    filter.user = userId;
  } else if (query.player) {
    filter.user = query.player;
  }

  const [result, total] = await Promise.all([
    RewardOrder.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("rewardProduct")
      .lean(),

    RewardOrder.countDocuments(filter),
  ]);

  const totalPage = Math.ceil(total / limit);

  return {
    data: result,
    meta: {
      page,
      limit,
      total,
      totalPage
    },
  };
};

// SINGLE
const getSingleRewardOrderFromDB = async (id: string, currentUser?: any) => {
  const result = await RewardOrder.findById(id)
    .populate("user")
    .populate("rewardProduct")
    .populate("approvedBy");

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Reward order not found");
  }

  if (currentUser) {
    const role = currentUser.role;
    const currentUserId = (currentUser._id || currentUser.id)?.toString();
    const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
    const orderUserId = (result.user as any)?._id?.toString() || result.user?.toString();
    if (!isAdmin && orderUserId !== currentUserId) {
      throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to view this reward order");
    }
  }

  return result;
};

// APPROVE
const approveRewardOrderToDB = async (id: string, adminId: string) => {
  const order = await RewardOrder.findById(id);

  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Reward order not found");
  }

  if (order.status !== "pending") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Only pending orders can be approved",
    );
  }

  order.status = "approved";
  order.approvedBy = adminId as any;
  order.approvedAt = new Date();

  await order.save();

  // Notify player: order approved via background queue
  await NotificationQueueHelper.sendNotification(
    order.user.toString(),
    "Your reward order has been approved! It will be delivered to you soon.",
    "Reward Order Approved",
    NOTIFICATION_TYPE.REWARD_ORDER_APPROVED,
    undefined,
    order._id.toString(),
    "RewardOrder",
  );

  return order;
};

// REJECT
const rejectRewardOrderToDB = async (
  id: string,
  rejectReason: string | undefined,
  adminId: string,
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const order = await RewardOrder.findById(id)
      .populate("rewardProduct")
      .session(session);

    if (!order) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Reward order not found");
    }

    if (order.status !== "pending") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Only pending orders can be rejected",
      );
    }

    // RETURN POINT
    const user = await User.findById(order.user).session(session);

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }

    const userCoinBefore = user.engCoine || 0;
    // Refund points to user's ENG Coins (primary) and reward points (legacy)
    user.engCoine = userCoinBefore + order.pointUsed;
    user.rewardPoint = (user.rewardPoint || 0) + order.pointUsed;

    await user.save({ session });

    // Record Coin Transaction Ledger for refund
    await CoinTransaction.create(
      [
        {
          user: user._id,
          type: "CREDIT",
          amount: order.pointUsed,
          balanceBefore: userCoinBefore,
          balanceAfter: user.engCoine,
          category: COIN_TRANSACTION_CATEGORY.ROLLBACK,
          title: "Order Refund",
          description: `Refunded ${order.pointUsed.toLocaleString()} ENG Coins for rejected order #${order._id.toString().slice(-6)}`,
          referenceId: order._id.toString(),
        },
      ],
      { session },
    );

    // UPDATE ORDER
    order.status = "rejected";
    if (rejectReason) {
      order.rejectReason = rejectReason;
    }
    order.approvedBy = adminId as any;

    await order.save({ session });

    await session.commitTransaction();
    session.endSession();

    const reasonText = rejectReason ? ` Reason: ${rejectReason}` : "";
    // Notify player: order rejected + points refunded via background queue
    await NotificationQueueHelper.sendNotification(
      order.user.toString(),
      `Your reward order has been rejected. ${order.pointUsed} points have been refunded to your account.${reasonText}`,
      "Reward Order Rejected",
      NOTIFICATION_TYPE.REWARD_ORDER_REJECTED,
      undefined,
      order._id.toString(),
      "RewardOrder",
    );

    return order;
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    throw error;
  }
};

// DELIVERED
const deliveredRewardOrderToDB = async (id: string) => {
  const order = await RewardOrder.findById(id);

  if (!order) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Reward order not found");
  }

  if (order.status !== "approved") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Only approved orders can be delivered",
    );
  }

  order.status = "delivered";

  await order.save();

  // Notify player: order delivered via background queue
  await NotificationQueueHelper.sendNotification(
    order.user.toString(),
    "Your reward order has been delivered! Enjoy your reward.",
    "Reward Order Delivered",
    NOTIFICATION_TYPE.REWARD_ORDER_DELIVERED,
    undefined,
    order._id.toString(),
    "RewardOrder",
  );

  return order;
};

export const RewardOrderService = {
  createRewardOrderToDB,
  getAllRewardOrdersFromDB,
  getMyRewardOrdersFromDB,
  getSingleRewardOrderFromDB,
  approveRewardOrderToDB,
  rejectRewardOrderToDB,
  deliveredRewardOrderToDB,
};
