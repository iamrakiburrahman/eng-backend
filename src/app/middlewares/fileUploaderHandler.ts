import { Request } from 'express';
import fs from 'fs';
import { StatusCodes } from 'http-status-codes';
import multer, { FileFilterCallback } from 'multer';
import path from 'path';
import crypto from 'crypto';
import ApiError from '../../errors/ApiErrors';

const fileUploadHandler = (maxSizeInMB: number = 10) => {

  // base upload folder
  const baseUploadDir = path.join(process.cwd(), 'uploads');

  if (!fs.existsSync(baseUploadDir)) {
    fs.mkdirSync(baseUploadDir);
  }

  // create folder helper
  const createDir = (dirPath: string) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  };

  // storage config
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      let uploadDir;

      switch (file.fieldname) {
        case 'image':
        case 'profile':
        case 'profilePic':
        case 'banner':
        case 'logo':
          uploadDir = path.join(baseUploadDir, 'images');
          break;

        case 'document':
          uploadDir = path.join(baseUploadDir, 'documents');
          break;
        case 'video':
          uploadDir = path.join(baseUploadDir, 'videos');
          break;

        default:
          return cb(
            new ApiError(StatusCodes.BAD_REQUEST, 'File field not supported'),
            ''
          );
      }

      createDir(uploadDir);
      cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
      const fileExt = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const rawBaseName = path.basename(file.originalname, path.extname(file.originalname));
      const sanitizedBase =
        rawBaseName
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .toLowerCase()
          .slice(0, 50) || 'file';
      const randomSuffix = crypto.randomBytes(4).toString('hex');
      const fileName = `${sanitizedBase}-${Date.now()}-${randomSuffix}${fileExt}`;

      cb(null, fileName);
    },
  });

  // file filter
  const fileFilter = (req: Request, file: any, cb: FileFilterCallback) => {


    // IMAGE validation
    if (
      file.fieldname === 'image' ||
      file.fieldname === 'profile' ||
      file.fieldname === 'profilePic' ||
      file.fieldname === 'banner' ||
      file.fieldname === 'logo'
    ) {
      const allowedImageTypes = [
        'image/jpeg',
        'image/png',
        'image/jpg',
        'image/webp',
        'image/gif',
      ];
      if (allowedImageTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(
          new ApiError(
            StatusCodes.BAD_REQUEST,
            'Only image files allowed (JPEG, PNG, JPG, WEBP, GIF)'
          )
        );
      }
    }

    // DOCUMENT validation
    else if (file.fieldname === 'document' || file.fieldname === 'video') {
      // allow pdf, doc, docx, etc
        const allowed = [
          // images
      "image/jpeg",
      "image/png",
      "image/jpg",
          "image/webp",
          "video/mp4",
            "video/mpeg",
            "video/quicktime",
            "video/x-msvideo",
            "video/x-ms-wmv",
            // documents
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];

      if (allowed.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new ApiError(StatusCodes.BAD_REQUEST, 'Only PDF/DOC files allowed'));
      }
    }

    else {
      cb(new ApiError(StatusCodes.BAD_REQUEST, 'Unsupported file field'));
    }
  };

  const upload = multer({
    storage,
    fileFilter,
    limits: {
      fileSize: maxSizeInMB * 1024 * 1024, // Configurable limit, defaults to 10MB
    },
  }).fields([
    { name: 'image', maxCount: 3 },
    { name: 'banner', maxCount: 1 },
    { name: 'logo', maxCount: 1 },
    { name: 'profile', maxCount: 1 },
    { name: 'profilePic', maxCount: 1 },
    { name: 'document', maxCount: 2 },
    { name: 'video', maxCount: 1 },
  ]);

  return upload;
};

export default fileUploadHandler;