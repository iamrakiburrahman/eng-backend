import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { NewsService } from './news.service';

// CREATE (TOKEN USER ID)
const createNews = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;



  const files = req.files as {
    image?: Express.Multer.File[];
  };

  const image = files?.image?.[0];



  const data = req.body?.data ? JSON.parse(req.body.data) : {};



  const payload: any = {
    ...data,
  };

  // remove user publish date input
  delete payload.publishDateTime;



  // image path clean
  if (image) {
    payload.image = image.path
      .replace(/\\/g, '/')
      .split('uploads')[1];
  }



  // Auto publish logic & schedule date handling
  if (payload.status === 'publish') {
    payload.publishDateTime = new Date();
  } else if (payload.status === 'schedule' && data.publishDateTime) {
    payload.publishDateTime = new Date(data.publishDateTime);
  } else {
    payload.publishDateTime = null;
  }



  const result = await NewsService.createNewsToDB(payload, user._id);



  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'News created successfully',
    data: result,
  });
});

// GET ALL (ROLE BASED)
const getAllNews = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await NewsService.getAllNewsFromDB(
    user?.role,
    req.query
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'News retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});


const getPublicNews = catchAsync(async (req: Request, res: Response) => {
  const result = await NewsService.getPublicNewsFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Published news retrieved successfully',
    pagination: result.meta,
    data: result.result,
  });
});
// MY NEWS (TOKEN BASED)
const getMyNews = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await NewsService.getMyNewsFromDB(user._id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'My news retrieved successfully',
    data: result,
  });
});


// GET SINGLE (NO PARAM ID VERSION -> optional, token based user flow if needed)
const getSingleNews = catchAsync(async (req: Request, res: Response) => {
    const result = await NewsService.getSingleNewsFromDB(req.params.id as string);
    
    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'News retrieved successfully',
        data: result,
    });
});

// UPDATE (NO OWNER PARAM)
const updateNews = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;

  const user = req.user as any;
  const userId = user._id;


  const files = req.files as {
    image?: Express.Multer.File[];
  };

  const image = files?.image?.[0];

  const data = req.body?.data ? JSON.parse(req.body.data) : {};

 

  const payload: any = {
    ...data,
  };

  if (image) {
    payload.image = image.path
      .replace(/\\/g, '/')
      .split('uploads')[1];
  }

  if (payload.status === 'publish') {
    payload.publishDateTime = new Date();
  } else if (payload.status === 'schedule' && data.publishDateTime) {
    payload.publishDateTime = new Date(data.publishDateTime);
  }

  const result = await NewsService.updateNewsToDB(
    id,
    user,
    payload
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'News updated successfully',
    data: result,
  });
});

// DELETE
const deleteNews = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await NewsService.deleteNewsFromDB(
    req.params.id as string,
    user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'News deleted successfully',
    data: result,
  });
});

// TOGGLE
const toggleNewsStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await NewsService.toggleNewsStatusToDB(req.params.id as string, user);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'News status toggled successfully',
    data: result,
  });
});

// REARRANGE NEWS
const rearrangeNews = catchAsync(async (req: Request, res: Response) => {
  const { news } = req.body as { news: { id: string; order: number }[] };
  const result = await NewsService.rearrangeNewsInDB(news);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'News articles reordered successfully',
    data: result,
  });
});

// GET NEWS ANALYTICS
const getNewsAnalytics = catchAsync(async (req: Request, res: Response) => {
  const result = await NewsService.getNewsAnalyticsFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'News analytics retrieved successfully',
    data: result,
  });
});

export const NewsController = {
  createNews,
  getAllNews,
  getMyNews,
  getSingleNews,
  updateNews,
  deleteNews,
  toggleNewsStatus,
  getPublicNews,
  rearrangeNews,
  getNewsAnalytics,
};