import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { LiveTransferMarketService } from './liveTransferMarket.service';

const joinMarket = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.joinMarketToDB(
    user._id || user.id,
    user.role,
    req.body
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Successfully joined Live Transfer Market',
    data: result,
  });
});

const leaveMarket = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.leaveMarketToDB(
    user._id || user.id,
    user.role,
    req.body?.playerId
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result,
  });
});

const getMyListing = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const playerId = (req.query.playerId as string) || undefined;
  const result = await LiveTransferMarketService.getMyListingFromDB(
    user._id || user.id,
    user.role,
    playerId
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Live market listing status retrieved',
    data: result,
  });
});

const getLiveMarketPlayers = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.getLiveMarketPlayersFromDB(
    req.query,
    user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Live transfer market players retrieved',
    data: result,
  });
});

const requestLiveTransfer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.requestLiveTransferToDB(
    user._id || user.id,
    req.body
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.CREATED,
    message: 'Live transfer request submitted successfully',
    data: result,
  });
});

const respondByPlayer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.respondByPlayerToDB(
    req.params.id as string,
    user._id || user.id,
    req.body
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result.transfer,
  });
});

const respondByManager = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.respondByManagerToDB(
    req.params.id as string,
    user._id || user.id,
    req.body
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result.transfer,
  });
});

const getMyOffers = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const playerId = (req.query.playerId as string) || undefined;
  const result = await LiveTransferMarketService.getMyOffersFromDB(
    user._id || user.id,
    user.role,
    playerId
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'My transfer offers retrieved',
    data: result,
  });
});

const getSellingRequests = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.getSellingRequestsFromDB(
    user._id || user.id
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Selling transfer requests retrieved',
    data: result,
  });
});

const getBuyingRequests = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await LiveTransferMarketService.getBuyingRequestsFromDB(
    user._id || user.id
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Buying transfer requests retrieved',
    data: result,
  });
});

const getSingleLiveTransfer = catchAsync(async (req: Request, res: Response) => {
  const result = await LiveTransferMarketService.getSingleLiveTransferFromDB(
    req.params.id as string,
    req.user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Live transfer details retrieved',
    data: result,
  });
});

export const LiveTransferMarketController = {
  joinMarket,
  leaveMarket,
  getMyListing,
  getLiveMarketPlayers,
  requestLiveTransfer,
  respondByPlayer,
  respondByManager,
  getMyOffers,
  getSellingRequests,
  getBuyingRequests,
  getSingleLiveTransfer,
};
