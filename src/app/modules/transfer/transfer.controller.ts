import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { TransferService } from './transfer.service';

const createTransfer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await TransferService.createTransferToDB(
    req.body,
    user._id
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Transfer request created',
    data: result,
  });
});

const getAllTransfers = catchAsync(async (req: Request, res: Response) => {
  const result = await TransferService.getAllTransfersFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'All transfers retrieved',
    data: result,
  });
});

const getMyTransfers = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await TransferService.getMyTransfersFromDB(user._id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'My transfers retrieved',
    data: result,
  });
});

const getSingleTransfer = catchAsync(async (req: Request, res: Response) => {
  const result = await TransferService.getSingleTransferFromDB(
    req.params.id as string,
    req.user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Transfer retrieved',
    data: result,
  });
});

const approveTransfer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await TransferService.approveTransferToDB(
    req.params.id as string,
    user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Transfer approved successfully',
    data: result,
  });
});

const rejectTransfer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const reason = req.body?.reason || "No reason provided";

  const result = await TransferService.rejectTransferToDB(
    req.params.id as string,
    reason,
    user._id,
    user.role
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Transfer rejected',
    data: result,
  });
});

const withdrawTransfer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await TransferService.withdrawTransferToDB(
    req.params.id as string,
    user._id
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Transfer withdrawn',
    data: result,
  });
});

const getAvailablePlayers = catchAsync(async (req: Request, res: Response) => {
    if (!req.user) {
        throw new Error("User not authenticated");
    }
  const managerId = req.user._id as string; // from auth middleware

  const result = await TransferService.getAvailablePlayersFromDB(managerId);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Available players retrieved",
    data: result,
  });
});



const getManagerTransferRequests = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;

    const result =
      await TransferService.getManagerTransferRequestsFromDB(
        user._id,
        req.query
      );

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Manager transfer requests retrieved',
      data: result,
    });
  }
);

const getTransferOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await TransferService.getTransferOverviewFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Transfer overview statistics retrieved successfully',
    data: result,
  });
});

export const TransferController = {
  createTransfer,
  getAllTransfers,
  getMyTransfers,
  getSingleTransfer,
  approveTransfer,
  rejectTransfer,
  withdrawTransfer,
  getAvailablePlayers,
  getManagerTransferRequests,
  getTransferOverview,
};