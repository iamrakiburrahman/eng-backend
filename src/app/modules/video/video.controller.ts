import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import { VideoService } from './video.service';
import { uploadToS3 } from '../../../helpers/uploadToS3';

// CREATE
const createVideo = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const files = req.files as {
    image?: Express.Multer.File[];
    video?: Express.Multer.File[];
  };

  const thumbnail = files?.image?.[0];
  const videoFile = files?.video?.[0];

  const data = req.body?.data ? JSON.parse(req.body.data) : req.body || {};

  const payload: any = { ...data };

  // Thumbnail Upload (still local)
  if (thumbnail) {
    payload.thumbnail = thumbnail.path
      .replace(/\\/g, '/')
      .split('uploads')[1];
  }

  // Direct Video Upload (if uploaded via form-data 'video' field)
  if (videoFile) {
    const videoS3Url = await uploadToS3(videoFile, 'videos');
    payload.videoUrl = videoS3Url;
    payload._localVideoPath = videoFile.path;
  }

  // Publish Logic
  if (payload.status === 'publish') {
    payload.publishDateTime = new Date();
  } else {
    payload.publishDateTime = null;
  }

  const result = await VideoService.createVideoToDB(payload, user._id);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Video created successfully',
    data: result,
  });
});

// GET ALL
const getAllVideos = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const { result, meta } = await VideoService.getAllVideosFromDB(
    user.role,
    req.query
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Videos retrieved successfully',
    data: result,
    pagination: meta,
  });
});

// SINGLE
const getSingleVideo = catchAsync(async (req: Request, res: Response) => {
  const result = await VideoService.getSingleVideoFromDB(req.params.id as string);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Video retrieved successfully',
    data: result,
  });
});

// UPDATE
const updateVideo = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const files = req.files as {
    image?: Express.Multer.File[];
    video?: Express.Multer.File[];
  };

  const thumbnail = files?.image?.[0];
  const videoFile = files?.video?.[0];

  const data = req.body?.data ? JSON.parse(req.body.data) : req.body || {};

  const payload: any = { ...data };

  // Thumbnail Upload (still local)
  if (thumbnail) {
    payload.thumbnail = thumbnail.path
      .replace(/\\/g, "/")
      .split("uploads")[1];
  }

  // Direct Video Upload (if uploaded via form-data 'video' field)
  if (videoFile) {
    const videoS3Url = await uploadToS3(videoFile, 'videos');
    payload.videoUrl = videoS3Url;
    payload._localVideoPath = videoFile.path;
  }

  // Publish Logic
  if (payload.status === "publish") {
    payload.publishDateTime = new Date();
  } else if (payload.status === "draft") {
    payload.publishDateTime = null;
  }


  const result = await VideoService.updateVideoToDB(
    req.params.id as string,
    user._id,
    payload
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Video updated successfully",
    data: result,
  });
});

// DELETE
const deleteVideo = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await VideoService.deleteVideoFromDB(
    req.params.id as string,
    user._id as string,
    user.role as string
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Video deleted successfully',
    data: result,
  });
});

// TOGGLE
const toggleVideoStatus = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  const result = await VideoService.toggleVideoStatusToDB(
    req.params.id as string,
    user
  );

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Video status toggled successfully',
    data: result,
  });
});


const getPublicVideos = catchAsync(async (req: Request, res: Response) => {
  const { result, meta } = await VideoService.getPublicVideosFromDB(req.query);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Public videos retrieved successfully',
    data: result,
    pagination: meta,
  });
});

// GET PRE-SIGNED URL
const getPresignedUrl = catchAsync(async (req: Request, res: Response) => {
  const { fileName, contentType } = req.query;

  if (!fileName || !contentType) {
    return sendResponse(res, {
      success: false,
      statusCode: 400,
      message: 'fileName and contentType are required',
      data: null,
    });
  }

  const result = await VideoService.generatePresignedUrl(
    fileName as string,
    contentType as string
  );

  sendResponse(res, {
    success: true,
    statusCode: 200,
    message: 'Pre-signed URL generated successfully',
    data: result,
  });
});

const retryTranscode = catchAsync(async (req: Request, res: Response) => {
  const result = await VideoService.retryTranscodeToDB(req.params.id as string);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Transcoding retry initiated in background',
    data: result,
  });
});

const rearrangeVideos = catchAsync(async (req: Request, res: Response) => {
  const result = await VideoService.rearrangeVideosInDB(req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Videos order rearranged successfully',
    data: result,
  });
});

const getVideoAnalytics = catchAsync(async (req: Request, res: Response) => {
  const result = await VideoService.getVideoAnalyticsFromDB();

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'Video analytics retrieved successfully',
    data: result,
  });
});

export const VideoController = {
  createVideo,
  getAllVideos,
  getSingleVideo,
  updateVideo,
  deleteVideo,
  toggleVideoStatus,
  getPublicVideos,
  getPresignedUrl,
  retryTranscode,
  rearrangeVideos,
  getVideoAnalytics,
};