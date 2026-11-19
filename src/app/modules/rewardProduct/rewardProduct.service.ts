import { Types } from 'mongoose';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import QueryBuilder from "../../../util/queryBuilder";
import { IRewardProduct } from "./rewardProduct.interface";
import { RewardProduct } from "./rewardProduct.model";
import { User } from '../user/user.model';
import { Subscription } from '../subscription/subscription.model';
import { isPremiumPlayerPackage } from '../../../helpers/packageHelper';
import { PlayerEconomy } from '../coinAndBudget/playerEconomySchema.model';
import { recordCoinTransaction } from '../../../helpers/coinLedgerHelper';
import { COIN_TRANSACTION_CATEGORY } from '../coinTransaction/coinTransaction.interface';

// CREATE
const createRewardProductToDB = async (
  payload: IRewardProduct,
  userId: string,
) => {
  const result = await RewardProduct.create({
    ...payload,
    createdBy: userId,
  });

  return result;
};

// GET ALL
const getAllRewardProductsFromDB = async (query: Record<string, any>) => {
  const rewardQuery = new QueryBuilder(RewardProduct.find(), query)
    .search(["brand"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const [result, meta] = await Promise.all([
    rewardQuery.modelQuery.populate({
      path: 'redeemedUsers.user',
      select:
        'userName firstName lastName email emergencyEmail phone profile role selectTeam parentId',
      populate: {
        path: 'parentId',
        select: 'email emergencyEmail phone',
      },
    }),
    rewardQuery.getPaginationInfo(),
  ]);

  return {
    meta,
    result,
  };
};

// GET OVERVIEW / ANALYTICS (DEDICATED SEPARATE API)
const getRewardProductsOverviewFromDB = async () => {
  const summaryAgg = await RewardProduct.aggregate([
    {
      $group: {
        _id: null,
        totalItems: { $sum: 1 },
        merchandiseCount: {
          $sum: { $cond: [{ $eq: ["$productType", "nonCoffee"] }, 1, 0] },
        },
        coffeeCount: {
          $sum: { $cond: [{ $eq: ["$productType", "Coffee"] }, 1, 0] },
        },
        totalClaims: {
          $sum: { $size: { $ifNull: ["$redeemedUsers", []] } },
        },
      },
    },
  ]);

  return summaryAgg?.[0] || {
    totalItems: 0,
    merchandiseCount: 0,
    coffeeCount: 0,
    totalClaims: 0,
  };
};




// GET SINGLE
const getSingleRewardProductFromDB = async (
  id: string
) => {
  const result = await RewardProduct.findById(id).populate({
    path: 'redeemedUsers.user',
    select: 'userName firstName lastName email emergencyEmail phone profile role selectTeam parentId',
    populate: {
      path: 'parentId',
      select: 'email emergencyEmail phone',
    },
  });

  if (!result) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Reward product not found'
    );
  }

  return result;
};

// UPDATE
const updateRewardProductToDB = async (
  id: string,
  payload: Partial<IRewardProduct>
) => {
  const rewardProduct =
    await RewardProduct.findById(id);

  if (!rewardProduct) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Reward product not found'
    );
  }

  const result =
    await RewardProduct.findByIdAndUpdate(
      id,
      payload,
      {
        new: true,
      }
    );

  return result;
};

// DELETE
const deleteRewardProductToDB = async (
  id: string
) => {
  const rewardProduct =
    await RewardProduct.findById(id);

  if (!rewardProduct) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Reward product not found'
    );
  }

  return await RewardProduct.findByIdAndDelete(
    id
  );
};

// TOGGLE STATUS
const toggleRewardProductStatusToDB = async (
  id: string
) => {
  const rewardProduct =
    await RewardProduct.findById(id);

  if (!rewardProduct) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      'Reward product not found'
    );
  }

  rewardProduct.status =
    rewardProduct.status === 'publish'
      ? 'unpublish'
      : 'publish';

  return await rewardProduct.save();
};

// GET QR CODE (ONLY FOR Coffee PRODUCT TYPE)
const getRewardProductQrCodeFromDB = async (id: string) => {
  const rewardProduct = await RewardProduct.findById(id).populate({
    path: 'redeemedUsers.user',
    select: 'userName firstName lastName fullName email emergencyEmail phone profile role selectTeam parentId',
    populate: {
      path: 'parentId',
      select: 'email emergencyEmail phone',
    },
  });

  if (!rewardProduct) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Reward product not found');
  }

  // ONLY ALLOW COFFEE PRODUCTS FOR QR CODE GENERATION
  if (rewardProduct.productType !== 'Coffee') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'QR codes can only be generated for Coffee reward products! nonCoffee items are not eligible.'
    );
  }

  if (!rewardProduct.rewardToken) {
    rewardProduct.rewardToken =
      'rp_reward_' +
      Math.random().toString(36).substring(2, 10) +
      Date.now().toString(36);
    await rewardProduct.save();
  }

  const qrPayload = {
    type: 'REWARD_PRODUCT',
    productId: rewardProduct._id?.toString(),
    productType: rewardProduct.productType,
    brand: rewardProduct.brand,
    point: rewardProduct.point,
    rewardToken: rewardProduct.rewardToken,
  };

  return {
    productId: rewardProduct._id,
    brand: rewardProduct.brand,
    productType: rewardProduct.productType,
    point: rewardProduct.point,
    rewardToken: rewardProduct.rewardToken,
    qrPayloadString: JSON.stringify(qrPayload),
    qrPayload,
    redeemedUsers: rewardProduct.redeemedUsers || [],
  };
};

// REDEEM COFFEE REWARD PRODUCT (NO USER LIMIT - UNLIMITED REDEMPTIONS PERMITTED)
const redeemCoffeeRewardInDB = async (
  userId: string,
  payload: {
    productId?: string;
    rewardToken?: string;
    qrData?: string;
    playerId?: string;
  }
) => {
  let productId = payload.productId;
  let rewardToken = payload.rewardToken;
  let targetPlayerId = payload.playerId;

  if (payload.qrData) {
    try {
      const parsed =
        typeof payload.qrData === 'string'
          ? JSON.parse(payload.qrData)
          : payload.qrData;
      if (parsed.productId) productId = parsed.productId;
      if (parsed.rewardToken) rewardToken = parsed.rewardToken;
      if (parsed.playerId) targetPlayerId = parsed.playerId;
    } catch {
      // ignore
    }
  }

  if (targetPlayerId && targetPlayerId.toString() !== userId.toString()) {
    const isChild = await User.findOne({
      _id: targetPlayerId,
      parentId: userId,
    });
    if (!isChild) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        'You are not authorized to redeem rewards for this player.'
      );
    }
  }

  const finalPlayerId = targetPlayerId || userId;
  if (!finalPlayerId) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Player ID or User ID is required for reward redemption'
    );
  }

  let rewardProduct: any = null;
  if (productId) {
    rewardProduct = await RewardProduct.findById(productId);
  } else if (rewardToken) {
    rewardProduct = await RewardProduct.findOne({ rewardToken });
  }

  if (!rewardProduct) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Reward product not found');
  }

  if (rewardProduct.productType !== 'Coffee') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'QR code redemption is strictly available for Coffee reward products only.'
    );
  }

  if (rewardProduct.status !== 'publish') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'This Coffee reward product is not active for redemption.'
    );
  }

  const user = await User.findById(finalPlayerId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Player profile not found');
  }

  if (user.status !== 'APPROVED') {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Only approved players can redeem Coffee rewards!'
    );
  }

  const activeSubscription = await Subscription.findOne({
    user: user._id,
    status: 'active',
  }).populate('package');

  if (!activeSubscription || !activeSubscription.package) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Player must have an active subscription package to redeem rewards!'
    );
  }

  const pkg = activeSubscription.package as any;
  const isPremium = await isPremiumPlayerPackage(pkg);

  if (!isPremium || pkg.packageType === 'Semi Pro') {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      'Only Premium subscription package holders are allowed to redeem rewards!'
    );
  }

  const awardPoints = Number(rewardProduct.point) || 0;
  const currentCoins = Number(user.engCoine) || 0;

  // Unlimited redemptions permitted, but guard against rapid double-taps / concurrent scans within 10 seconds
  const tenSecondsAgo = new Date(Date.now() - 10000);
  const playerObjectId = new Types.ObjectId(finalPlayerId);

  const updatedProduct = await RewardProduct.findOneAndUpdate(
    {
      _id: rewardProduct._id,
      redeemedUsers: {
        $not: {
          $elemMatch: {
            user: playerObjectId,
            redeemedAt: { $gt: tenSecondsAgo },
          },
        },
      },
    },
    {
      $push: {
        redeemedUsers: {
          user: playerObjectId,
          redeemedAt: new Date(),
          points: awardPoints,
        },
      },
    },
    { new: true }
  );

  if (!updatedProduct) {
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      "Duplicate scan detected. Please wait a few seconds before scanning again."
    );
  }

  // ADD (+) COINS & UPDATE MARKET VALUE FOR THE PLAYER THROUGH LEDGER
  if (awardPoints > 0) {
    try {
      const { user: updatedUser } = await recordCoinTransaction({
        userId: finalPlayerId,
        amount: awardPoints,
        category: COIN_TRANSACTION_CATEGORY.COFFEE_REWARD,
        title: "Coffee Reward Earned",
        description: `Earned ${awardPoints.toLocaleString()} ENG Coins for redeeming "${rewardProduct.brand || rewardProduct.title}"`,
        referenceId: rewardProduct._id.toString(),
      });
      if (updatedUser) {
        user.engCoine = updatedUser.engCoine;
        user.marketValue = updatedUser.marketValue;
      }
    } catch (e) {
      console.error("Failed to record coin transaction for reward product:", e);
      const pe = await PlayerEconomy.findOne();
      const rate = pe?.conversionRate ?? 10;
      user.engCoine = currentCoins + awardPoints;
      user.marketValue = (user.engCoine || 0) * rate;
      await user.save();
    }
  }

  const getValidEmail = (val?: string | null) =>
    val && typeof val === 'string' && val.includes('@') ? val : '';

  let userEmail =
    getValidEmail(user.email) ||
    getValidEmail(user.emergencyEmail);

  if (!userEmail && user.parentId) {
    const parentUser = await User.findById(user.parentId).select('email emergencyEmail');
    if (parentUser) {
      userEmail =
        getValidEmail(parentUser.email) ||
        getValidEmail(parentUser.emergencyEmail);
    }
  }

  const computedName =
    (user as any).fullName ||
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    user.userName ||
    'Player';

  const playerRedeemCount = rewardProduct.redeemedUsers.filter(
    (ru: any) => ru.user.toString() === finalPlayerId.toString()
  ).length;

  return {
    productId: rewardProduct._id,
    brand: rewardProduct.brand,
    productType: rewardProduct.productType,
    pointCost: awardPoints,
    coinsEarned: awardPoints,
    playerId: user._id,
    playerName: computedName,
    email: userEmail,
    remainingEngCoine: user.engCoine,
    marketValue: user.marketValue,
    redeemedAt: new Date(),
    totalTimesRedeemedByPlayer: playerRedeemCount,
    totalRedemptionsCount: rewardProduct.redeemedUsers.length,
  };
};

export const RewardProductService = {
  createRewardProductToDB,
  getAllRewardProductsFromDB,
  getRewardProductsOverviewFromDB,
  getSingleRewardProductFromDB,
  updateRewardProductToDB,
  deleteRewardProductToDB,
  toggleRewardProductStatusToDB,
  getRewardProductQrCodeFromDB,
  redeemCoffeeRewardInDB,
};