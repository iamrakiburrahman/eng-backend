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

// 1. Create Promotional Post
const createPromotion = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const files = req.files as {
    image?: Express.Multer.File[];
    banner?: Express.Multer.File[];
    gallery?: Express.Multer.File[];
  };

  const bodyData = parseBodyData(req);

  // Handle uploaded banner image
  if (files?.banner && files.banner.length > 0 && files.banner[0]) {
    bodyData.banner = `/images/${files.banner[0].filename}`;
  } else if (files?.image && files.image.length > 0 && files.image[0]) {
    bodyData.banner = `/images/${files.image[0].filename}`;
  }

  // Handle gallery files if any
  if (files?.gallery && files.gallery.length > 0) {
    bodyData.gallery = files.gallery.map((f) => `/images/${f.filename}`);
  }

  // Ensure ageGroups is array
  if (typeof bodyData.ageGroups === 'string') {
    try {
      bodyData.ageGroups = JSON.parse(bodyData.ageGroups);
    } catch {
      bodyData.ageGroups = [bodyData.ageGroups];
    }
  }

  // Ensure sessionDetails or teamDetails or contactInfo are parsed if string
  ['sessionDetails', 'teamDetails', 'contactInfo'].forEach((key) => {
    if (typeof bodyData[key] === 'string') {
      try {
        bodyData[key] = JSON.parse(bodyData[key]);
      } catch {
        // keep as is
      }
    }
  });

  const result = await PromotionalZoneService.createPromotionToDB(
    bodyData,
    user?.id || user?._id,
    user?.role || 'COACH'
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Promotional post created successfully',
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
    message: 'Promotional posts retrieved successfully',
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
    message: 'Admin promotional posts retrieved successfully',
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
    message: 'Promotion retrieved successfully',
    data: result,
  });
});

// 5. Update Promotion
const updatePromotion = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const user = req.user as any;
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

  ['ageGroups', 'sessionDetails', 'teamDetails', 'contactInfo'].forEach((key) => {
    if (typeof bodyData[key] === 'string') {
      try {
        bodyData[key] = JSON.parse(bodyData[key]);
      } catch {
        // keep as is
      }
    }
  });

  const result = await PromotionalZoneService.updatePromotionInDB(
    id,
    bodyData,
    user?.id || user?._id,
    user?.role || ''
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promotion updated successfully',
    data: result,
  });
});

// 6. Delete Promotion
const deletePromotion = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const user = req.user as any;

  const result = await PromotionalZoneService.deletePromotionFromDB(
    id,
    user?.id || user?._id,
    user?.role || ''
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Promotion deleted successfully',
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

// 9. Get My Created Promotions
const getMyPromotions = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await PromotionalZoneService.getMyPromotionsFromDB(
    user?.id || user?._id,
    req.query
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'My promotions retrieved successfully',
    pagination: result.meta,
    data: result.data,
  });
});

// 10. Submit Inquiry (Player / Parent)
const submitInquiry = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const user = req.user as any;

  const result = await PromotionalZoneService.createInquiryToDB(
    id,
    req.body,
    user?.id || user?._id
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Inquiry submitted successfully! The coach/team will contact you shortly.',
    data: result,
  });
});

// 11. Get Inquiries for a Promotion
const getPromotionInquiries = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const user = req.user as any;

  const result = await PromotionalZoneService.getInquiriesByPromotionIdFromDB(
    id,
    req.query,
    user?.id || user?._id,
    user?.role || ''
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Inquiries retrieved successfully',
    pagination: result.meta,
    data: result.data,
  });
});

// 12. Update Inquiry Status
const updateInquiryStatus = catchAsync(async (req: Request, res: Response) => {
  const inquiryId = req.params.inquiryId as string;
  const { status } = req.body;
  const user = req.user as any;

  const result = await PromotionalZoneService.updateInquiryStatusInDB(
    inquiryId,
    status,
    user?.id || user?._id,
    user?.role || ''
  );

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: `Inquiry status updated to ${status}`,
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
  getMyPromotions,
  submitInquiry,
  getPromotionInquiries,
  updateInquiryStatus,
};
