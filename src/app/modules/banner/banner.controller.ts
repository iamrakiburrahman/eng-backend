import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import { BannerService } from "./banner.service";
import sendResponse from "../../../shared/sendResponse";
import { StatusCodes } from "http-status-codes";

const createBanner = catchAsync(async (req: Request, res: Response) => {
  const bannerData = req.body;
  let image = "";

  if (req.files && "image" in req.files && req.files.image[0]) {
    image = `/images/${req.files.image[0].filename}`;
  } else if (req.files && "banner" in req.files && req.files.banner[0]) {
    image = `/images/${req.files.banner[0].filename}`;
  } else if (bannerData.image) {
    image = bannerData.image;
  }

  const title = bannerData.title || bannerData.name;

  const data = {
    ...bannerData,
    title,
    name: title,
    image,
    priority: bannerData.priority ? Number(bannerData.priority) : 0,
  };

  const result = await BannerService.createBannerToDB(data);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: "Banner created successfully",
    data: result,
  });
});

const getAllBanner = catchAsync(async (req: Request, res: Response) => {
  const query = req.query;
  const result = await BannerService.getAllBannerFromDB(query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banners retrieved successfully",
    data: result.data,
    pagination: result.meta,
  });
});

const getSingleBanner = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await BannerService.getSingleBannerFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner retrieved successfully",
    data: result,
  });
});

const updateBanner = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const updateData = req.body;

  let image: string | undefined = undefined;
  if (req.files && "image" in req.files && req.files.image[0]) {
    image = `/images/${req.files.image[0].filename}`;
  } else if (req.files && "banner" in req.files && req.files.banner[0]) {
    image = `/images/${req.files.banner[0].filename}`;
  } else if (updateData.image) {
    image = updateData.image;
  }

  const payload: any = { ...updateData };
  if (image) {
    payload.image = image;
  }
  if (payload.title && !payload.name) {
    payload.name = payload.title;
  }
  if (payload.priority !== undefined) {
    payload.priority = Number(payload.priority);
  }

  const result = await BannerService.updateBannerToDB(id, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner updated successfully",
    data: result,
  });
});

const deleteBanner = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await BannerService.deleteBannerToDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: "Banner deleted successfully",
    data: result,
  });
});

const toggleStatus = catchAsync(async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { status } = req.body;
  const result = await BannerService.toggleStatusToDB(id, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Banner status updated to ${result.status}`,
    data: result,
  });
});

export const BannerController = {
  createBanner,
  getAllBanner,
  getSingleBanner,
  updateBanner,
  deleteBanner,
  toggleStatus,
};
