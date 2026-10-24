import { StatusCodes } from 'http-status-codes';
import mongoose, { Types } from 'mongoose';
import ApiError from '../../../errors/ApiErrors';
import QueryBuilder from '../../../util/queryBuilder';
import {
  IPromotionalInquiry,
  IPromotionalZone,
  TInquiryStatus,
  TPromotionStatus,
} from './promotionalZone.interface';
import { PromotionalInquiry, PromotionalZone } from './promotionalZone.model';

// 1. Create Promotional Post
const createPromotionToDB = async (
  payload: Partial<IPromotionalZone>,
  userId: string,
  userRole: string
): Promise<IPromotionalZone> => {
  // If no endDate provided, default to 30 days from now
  if (!payload.endDate) {
    const thirtyDaysAhead = new Date();
    thirtyDaysAhead.setDate(thirtyDaysAhead.getDate() + 30);
    payload.endDate = thirtyDaysAhead;
  }

  payload.userId = new Types.ObjectId(userId);
  payload.creatorRole = userRole;

  // Auto-approve if created by admin or verified role, else default to 'approved' or 'pending'
  if (!payload.status) {
    payload.status = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' ? 'approved' : 'approved';
  }

  const result = await PromotionalZone.create(payload);
  return result;
};

// 2. Get All Promotional Posts (Public / Client / App / Admin)
const getAllPromotionsFromDB = async (
  query: Record<string, any>,
  isAdmin = false
) => {
  const baseFilter: Record<string, any> = {};

  // For public / non-admin viewers: only show approved & non-expired promotions
  if (!isAdmin) {
    baseFilter.status = 'approved';
    baseFilter.endDate = { $gte: new Date() };
  } else if (query.status && query.status !== 'all') {
    baseFilter.status = query.status;
  }

  // Type filter: COACH_SESSION vs TEAM_SHOWCASE
  if (query.type && query.type !== 'all') {
    baseFilter.type = query.type;
  }

  // City filter
  if (query.city && query.city !== 'all') {
    baseFilter.city = { $regex: query.city, $options: 'i' };
  }

  // Age group filter
  if (query.ageGroup && query.ageGroup !== 'all') {
    baseFilter.ageGroups = { $in: [query.ageGroup] };
  }

  // Featured filter
  if (query.isFeatured !== undefined) {
    baseFilter.isFeatured = query.isFeatured === 'true' || query.isFeatured === true;
  }

  const queryBuilder = new QueryBuilder(
    PromotionalZone.find(baseFilter)
      .populate('userId', 'firstName lastName name email image role phone')
      .populate('teamId', 'teamName teamLogo shortName ageGroup'),
    query
  );

  queryBuilder
    .search(['title', 'description', 'city', 'venue'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const data = await queryBuilder.modelQuery.exec();
  const meta = await queryBuilder.getPaginationInfo();

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

  const query = PromotionalZone.findById(id)
    .populate('userId', 'firstName lastName name email image role phone')
    .populate('teamId', 'teamName teamLogo shortName ageGroup stadiumName city');

  const promotion = await query.exec();

  if (!promotion) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional post not found');
  }

  if (incrementView) {
    await PromotionalZone.findByIdAndUpdate(id, { $inc: { viewsCount: 1 } });
    promotion.viewsCount += 1;
  }

  return promotion;
};

// 4. Update Promotional Post
const updatePromotionInDB = async (
  id: string,
  payload: Partial<IPromotionalZone>,
  requestingUserId: string,
  userRole: string
): Promise<IPromotionalZone | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const existing = await PromotionalZone.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional post not found');
  }

  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
  if (!isAdmin && existing.userId.toString() !== requestingUserId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You are not authorized to edit this promotion');
  }

  // Prevent regular users from toggling isFeatured directly without admin approval
  if (!isAdmin && payload.isFeatured !== undefined) {
    delete payload.isFeatured;
  }

  const updated = await PromotionalZone.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  })
    .populate('userId', 'firstName lastName name email image role phone')
    .populate('teamId', 'teamName teamLogo shortName ageGroup');

  return updated;
};

// 5. Delete Promotional Post
const deletePromotionFromDB = async (
  id: string,
  requestingUserId: string,
  userRole: string
): Promise<IPromotionalZone | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const existing = await PromotionalZone.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional post not found');
  }

  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
  if (!isAdmin && existing.userId.toString() !== requestingUserId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You are not authorized to delete this promotion');
  }

  const deleted = await PromotionalZone.findByIdAndDelete(id);

  // Delete all associated inquiries
  await PromotionalInquiry.deleteMany({ promotionId: id });

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
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional post not found');
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
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotional post not found');
  }

  existing.isFeatured = !existing.isFeatured;
  await existing.save();

  return existing;
};

// 8. Get My Created Promotions (Coach / Manager / Admin)
const getMyPromotionsFromDB = async (userId: string, query: Record<string, any>) => {
  const baseFilter = { userId: new Types.ObjectId(userId) };

  const queryBuilder = new QueryBuilder(
    PromotionalZone.find(baseFilter).populate('teamId', 'teamName teamLogo shortName'),
    query
  );

  queryBuilder.search(['title', 'description', 'city']).filter().sort().paginate().fields();

  const data = await queryBuilder.modelQuery.exec();
  const meta = await queryBuilder.getPaginationInfo();

  return {
    meta,
    data,
  };
};

// 9. Submit Inquiry / Application (Player / Parent / Fan)
const createInquiryToDB = async (
  promotionId: string,
  payload: Partial<IPromotionalInquiry>,
  userId?: string
): Promise<IPromotionalInquiry> => {
  if (!mongoose.Types.ObjectId.isValid(promotionId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const promotion = await PromotionalZone.findById(promotionId);
  if (!promotion) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotion not found');
  }

  if (promotion.status !== 'approved' || new Date(promotion.endDate) < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'This promotion is no longer accepting inquiries');
  }

  payload.promotionId = new Types.ObjectId(promotionId);
  if (userId) {
    payload.userId = new Types.ObjectId(userId);
  }

  const inquiry = await PromotionalInquiry.create(payload);

  // Increment inquiriesCount on promotional post
  await PromotionalZone.findByIdAndUpdate(promotionId, { $inc: { inquiriesCount: 1 } });

  return inquiry;
};

// 10. Get Inquiries for a Promotion
const getInquiriesByPromotionIdFromDB = async (
  promotionId: string,
  query: Record<string, any>,
  requestingUserId: string,
  userRole: string
) => {
  if (!mongoose.Types.ObjectId.isValid(promotionId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid promotion ID format');
  }

  const promotion = await PromotionalZone.findById(promotionId);
  if (!promotion) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Promotion not found');
  }

  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';
  if (!isAdmin && promotion.userId.toString() !== requestingUserId) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You can only view inquiries for your own promotions');
  }

  const queryBuilder = new QueryBuilder(
    PromotionalInquiry.find({ promotionId: new Types.ObjectId(promotionId) }).populate(
      'userId',
      'firstName lastName name email image phone'
    ),
    query
  );

  queryBuilder.search(['applicantName', 'phone', 'email', 'notes']).filter().sort().paginate();

  const data = await queryBuilder.modelQuery.exec();
  const meta = await queryBuilder.getPaginationInfo();

  return {
    meta,
    data,
  };
};

// 11. Update Inquiry Status
const updateInquiryStatusInDB = async (
  inquiryId: string,
  status: TInquiryStatus,
  requestingUserId: string,
  userRole: string
): Promise<IPromotionalInquiry | null> => {
  if (!mongoose.Types.ObjectId.isValid(inquiryId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid inquiry ID format');
  }

  const inquiry = await PromotionalInquiry.findById(inquiryId);
  if (!inquiry) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Inquiry not found');
  }

  const promotion = await PromotionalZone.findById(inquiry.promotionId);
  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN';

  if (!isAdmin && (!promotion || promotion.userId.toString() !== requestingUserId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'You are not authorized to update this inquiry');
  }

  inquiry.status = status;
  await inquiry.save();

  return inquiry;
};

export const PromotionalZoneService = {
  createPromotionToDB,
  getAllPromotionsFromDB,
  getSinglePromotionFromDB,
  updatePromotionInDB,
  deletePromotionFromDB,
  updatePromotionStatusInDB,
  toggleFeaturePromotionInDB,
  getMyPromotionsFromDB,
  createInquiryToDB,
  getInquiriesByPromotionIdFromDB,
  updateInquiryStatusInDB,
};
