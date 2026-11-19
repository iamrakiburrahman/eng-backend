import express from 'express';
import { ROLE_GROUPS } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { trackingLimiter } from '../../middlewares/rateLimiter';
import { BookAScoutController } from './bookAScout.controller';

const router = express.Router();

// 1. PUBLIC / MOBILE APP ENDPOINTS
router.get('/active', auth(false), BookAScoutController.getActiveBookAScout);
router.post('/:id/view', trackingLimiter, auth(false), BookAScoutController.recordBookAScoutView);
router.post('/:id/click', trackingLimiter, auth(false), BookAScoutController.recordBookAScoutClick);

// 2. ADMIN MANAGEMENT ENDPOINTS
router
  .route('/')
  .post(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    BookAScoutController.createBookAScout
  )
  .get(auth(...ROLE_GROUPS.ADMINS), BookAScoutController.getAllBookAScout);

router.patch(
  '/:id/status',
  auth(...ROLE_GROUPS.ADMINS),
  BookAScoutController.toggleBookAScoutStatus
);

router.patch(
  '/:id/feature',
  auth(...ROLE_GROUPS.ADMINS),
  BookAScoutController.toggleBookAScoutFeatured
);

router
  .route('/:id')
  .get(BookAScoutController.getSingleBookAScout)
  .patch(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    BookAScoutController.updateBookAScout
  )
  .delete(auth(...ROLE_GROUPS.ADMINS), BookAScoutController.deleteBookAScout);

export const BookAScoutRoutes = router;
export default router;

