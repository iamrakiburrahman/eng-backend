import { StatusCodes } from 'http-status-codes';
import mongoose, { Types } from 'mongoose';
import ApiError from '../../../errors/ApiErrors';
import QueryBuilder from '../../../util/queryBuilder';
import {
  IPromotionalZone,
  TPromotionStatus,
} from './promotionalZone.interface';
import { PromotionalZone } from './promotionalZone.model';

// 1. Create Promotional Ad
const createPromotionToDB = async (
  payload: Partial<IPromotionalZone>,
  userId: string
): Promise<IPromotionalZone> => {
  // If no endDate provided, default to 30 days from now
  if (!payload.endDate) {
    const thirtyDaysAhead = new Date();
    thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);
    payload.endDate = thirtyDaysAhead;
  }

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    payload.userId = new Types.ObjectId(userId);
  }

  if (!payload.status) {
    payload.status = 'approved';
  }

  const result = await PromotionalZone.create(payload);
  return result;
};

// 2. Get All Promotional Ads (Public / Mobile App / Admin)
const getAllPromotionsFromDB = async (
  query: Record<string, any>,
  isAdmin = false
) => {
  const baseFilter: Record<string, any> = {};

  // For mobile app viewers: only show approved & non-expired promotions
  if (!isAdmin) {
    baseFilter.status = 'approved';
    baseFilter.endDate = { $gte: new Date() };
  } else if (query.status && query.status !== 'all') {
    baseFilter.status = query.status;
  }

  // Featured filter
  if (query.isFeatured !== undefined) {
    baseFilter.isFeatured = query.isFeatured === 'true' || query.isFeatured === true;
  }

  const queryBuilder = new QueryBuilder(
    PromotionalZone.find(baseFilter).populate(
      'userId',
      'firstName lastName name email image role phone'
    ),
    query
  );

  queryBuilder
    .search(['title', 'description', 'websiteUrl'])
    .filter();

  // Intelligent Ad Delivery & Rotation Algorithm for Mobile App
  if (!isAdmin && !query.sort) {
    // 1. Featured ads always pinned first
    // 2. Least-viewed ads first (viewsCount: 1) -> ensures ads in the back rise to the top
    // 3. Newest ads: createdAt: -1
    queryBuilder.modelQuery.sort({ isFeatured: -1, viewsCount: 1, createdAt: -1 });
  } else {
    queryBuilder.sort();
  }

  queryBuilder.paginate().fields();

  const data = await queryBuilder.modelQuery.exec();
  const meta = await queryBuilder.getPaginationInfo();

  // If public mobile app requests and ads are delivered,
  // automatically record impressions (increment viewsCount by 1 for delivered ads)
  // so the algorithm continuously rotates and balances exposure across all ads
  if (!isAdmin && data && data.length > 0 && query.trackImpressions !== 'false') {
    const deliveredIds = data.map((item: any) => item._id);
    PromotionalZone.updateMany(
      { _id: { $in: deliveredIds } },
      { $inc: { viewsCount: 1 } }
    ).exec();
  }

  return {
    meta,
    data,
  };
};

// 3. Get Single Promotion Detail
const getSinglePromotionFromDB = async (
  id: string,
  incrementView = true
): Promise<IPromotionalZone> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const query = PromotionalZone.findById(id).populate(
    'userId',
    'firstName lastName name email image role phone'
  );

  const promotion = await query.exec();

  if (!promotion) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional ad not found');
  }

  if (incrementView) {
    await PromotionalZone.findByIdAndUpdate(id, { $inc: { viewsCount: 1 } });
    promotion.viewsCount += 1;
  }

  return promotion;
};

// 4. Update Promotional Ad
const updatePromotionInDB = async (
  id: string,
  payload: Partial<IPromotionalZone>
): Promise<IPromotionalZone | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const existing = await PromotionalZone.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional ad not found');
  }

  const updated = await PromotionalZone.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  }).populate('userId', 'firstName lastName name email image role phone');

  return updated;
};

// 5. Delete Promotional Ad
const deletePromotionFromDB = async (id: string): Promise<IPromotionalZone | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const existing = await PromotionalZone.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional ad not found');
  }

  const deleted = await PromotionalZone.findByIdAndDelete(id);
  return deleted;
};

// 6. Update Promotion Status (Admin only)
const updatePromotionStatusInDB = async (
  id: string,
  status: TPromotionStatus,
  rejectionReason?: string
): Promise<IPromotionalZone | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const updateData: Partial<IPromotionalZone> = { status };
  if (rejectionReason) {
    updateData.rejectionReason = rejectionReason;
  }

  const updated = await PromotionalZone.findByIdAndUpdate(id, updateData, { new: true });
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional ad not found');
  }

  return updated;
};

// 7. Toggle Featured Status (Admin only)
const toggleFeaturePromotionInDB = async (id: string): Promise<IPromotionalZone | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const existing = await PromotionalZone.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional ad not found');
  }

  existing.isFeatured = !existing.isFeatured;
  await existing.save();

  return existing;
};

// 8. Track Ad Click (Increment clicksCount by 1)
const trackPromotionClickInDB = async (id: string): Promise<IPromotionalZone | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const result = await PromotionalZone.findByIdAndUpdate(
    id,
    { $inc: { clicksCount: 1 } },
    { new: true }
  );

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional ad not found');
  }

  return result;
};

export const PromotionalZoneService = {
  createPromotionToDB,
  getAllPromotionsFromDB,
  getSinglePromotionFromDB,
  updatePromotionInDB,
  deletePromotionFromDB,
  updatePromotionStatusInDB,
  toggleFeaturePromotionInDB,
  trackPromotionClickInDB,
};
