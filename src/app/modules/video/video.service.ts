import { StatusCodes } from 'http-status-codes';
import ApiError from '../../../errors/ApiErrors';
import { IVideo } from './video.interface';
import { Types } from 'mongoose';
import { Video } from './video.model';
import QueryBuilder from "../../../util/queryBuilder";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, AWS_S3_BUCKET, getFileUrl, deleteFileFromS3, deleteFolderFromS3 } from "../../../config/aws";
import { transcodeVideoToHLS } from "../../../helpers/transcodeVideo";
import { EngTvCategory } from '../engTvCategory/engTvCategory.model';
// CREATE
const createVideoToDB = async (payload: any, userId: string) => {
  const localVideoPath = payload._localVideoPath;
  delete payload._localVideoPath;

  const result = await Video.create({
    ...payload,
    createdBy: userId,
  });

  // Trigger background FFmpeg HLS transcoding
  const sourceVideo = localVideoPath || result.videoUrl;
  if (sourceVideo) {
    transcodeVideoToHLS(result._id.toString(), sourceVideo).catch((err) => {
      console.error('[FFmpeg Background Job Error]:', err);
    });
  }

  return (await result.populate('category')).populate('subCategory');
};



const resolveCategoryQuery = async (query: Record<string, any>) => {
  const categoryValue = query.categoryName || query.category || query.categoryname;
  if (categoryValue) {
    if (Types.ObjectId.isValid(categoryValue)) {
      query.category = new Types.ObjectId(categoryValue);
    } else {
      const categoryDoc = await EngTvCategory.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${categoryValue.trim()}$`, 'i') } },
          { slug: categoryValue.trim().toLowerCase() },
          { name: { $regex: categoryValue.trim(), $options: 'i' } },
        ],
      });
      query.category = categoryDoc ? categoryDoc._id : new Types.ObjectId();
    }
    delete query.categoryName;
    delete query.categoryname;
  }

  const subCategoryValue =
    query.subCategoryName ||
    query.subCategory ||
    query.subcategory ||
    query.subcategoryName;
  if (subCategoryValue) {
    if (Types.ObjectId.isValid(subCategoryValue)) {
      query.subCategory = new Types.ObjectId(subCategoryValue);
    } else {
      const subCategoryDoc = await EngTvCategory.findOne({
        $or: [
          { name: { $regex: new RegExp(`^${subCategoryValue.trim()}$`, 'i') } },
          { slug: subCategoryValue.trim().toLowerCase() },
          { name: { $regex: subCategoryValue.trim(), $options: 'i' } },
        ],
      });
      query.subCategory = subCategoryDoc ? subCategoryDoc._id : new Types.ObjectId();
    }
    delete query.subCategoryName;
    delete query.subcategory;
    delete query.subcategoryName;
  }
};

// GET ALL
const getAllVideosFromDB = async (
  role: string,
  query: Record<string, any>
) => {
  await resolveCategoryQuery(query);

  const now = new Date();

  let baseQuery = {};

  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    baseQuery = {
      $or: [
        { status: 'publish' },
        { status: 'schedule', publishDateTime: { $lte: now } },
      ],
    };
  }

  // Custom sort to ensure highlights are at the top, sorted by custom order
  const originalSort = query.sort;
  query.sort = originalSort ? `-isHighlight order ${originalSort}` : '-isHighlight order -createdAt';

  const videoQuery = new QueryBuilder(Video.find(baseQuery), query)
    .search(['title', 'description'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await videoQuery.modelQuery
    .populate('category')
    .populate('subCategory');
  const meta = await videoQuery.getPaginationInfo();

  return {
    meta,
    result,
  };
};

// SINGLE
const getSingleVideoFromDB = async (id: string) => {
  const video = await Video.findById(id)
    .populate('category')
    .populate('subCategory');

  if (!video) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Video not found');
  }

  return video;
};

// UPDATE
const updateVideoToDB = async (
  id: string,
  userId: string,
  payload: any
) => {
  const video = await Video.findById(id);

  if (!video) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Video not found");
  }

  if (video.createdBy?.toString() !== userId.toString()) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Not allowed");
  }

  const localVideoPath = payload._localVideoPath;
  delete payload._localVideoPath;

  const updatedVideo = await Video.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  })
    .populate('category')
    .populate('subCategory');

  const sourceVideo = localVideoPath || (payload.videoUrl && payload.videoUrl !== video.videoUrl ? payload.videoUrl : null);
  if (sourceVideo) {
    transcodeVideoToHLS(id, sourceVideo).catch((err) => {
      console.error('[FFmpeg Background Job Error]:', err);
    });
  }

  return updatedVideo;
};

// DELETE
const deleteVideoFromDB = async (id: string, userId: string, role?: string) => {
  const video = await Video.findById(id);

  if (!video) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Video not found');
  }

  if (
    role !== 'ADMIN' &&
    role !== 'SUPER_ADMIN' &&
    video.createdBy?.toString() !== userId.toString()
  ) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Not allowed');
  }

  // Delete raw S3 Video file
  if (video.videoUrl) {
    await deleteFileFromS3(video.videoUrl);
  }

  // Delete S3 Thumbnail (if stored on S3)
  if (video.thumbnail && (video.thumbnail.startsWith('http://') || video.thumbnail.startsWith('https://'))) {
    await deleteFileFromS3(video.thumbnail);
  }

  // Delete all S3 HLS segments and playlist files under videos/hls/${id}/
  await deleteFolderFromS3(`videos/hls/${id}/`);

  return await Video.findByIdAndDelete(id);
};

// TOGGLE
const toggleVideoStatusToDB = async (id: string, user: any) => {
  const video = await Video.findById(id);

  if (!video) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Video not found');
  }

  if (
    user.role !== 'ADMIN' &&
    user.role !== 'SUPER_ADMIN' &&
    video.createdBy?.toString() !== user._id.toString()
  ) {
    throw new ApiError(StatusCodes.FORBIDDEN, 'Not allowed');
  }

  video.status = video.status === 'publish' ? 'draft' : 'publish';

  return await video.save();
};

const getPublicVideosFromDB = async (query: Record<string, any>) => {
  await resolveCategoryQuery(query);

  const now = new Date();

  const baseQuery = {
    $or: [
      { status: 'publish' },
      { status: 'schedule', publishDateTime: { $lte: now } },
    ],
  };

  // Custom sort to ensure highlights are at the top, sorted by custom order
  const originalSort = query.sort;
  query.sort = originalSort ? `-isHighlight order ${originalSort}` : '-isHighlight order -createdAt';

  const videoQuery = new QueryBuilder(Video.find(baseQuery), query)
    .search(['title', 'description'])
    .filter()
    .sort()
    .paginate()
    .fields();

  const result = await videoQuery.modelQuery
    .populate('category')
    .populate('subCategory');
  const meta = await videoQuery.getPaginationInfo();

  return {
    meta,
    result,
  };
};

// GENERATE PRE-SIGNED URL FOR S3 UPLOAD
const generatePresignedUrl = async (fileName: string, contentType: string) => {
  const key = `videos/${Date.now()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: AWS_S3_BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 }); // 10 minutes

  const videoUrl = getFileUrl(key);

  return { uploadUrl, videoUrl, key };
};

const retryTranscodeToDB = async (id: string) => {
  const video = await Video.findById(id);
  if (!video) {
    throw new ApiError(StatusCodes.NOT_FOUND, 'Video not found');
  }

  transcodeVideoToHLS(video._id.toString(), video.videoUrl).catch((err) => {
    console.error('[FFmpeg Retry Error]:', err);
  });

  return video;
};

const rearrangeVideosInDB = async (payload: {
  videos: { id: string; order: number; isHighlight?: boolean }[];
}) => {
  if (!Array.isArray(payload?.videos)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, 'Invalid payload: videos array is required');
  }

  const bulkOps = payload.videos.map((vid) => {
    const updateData: any = { order: vid.order };
    if (vid.isHighlight !== undefined) {
      updateData.isHighlight = vid.isHighlight;
    }

    return {
      updateOne: {
        filter: { _id: new Types.ObjectId(vid.id) },
        update: { $set: updateData },
      },
    };
  });

  const result = await Video.bulkWrite(bulkOps);
  return result;
};

const getVideoAnalyticsFromDB = async () => {
  const [total, published, highlights, drafts] = await Promise.all([
    Video.countDocuments(),
    Video.countDocuments({ status: 'publish' }),
    Video.countDocuments({ isHighlight: true }),
    Video.countDocuments({ status: 'draft' }),
  ]);

  return {
    total,
    published,
    highlights,
    drafts,
  };
};

export const VideoService = {
  createVideoToDB,
  getAllVideosFromDB,
  getSingleVideoFromDB,
  updateVideoToDB,
  deleteVideoFromDB,
  toggleVideoStatusToDB,
  getPublicVideosFromDB,
  generatePresignedUrl,
  retryTranscodeToDB,
  rearrangeVideosInDB,
  getVideoAnalyticsFromDB,
};