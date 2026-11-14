import { StatusCodes } from 'http-status-codes';
import mongoose, { Types } from 'mongoose';
import ApiError from '../../../errors/ApiErrors';
import { IBookAScout, TBookAScoutStatus } from './bookAScout.interface';
import { BookAScout } from './bookAScout.model';

const ALLOWED_STATUSES: TBookAScoutStatus[] = ['active', 'inactive', 'archived'];

const normalizePayload = (
  payload: Partial<IBookAScout> & Record<string, unknown>,
  isUpdate = false
): Record<string, unknown> => {
  const data: Record<string, unknown> = { ...payload };

  const stripIfBlankFields = ['sectionTitle', 'title', 'redirectUrl', 'status', 'image', 'startDate'];
  for (const field of stripIfBlankFields) {
    const val = data[field];
    if (
      val === undefined ||
      val === null ||
      (typeof val === 'string' && val.trim() === '')
    ) {
      if (isUpdate || field === 'status' || field === 'startDate' || field === 'sectionTitle') {
        delete data[field];
      }
    }
  }

  if (data.badgeText !== undefined && typeof data.badgeText === 'string') {
    const trimmed = data.badgeText.trim();
    if (!trimmed && !isUpdate) {
      data.badgeText = 'Professional scouting';
    } else {
      data.badgeText = trimmed;
    }
  }

  if (data.buttonText !== undefined && typeof data.buttonText === 'string') {
    const trimmed = data.buttonText.trim();
    if (!trimmed) {
      if (isUpdate) {
        delete data.buttonText;
      } else {
        data.buttonText = 'Book Now';
      }
    } else {
      data.buttonText = trimmed;
    }
  }

  if (data.priority !== undefined && data.priority !== '') {
    const parsedPriority = Number(data.priority);
    data.priority = Number.isFinite(parsedPriority) ? parsedPriority : 0;
  } else if (data.priority === '') {
    delete data.priority;
  }

  if (data.isFeatured !== undefined) {
    data.isFeatured = data.isFeatured === true || data.isFeatured === 'true';
  }

  if (data.startDate) {
    const parsedStart = new Date(String(data.startDate));
    if (Number.isNaN(parsedStart.getTime())) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid startDate.');
    }
    data.startDate = parsedStart;
  }

  if (data.endDate === '' || data.endDate === 'null' || data.endDate === null) {
    data.endDate = null;
  } else if (data.endDate) {
    const parsedEnd = new Date(String(data.endDate));
    if (Number.isNaN(parsedEnd.getTime())) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid endDate.');
    }
    data.endDate = parsedEnd;
  }

  // Prevent overwriting analytics counters or owner through general update
  delete data.viewsCount;
  delete data.clicksCount;
  delete data.createdBy;
  delete data._id;

  return data;
};

const createBookAScoutInDB = async (
  payload: Partial<IBookAScout> & Record<string, unknown>,
  userId?: string
): Promise<IBookAScout> => {
  const data = normalizePayload(payload, false);

  if (!data.title || !data.image || !data.redirectUrl) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'Title, Redirect URL, and Image are required.'
    );
  }

  if (data.startDate && data.endDate) {
    if (new Date(data.startDate as Date) >= new Date(data.endDate as Date)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'startDate must be before endDate.');
    }
  }

  if (userId && mongoose.Types.ObjectId.isValid(userId)) {
    data.createdBy = new Types.ObjectId(userId);
  }

  const created = await BookAScout.create(data);
  return created;
};

const getAllBookAScoutFromDB = async (
  query: Record<string, unknown>
): Promise<{
  data: IBookAScout[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const page = Math.max(1, Number(query.page || query.pageNumber) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};

  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }

  if (query.isFeatured !== undefined && query.isFeatured !== 'all') {
    filter.isFeatured = query.isFeatured === true || query.isFeatured === 'true';
  }

  if (query.searchTerm || query.searchValue) {
    const searchVal = String(query.searchTerm || query.searchValue).trim();
    if (searchVal) {
      const regex = new RegExp(searchVal, 'i');
      filter.$or = [
        { sectionTitle: regex },
        { badgeText: regex },
        { title: regex },
        { description: regex },
        { redirectUrl: regex },
        { buttonText: regex },
      ];
    }
  }

  const [items, total] = await Promise.all([
    BookAScout.find(filter)
      .sort({ isFeatured: -1, priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    BookAScout.countDocuments(filter),
  ]);

  return {
    data: items as unknown as IBookAScout[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

const getActiveBookAScoutForClientFromDB = async (): Promise<{
  active: IBookAScout | null;
  all: IBookAScout[];
}> => {
  const now = new Date();

  const filter: Record<string, unknown> = {
    status: 'active',
    $and: [
      {
        $or: [
          { startDate: { $exists: false } },
          { startDate: null },
          { startDate: { $lte: now } },
        ],
      },
      {
        $or: [
          { endDate: { $exists: false } },
          { endDate: null },
          { endDate: { $gte: now } },
        ],
      },
    ],
  };

  const activeItems = await BookAScout.find(filter)
    .sort({ isFeatured: -1, priority: -1, createdAt: -1 })
    .lean();

  return {
    active: activeItems.length > 0 ? (activeItems[0] as unknown as IBookAScout) : null,
    all: activeItems as unknown as IBookAScout[],
  };
};

const getSingleBookAScoutFromDB = async (id: string): Promise<IBookAScout> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Book A Scout ID.');
  }
  const item = await BookAScout.findById(id).lean();
  if (!item) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Book A Scout section not found.');
  }
  return item as unknown as IBookAScout;
};

const updateBookAScoutInDB = async (
  id: string,
  payload: Partial<IBookAScout> & Record<string, unknown>
): Promise<IBookAScout> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Book A Scout ID.');
  }

  const existing = await BookAScout.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Book A Scout section not found.');
  }

  const updateData = normalizePayload(payload, true);

  const effectiveStart = (updateData.startDate as Date | undefined) ?? existing.startDate;
  const effectiveEnd =
    updateData.endDate !== undefined
      ? (updateData.endDate as Date | null)
      : existing.endDate;

  if (effectiveStart && effectiveEnd) {
    if (new Date(effectiveStart) >= new Date(effectiveEnd)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, 'startDate must be before endDate.');
    }
  }

  const updated = await BookAScout.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Book A Scout section not found.');
  }

  return updated;
};

const toggleBookAScoutStatusInDB = async (
  id: string,
  status?: string
): Promise<IBookAScout> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Book A Scout ID.');
  }

  const existing = await BookAScout.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Book A Scout section not found.');
  }

  const nextStatus: TBookAScoutStatus =
    status && ALLOWED_STATUSES.includes(status as TBookAScoutStatus)
      ? (status as TBookAScoutStatus)
      : existing.status === 'active'
      ? 'inactive'
      : 'active';

  existing.status = nextStatus;
  await existing.save();
  return existing;
};

const toggleBookAScoutFeaturedInDB = async (id: string): Promise<IBookAScout> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Book A Scout ID.');
  }

  const existing = await BookAScout.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Book A Scout section not found.');
  }

  existing.isFeatured = !existing.isFeatured;
  await existing.save();
  return existing;
};

const deleteBookAScoutFromDB = async (id: string): Promise<IBookAScout> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid Book A Scout ID.');
  }

  const deleted = await BookAScout.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Book A Scout section not found.');
  }
  return deleted;
};

const recordViewInDB = async (id: string): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(id)) return;
  await BookAScout.findByIdAndUpdate(id, { $inc: { viewsCount: 1 } });
};

const recordClickInDB = async (id: string): Promise<void> => {
  if (!mongoose.Types.ObjectId.isValid(id)) return;
  await BookAScout.findByIdAndUpdate(id, { $inc: { clicksCount: 1 } });
};

export const BookAScoutService = {
  createBookAScoutInDB,
  getAllBookAScoutFromDB,
  getActiveBookAScoutForClientFromDB,
  getSingleBookAScoutFromDB,
  updateBookAScoutInDB,
  toggleBookAScoutStatusInDB,
  toggleBookAScoutFeaturedInDB,
  deleteBookAScoutFromDB,
  recordViewInDB,
  recordClickInDB,
};

