import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { PromotionalZoneService } from './promotionalZone.service';

const parseBodyData = (req: Request) => {
  let bodyData: any = {};
  if (req.body?.data) {
    try {
      bodyData = JSON.parse(req.body.data);
    } catch {
      bodyData = req.body;
    }
  } else {
    bodyData = req.body;
  }
  return bodyData;
};

// 1. Create Promotional Ad
const createPromotion = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const files = req.files as {
    image?: Express.Multer.File[];
    banner?: Express.Multer.File[];
  };

  const bodyData = parseBodyData(req);

  // Handle uploaded banner image
  if (files?.banner && files.banner.length > 0 && files.banner[0]) {
    bodyData.banner = `/images/${files.banner[0].filename}`;
  } else if (files?.image && files.image.length > 0 && files.image[0]) {
    bodyData.banner = `/images/${files.image[0].filename}`;
  }

  const result = await PromotionalZoneService.createPromotionToDB(
    bodyData,
    user?.id || user?._id
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Promotional ad created successfully',
    data: result,
  });
});

// 2. Get All Promotions (Public / Mobile App)
const getAllPromotions = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  const result = await PromotionalZoneService.getAllPromotionsFromDB(req.query, isAdmin);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promotional ads retrieved successfully',
    pagination: result.meta,
    data: result.data,
  });
});

// 3. Get All Promotions for Admin (includes pending, rejected, expired)
const getAllPromotionsForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await PromotionalZoneService.getAllPromotionsFromDB(req.query, true);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Admin promotional ads retrieved successfully',
    pagination: result.meta,
    data: result.data,
  });
});

// 4. Get Single Promotion
const getSinglePromotion = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const increment = req.query.view !== 'false';

  const result = await PromotionalZoneService.getSinglePromotionFromDB(id, increment);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promotional ad retrieved successfully',
    data: result,
  });
});

// 5. Update Promotion
const updatePromotion = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const files = req.files as {
    image?: Express.Multer.File[];
    banner?: Express.Multer.File[];
  };

  const bodyData = parseBodyData(req);

  if (files?.banner && files.banner.length > 0 && files.banner[0]) {
    bodyData.banner = `/images/${files.banner[0].filename}`;
  } else if (files?.image && files.image.length > 0 && files.image[0]) {
    bodyData.banner = `/images/${files.image[0].filename}`;
  }

  const result = await PromotionalZoneService.updatePromotionInDB(id, bodyData);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promotional ad updated successfully',
    data: result,
  });
});

// 6. Delete Promotion
const deletePromotion = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const result = await PromotionalZoneService.deletePromotionFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promotional ad deleted successfully',
    data: result,
  });
});

// 7. Update Promotion Status (Admin)
const updatePromotionStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status, rejectionReason } = req.body;

  const result = await PromotionalZoneService.updatePromotionStatusInDB(
    id,
    status,
    rejectionReason
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Promotion status updated to ${status}`,
    data: result,
  });
});

// 8. Toggle Feature Status (Admin)
const toggleFeaturePromotion = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const result = await PromotionalZoneService.toggleFeaturePromotionInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Promotion featured status set to ${result?.isFeatured ? 'Featured' : 'Standard'}`,
    data: result,
  });
});

// 9. Track Ad Click (Mobile App or Web tap)
const trackPromotionClick = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await PromotionalZoneService.trackPromotionClickInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promotion click recorded successfully',
    data: result,
  });
});

export const PromotionalZoneController = {
  createPromotion,
  getAllPromotions,
  getAllPromotionsForAdmin,
  getSinglePromotion,
  updatePromotion,
  deletePromotion,
  updatePromotionStatus,
  toggleFeaturePromotion,
  trackPromotionClick,
};
