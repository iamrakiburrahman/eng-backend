import express from 'express';
import { ROLE_GROUPS } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { PromotionalZoneController } from './promotionalZone.controller';

const router = express.Router();

// 1. PUBLIC / EXPLORER ENDPOINTS
// List active promotions (supports ?type=COACH_SESSION|TEAM_SHOWCASE&city=...&ageGroup=...&isFeatured=true)
router.get('/', auth(false), PromotionalZoneController.getAllPromotions);

// Admin view all promotions (including pending / rejected / expired)
router.get(
  '/admin/all',
  auth(...ROLE_GROUPS.ADMINS),
  PromotionalZoneController.getAllPromotionsForAdmin
);

// My created promotions (Coaches / Managers / Admins)
router.get(
  '/my-promotions',
  auth(...ROLE_GROUPS.All),
  PromotionalZoneController.getMyPromotions
);

// Single promotion detail (public)
router.get('/:id', auth(false), PromotionalZoneController.getSinglePromotion);

// 2. CREATION & MODIFICATION FLOW
// Create new promotional post (with banner / image upload)
router.post(
  '/',
  auth(...ROLE_GROUPS.All),
  fileUploadHandler(),
  PromotionalZoneController.createPromotion
);

// Update promotional post
router.patch(
  '/:id',
  auth(...ROLE_GROUPS.All),
  fileUploadHandler(),
  PromotionalZoneController.updatePromotion
);

// Delete promotional post
router.delete(
  '/:id',
  auth(...ROLE_GROUPS.All),
  PromotionalZoneController.deletePromotion
);

// 3. ADMIN STATUS & FEATURE TOGGLES
// Approve / Reject / Expire promotion
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

// 4. INQUIRIES & LEAD MANAGEMENT
// Submit inquiry / registration application for a training session or trial
router.post(
  '/:id/inquiry',
  auth(false),
  PromotionalZoneController.submitInquiry
);

// View inquiries for a promotion (Coach / Manager / Admin)
router.get(
  '/:id/inquiries',
  auth(...ROLE_GROUPS.All),
  PromotionalZoneController.getPromotionInquiries
);

// Update status of an inquiry (e.g. pending -> contacted -> enrolled)
router.patch(
  '/inquiries/:inquiryId/status',
  auth(...ROLE_GROUPS.All),
  PromotionalZoneController.updateInquiryStatus
);

export const PromotionalZoneRoutes = router;
export default router;
