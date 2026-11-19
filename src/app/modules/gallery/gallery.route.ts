import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { GalleryController } from './gallery.controller';

const router = express.Router();

router.get(
  '/overview',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  GalleryController.getGalleryOverview
);

router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    GalleryController.createGallery
  )
  .get(GalleryController.getAllGalleries);

router
  .route('/:id')
  .get(GalleryController.getSingleGallery)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    GalleryController.updateGallery
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    GalleryController.deleteGallery
  );

export default router;
