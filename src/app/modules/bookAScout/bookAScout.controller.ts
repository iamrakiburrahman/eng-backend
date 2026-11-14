import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { BookAScoutService } from './bookAScout.service';

const parseBodyData = (req: Request): Record<string, unknown> => {
  let bodyData: Record<string, unknown> = {};
  if (req.body?.data) {
    if (typeof req.body.data === 'string') {
      try {
        bodyData = JSON.parse(req.body.data);
      } catch {
        bodyData = { ...req.body };
      }
    } else if (typeof req.body.data === 'object') {
      bodyData = { ...req.body.data };
    }
  } else {
    bodyData = { ...req.body };
  }

  const files = req.files as {
    image?: Express.Multer.File[];
    banner?: Express.Multer.File[];
  } | undefined;

  if (files?.image?.[0]) {
    bodyData.image = `/images/${files.image[0].filename}`;
  } else if (files?.banner?.[0]) {
    bodyData.image = `/images/${files.banner[0].filename}`;
  }

  return bodyData;
};

const createBookAScout = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as { id?: string; _id?: string } | undefined;
  const payload = parseBodyData(req);

  const result = await BookAScoutService.createBookAScoutInDB(
    payload,
    user?.id || user?._id
  );

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'Book A Scout section created successfully',
    data: result,
  });
});

const getAllBookAScout = catchAsync(async (req: Request, res: Response) => {
  const result = await BookAScoutService.getAllBookAScoutFromDB(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Book A Scout sections retrieved successfully',
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPage: result.totalPages,
    },
    data: result.data,
  });
});

const getActiveBookAScout = catchAsync(async (req: Request, res: Response) => {
  const returnAll = req.query.all === 'true';
  const result = await BookAScoutService.getActiveBookAScoutForClientFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Active Book A Scout section retrieved successfully',
    data: returnAll ? (result.all as unknown as typeof result.active) : result.active,
  });
});

const getSingleBookAScout = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await BookAScoutService.getSingleBookAScoutFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Book A Scout section retrieved successfully',
    data: result,
  });
});

const updateBookAScout = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const payload = parseBodyData(req);

  const result = await BookAScoutService.updateBookAScoutInDB(id, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Book A Scout section updated successfully',
    data: result,
  });
});

const toggleBookAScoutStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status } = req.body;
  const result = await BookAScoutService.toggleBookAScoutStatusInDB(id, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Book A Scout status updated successfully',
    data: result,
  });
});

const toggleBookAScoutFeatured = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await BookAScoutService.toggleBookAScoutFeaturedInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Book A Scout featured status toggled successfully',
    data: result,
  });
});

const deleteBookAScout = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await BookAScoutService.deleteBookAScoutFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Book A Scout section deleted successfully',
    data: result,
  });
});

const recordBookAScoutView = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await BookAScoutService.recordViewInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'View tracked',
    data: null,
  });
});

const recordBookAScoutClick = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await BookAScoutService.recordClickInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Click tracked',
    data: null,
  });
});

export const BookAScoutController = {
  createBookAScout,
  getAllBookAScout,
  getActiveBookAScout,
  getSingleBookAScout,
  updateBookAScout,
  toggleBookAScoutStatus,
  toggleBookAScoutFeatured,
  deleteBookAScout,
  recordBookAScoutView,
  recordBookAScoutClick,
};

