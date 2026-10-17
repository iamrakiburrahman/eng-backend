import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { SponsorshipService } from './sponsorship.service';

const createSponsorship = catchAsync(async (req, res) => {
  const user = req.user as any;
  const files = req.files as { image?: Express.Multer.File[] };

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

  // Handle uploaded files: first file is logo, second file (if present) is banner
  if (files?.image && files.image.length > 0) {
    if (files.image[0]) {
      bodyData.logo = `/images/${files.image[0].filename}`;
    }
    if (files.image[1]) {
      bodyData.banner = `/images/${files.image[1].filename}`;
    }
  }

  // Support array parsing if placements passed as JSON string
  if (typeof bodyData.placements === 'string') {
    try {
      bodyData.placements = JSON.parse(bodyData.placements);
    } catch {
      bodyData.placements = bodyData.placements.split(',').map((p: string) => p.trim());
    }
  }

  const result = await SponsorshipService.createSponsorshipToDB(
    bodyData,
    user?._id || user?.id
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Sponsor / Partner created successfully',
    data: result,
  });
});

const getAllSponsorshipsForAdmin = catchAsync(async (req, res) => {
  const { result, meta } = await SponsorshipService.getAllSponsorshipsForAdminFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Sponsors and partners retrieved successfully for admin',
    pagination: meta,
    data: result,
  });
});

const getShowcaseSponsorships = catchAsync(async (req, res) => {
  const result = await SponsorshipService.getShowcaseSponsorshipsForClientFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Showcase sponsors and partners retrieved successfully',
    data: result,
  });
});

const getSingleSponsorship = catchAsync(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await SponsorshipService.getSingleSponsorshipFromDB(id, true);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Sponsorship details retrieved successfully',
    data: result,
  });
});

const updateSponsorship = catchAsync(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const files = req.files as { image?: Express.Multer.File[] };

  let bodyData: any = req.body;
  if (req.body?.data) {
    try {
      bodyData = JSON.parse(req.body.data);
    } catch {}
  }

  const payload: any = { ...bodyData };

  // Handle uploaded files for logo and banner
  if (files?.image && files.image.length > 0) {
    if (files.image[0]) {
      payload.logo = `/images/${files.image[0].filename}`;
    }
    if (files.image[1]) {
      payload.banner = `/images/${files.image[1].filename}`;
    }
  }

  if (typeof payload.placements === 'string') {
    try {
      payload.placements = JSON.parse(payload.placements);
    } catch {
      payload.placements = payload.placements.split(',').map((p: string) => p.trim());
    }
  }

  const result = await SponsorshipService.updateSponsorshipInDB(id, payload);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Sponsor / Partner updated successfully',
    data: result,
  });
});

const deleteSponsorship = catchAsync(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await SponsorshipService.deleteSponsorshipFromDB(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Sponsor / Partner deleted successfully',
    data: result,
  });
});

const toggleSponsorshipStatus = catchAsync(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await SponsorshipService.toggleSponsorshipStatusInDB(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: `Sponsor status changed to ${result?.status} successfully`,
    data: result,
  });
});

const recordSponsorshipClick = catchAsync(async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = await SponsorshipService.recordSponsorshipClickInDB(id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Sponsor click recorded successfully',
    data: result,
  });
});

const rearrangeSponsorshipOrder = catchAsync(async (req, res) => {
  const items = req.body.items || req.body;
  const result = await SponsorshipService.rearrangeSponsorshipOrderInDB(items);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Sponsorship sequence reordered successfully',
    data: result,
  });
});

const getSponsorshipAnalytics = catchAsync(async (req, res) => {
  const result = await SponsorshipService.getSponsorshipAnalyticsFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Sponsorship analytics retrieved successfully',
    data: result,
  });
});

export const SponsorshipController = {
  createSponsorship,
  getAllSponsorshipsForAdmin,
  getShowcaseSponsorships,
  getSingleSponsorship,
  updateSponsorship,
  deleteSponsorship,
  toggleSponsorshipStatus,
  recordSponsorshipClick,
  rearrangeSponsorshipOrder,
  getSponsorshipAnalytics,
};
