import express from 'express';
import { USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { SponsorshipController } from './sponsorship.controller';

const router = express.Router();

// 1. PUBLIC & MOBILE APP SHOWCASE
// Returns active sponsors & partners grouped by tier and type with placement filters
router.get('/showcase', SponsorshipController.getShowcaseSponsorships);

// 2. PUBLIC CLICK TRACKING (Tapping sponsor/partner in Mobile App or Web)
router.post('/:id/click', SponsorshipController.recordSponsorshipClick);

// 3. ADMIN ANALYTICS & REORDERING
router.get(
  '/analytics',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  SponsorshipController.getSponsorshipAnalytics
);

router.patch(
  '/reorder',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  SponsorshipController.rearrangeSponsorshipOrder
);

// 4. ADMIN TOGGLE STATUS
router.patch(
  '/:id/toggle-status',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  SponsorshipController.toggleSponsorshipStatus
);

// 5. BASE CRUD ROUTES
router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    SponsorshipController.createSponsorship
  )
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    SponsorshipController.getAllSponsorshipsForAdmin
  );

router
  .route('/:id')
  .get(SponsorshipController.getSingleSponsorship)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    SponsorshipController.updateSponsorship
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    SponsorshipController.deleteSponsorship
  );

export const SponsorshipRoutes = router;
export default router;
