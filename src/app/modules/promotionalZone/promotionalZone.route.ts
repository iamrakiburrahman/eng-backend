import express from 'express';
import { ROLE_GROUPS } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { PromotionalZoneController } from './promotionalZone.controller';

const router = express.Router();

// 1. PUBLIC / MOBILE APP ENDPOINTS
// List active promotions (supports pagination, ?isFeatured=true)
router.get('/', auth(false), PromotionalZoneController.getAllPromotions);

// Single promotion detail (public)
router.get('/:id', auth(false), PromotionalZoneController.getSinglePromotion);

// Track ad click (public - when user taps the banner in mobile app)
router.post('/:id/click', auth(false), PromotionalZoneController.trackPromotionClick);

// 2. ADMIN ENDPOINTS
// Admin view all promotions (including pending / rejected / expired)
router.get(
  '/admin/all',
  auth(...ROLE_GROUPS.ADMINS),
  PromotionalZoneController.getAllPromotionsForAdmin
);

// Create new promotional ad banner
router.post(
  '/',
  auth(...ROLE_GROUPS.ADMINS),
  fileUploadHandler(),
  PromotionalZoneController.createPromotion
);

// Update promotional ad
router.patch(
  '/:id',
  auth(...ROLE_GROUPS.ADMINS),
  fileUploadHandler(),
  PromotionalZoneController.updatePromotion
);

// Delete promotional ad
router.delete(
  '/:id',
  auth(...ROLE_GROUPS.ADMINS),
  PromotionalZoneController.deletePromotion
);

// Approve / Reject / Expire / Pause ad
router.patch(
  '/:id/status',
  auth(...ROLE_GROUPS.ADMINS),
  PromotionalZoneController.updatePromotionStatus
);

// Toggle Featured pin on home/top banner
router.patch(
  '/:id/feature',
  auth(...ROLE_GROUPS.ADMINS),
  PromotionalZoneController.toggleFeaturePromotion
);

export const PromotionalZoneRoutes = router;
export default router;
