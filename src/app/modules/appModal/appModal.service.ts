import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { IAppModal } from './appModal.interface';
import { AppModal } from './appModal.model';

const parsePayload = (payload: any): any => {
  const data = { ...payload };

  if (data.priority !== undefined) {
    data.priority = Number(data.priority) || 0;
  }
  if (data.startDate) {
    data.startDate = new Date(data.startDate);
  }
  if (data.endDate) {
    data.endDate = new Date(data.endDate);
  } else if (data.endDate === '' || data.endDate === 'null' || data.endDate === null) {
    data.endDate = null;
  }

  return data;
};

const createAppModalInDB = async (payload: Partial<IAppModal>): Promise<IAppModal> => {
  const data = parsePayload(payload);

  if (!data.title || !data.image) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Title and Image banner are required.');
  }

  const appModal = await AppModal.create(data);
  return appModal;
};

const getAllAppModalsFromDB = async (
  query: Record<string, unknown>
): Promise<{ data: IAppModal[]; total: number; page: number; limit: number; totalPages: number }> => {
  const page = Math.max(1, Number(query.page || query.pageNumber) || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  const skip = (page - 1) * limit;

  const filter: Record<string, any> = {};

  if (query.status && query.status !== 'all') {
    filter.status = query.status;
  }

  if (query.actionType && query.actionType !== 'all') {
    filter.actionType = query.actionType;
  }

  if (query.searchTerm || query.searchValue) {
    const searchVal = String(query.searchTerm || query.searchValue);
    const regex = new RegExp(searchVal, 'i');
    filter.$or = [{ title: regex }, { subtitle: regex }, { description: regex }, { screenName: regex }];
  }

  const [modals, total] = await Promise.all([
    AppModal.find(filter)
      .sort({ priority: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AppModal.countDocuments(filter),
  ]);

  return {
    data: modals as unknown as IAppModal[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
};

const getSingleAppModalFromDB = async (id: string): Promise<IAppModal> => {
  const modal = await AppModal.findById(id).lean();
  if (!modal) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'App modal popup not found.');
  }
  return modal as unknown as IAppModal;
};

/**
 * Endpoint queried by the mobile app upon startup.
 * Returns the latest / highest-priority active popup ready to display.
 */
const getActiveAppModalForClientFromDB = async (): Promise<{
  active: IAppModal | null;
  all: IAppModal[];
}> => {
  const now = new Date();

  const filter: Record<string, any> = {
    status: 'active',
    $and: [
      {
        $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }],
      },
      {
        $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: now } }],
      },
    ],
  };

  const activeModals = await AppModal.find(filter)
    .sort({ priority: -1, createdAt: -1 })
    .lean();

  return {
    active: activeModals.length > 0 ? (activeModals[0] as unknown as IAppModal) : null,
    all: activeModals as unknown as IAppModal[],
  };
};

const updateAppModalInDB = async (id: string, payload: Partial<IAppModal>): Promise<IAppModal> => {
  const data = parsePayload(payload);
  const updated = await AppModal.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'App modal popup not found.');
  }
  return updated;
};

const toggleAppModalStatusInDB = async (id: string, status?: string): Promise<IAppModal> => {
  const existing = await AppModal.findById(id);
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'App modal popup not found.');
  }

  const nextStatus = status || (existing.status === 'active' ? 'inactive' : 'active');
  existing.status = nextStatus as any;
  await existing.save();
  return existing;
};

const deleteAppModalInDB = async (id: string): Promise<IAppModal> => {
  const deleted = await AppModal.findByIdAndDelete(id);
  if (!deleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'App modal popup not found.');
  }
  return deleted;
};

const recordModalViewInDB = async (id: string): Promise<void> => {
  await AppModal.findByIdAndUpdate(id, { $inc: { viewsCount: 1 } });
};

const recordModalClickInDB = async (id: string): Promise<void> => {
  await AppModal.findByIdAndUpdate(id, { $inc: { clicksCount: 1 } });
};

export const AppModalService = {
  createAppModalInDB,
  getAllAppModalsFromDB,
  getSingleAppModalFromDB,
  getActiveAppModalForClientFromDB,
  updateAppModalInDB,
  toggleAppModalStatusInDB,
  deleteAppModalInDB,
  recordModalViewInDB,
  recordModalClickInDB,
};

