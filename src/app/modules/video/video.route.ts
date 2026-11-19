import express from 'express';
import auth from '../../middlewares/auth';
import { USER_ROLES } from '../../../enums/user';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { VideoController } from './video.controller';

const router = express.Router();

// CREATE + GET ALL
router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    VideoController.createVideo
  )
  .get(auth(),VideoController.getAllVideos);
  router.route('/public').get(VideoController.getPublicVideos);

// PRE-SIGNED URL FOR S3 UPLOAD
router.route('/presigned-url').get(
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  VideoController.getPresignedUrl
);

// REARRANGE VIDEOS
router.route('/rearrange').patch(
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  VideoController.rearrangeVideos
);

// VIDEO ANALYTICS
router
  .route('/analytics')
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    VideoController.getVideoAnalytics
  );

// SINGLE + UPDATE + DELETE
router
  .route('/:id')
  .get( VideoController.getSingleVideo)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    VideoController.updateVideo
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    VideoController.deleteVideo
  );

// TOGGLE STATUS
router
  .route('/:id/toggle-status')
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    VideoController.toggleVideoStatus
  );

// RETRY TRANSCODE
router
  .route('/:id/retry-transcode')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    VideoController.retryTranscode
  );

export default router;