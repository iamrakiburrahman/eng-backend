import express from 'express';
import { ROLE_GROUPS } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { AppModalController } from './appModal.controller';

const router = express.Router();

// 1. PUBLIC & CLIENT MOBILE ENDPOINTS
// Client mobile app calls upon app open / startup
router.get('/active', AppModalController.getActiveAppModal);

// Analytics
router.post('/:id/view', AppModalController.recordModalView);
router.post('/:id/click', AppModalController.recordModalClick);

// 2. ADMIN MANAGEMENT ENDPOINTS
router
  .route('/')
  .post(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    AppModalController.createAppModal
  )
  .get(auth(...ROLE_GROUPS.ADMINS), AppModalController.getAllAppModals);

router.patch(
  '/:id/status',
  auth(...ROLE_GROUPS.ADMINS),
  AppModalController.toggleAppModalStatus
);

router
  .route('/:id')
  .get(AppModalController.getSingleAppModal)
  .patch(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    AppModalController.updateAppModal
  )
  .delete(auth(...ROLE_GROUPS.ADMINS), AppModalController.deleteAppModal);

export const AppModalRoutes = router;
export default router;

