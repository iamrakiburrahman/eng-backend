import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { AppModalService } from './appModal.service';

const createAppModal = catchAsync(async (req: Request, res: Response) => {
  const payload = { ...req.body };
  const files = req.files as any;

  if (files) {
    if (files.image && files.image[0]) {
      payload.image = `/images/${files.image[0].filename}`;
    } else if (files.banner && files.banner[0]) {
      payload.image = `/images/${files.banner[0].filename}`;
    }
  }

  const result = await AppModalService.createAppModalInDB(payload);

  sendResponse(res, {
    statusCode: StatusCodes.CREATED,
    success: true,
    message: 'App popup modal created successfully',
    data: result,
  });
});

const getAllAppModals = catchAsync(async (req: Request, res: Response) => {
  const result = await AppModalService.getAllAppModalsFromDB(req.query);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'App popup modals retrieved successfully',
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPage: result.totalPages,
    },
    data: result.data,
  });
});

const getActiveAppModal = catchAsync(async (req: Request, res: Response) => {
  const returnAll = req.query.all === 'true';
  const result = await AppModalService.getActiveAppModalForClientFromDB();

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Active app popup retrieved successfully',
    data: returnAll ? (result.all as any) : result.active,
  });
});

const getSingleAppModal = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await AppModalService.getSingleAppModalFromDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'App popup modal details retrieved successfully',
    data: result,
  });
});

const updateAppModal = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const payload = { ...req.body };
  const files = req.files as any;

  if (files) {
    if (files.image && files.image[0]) {
      payload.image = `/images/${files.image[0].filename}`;
    } else if (files.banner && files.banner[0]) {
      payload.image = `/images/${files.banner[0].filename}`;
    }
  }

  const result = await AppModalService.updateAppModalInDB(id, payload);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'App popup modal updated successfully',
    data: result,
  });
});

const toggleAppModalStatus = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { status } = req.body;
  const result = await AppModalService.toggleAppModalStatusInDB(id, status);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'App popup status toggled successfully',
    data: result,
  });
});

const deleteAppModal = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const result = await AppModalService.deleteAppModalInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'App popup modal deleted successfully',
    data: result,
  });
});

const recordModalView = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await AppModalService.recordModalViewInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'View recorded',
    data: null,
  });
});

const recordModalClick = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await AppModalService.recordModalClickInDB(id);

  sendResponse(res, {
    statusCode: StatusCodes.OK,
    success: true,
    message: 'Click recorded',
    data: null,
  });
});

export const AppModalController = {
  createAppModal,
  getAllAppModals,
  getActiveAppModal,
  getSingleAppModal,
  updateAppModal,
  toggleAppModalStatus,
  deleteAppModal,
  recordModalView,
  recordModalClick,
};
