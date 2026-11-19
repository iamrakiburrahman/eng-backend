import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { IBanner } from "./banner.interface";
import { Banner } from "./banner.model";
import unlinkFile from "../../../shared/unlinkFile";
import mongoose from "mongoose";

const createBannerToDB = async (payload: Partial<IBanner>): Promise<IBanner> => {
  if (!payload.title && payload.name) {
    payload.title = payload.name;
  }
  if (!payload.name && payload.title) {
    payload.name = payload.title;
  }

  const createBanner = await Banner.create(payload);
  if (!createBanner) {
    if (payload.image) {
      unlinkFile(payload.image);
    }
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to create banner");
  }

  return createBanner;
};

const getAllBannerFromDB = async (
  query: Record<string, any> = {}
): Promise<{
  data: IBanner[];
  meta: { page: number; limit: number; total: number; totalPage: number };
}> => {
  const {
    searchTerm,
    section,
    status,
    page = 1,
    limit = 20,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const conditions: any = {};

  if (searchTerm) {
    conditions.$or = [
      { title: { $regex: searchTerm, $options: "i" } },
      { name: { $regex: searchTerm, $options: "i" } },
      { section: { $regex: searchTerm, $options: "i" } },
      { subtitle: { $regex: searchTerm, $options: "i" } },
    ];
  }

  if (section && section !== "all") {
    conditions.section = { $regex: section, $options: "i" };
  }

  if (status && status !== "all") {
    conditions.status = status;
  }

  const pageNum = Math.max(1, Number(page) || 1);
  const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
  const skip = (pageNum - 1) * limitNum;

  const sortConditions: any = {};
  if (sortBy) {
    sortConditions[sortBy] = sortOrder === "asc" ? 1 : -1;
  } else {
    sortConditions.priority = -1;
    sortConditions.createdAt = -1;
  }

  const [data, total] = await Promise.all([
    Banner.find(conditions).sort(sortConditions).skip(skip).limit(limitNum),
    Banner.countDocuments(conditions),
  ]);

  const totalPage = Math.ceil(total / limitNum) || 1;

  return {
    data,
    meta: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPage,
    },
  };
};

const getSingleBannerFromDB = async (id: string): Promise<IBanner> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid Banner ID");
  }

  const banner = await Banner.findById(id);
  if (!banner) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Banner not found");
  }

  return banner;
};

const updateBannerToDB = async (
  id: string,
  payload: Partial<IBanner>
): Promise<IBanner> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid Banner ID");
  }

  const isBannerExist = await Banner.findById(id);
  if (!isBannerExist) {
    if (payload.image) {
      unlinkFile(payload.image);
    }
    throw new ApiError(StatusCodes.NOT_FOUND, "Banner not found");
  }

  if (payload.image && isBannerExist.image) {
    unlinkFile(isBannerExist.image);
  }

  if (payload.title && !payload.name) {
    payload.name = payload.title;
  }

  const updatedBanner = await Banner.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });

  if (!updatedBanner) {
    throw new ApiError(StatusCodes.INTERNAL_SERVER_ERROR, "Failed to update banner");
  }

  return updatedBanner;
};

const deleteBannerToDB = async (id: string): Promise<IBanner | null> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid Banner ID");
  }

  const isBannerExist = await Banner.findById(id);
  if (!isBannerExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Banner not found");
  }

  if (isBannerExist.image) {
    unlinkFile(isBannerExist.image);
  }

  const deleted = await Banner.findByIdAndDelete(id);
  return deleted;
};

const toggleStatusToDB = async (
  id: string,
  targetStatus?: "active" | "inactive"
): Promise<IBanner> => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid Banner ID");
  }

  const banner = await Banner.findById(id);
  if (!banner) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Banner not found");
  }

  const nextStatus = targetStatus
    ? targetStatus
    : banner.status === "active"
    ? "inactive"
    : "active";

  banner.status = nextStatus;
  await banner.save();

  return banner;
};

export const BannerService = {
  createBannerToDB,
  getAllBannerFromDB,
  getSingleBannerFromDB,
  updateBannerToDB,
  deleteBannerToDB,
  toggleStatusToDB,
};
