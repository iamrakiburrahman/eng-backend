import express from 'express';
import { ROLE_GROUPS, USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { authLimiter } from '../../middlewares/rateLimiter';
import { RewardProductController } from './rewardProduct.controller';


const router = express.Router();

// REDEEM COFFEE REWARD (All Authenticated Users / Players / Parents)
router
  .route('/redeem-coffee')
  .post(
    authLimiter,
    auth(...ROLE_GROUPS.All),
    RewardProductController.redeemCoffeeReward
  );

// CREATE + GET ALL
router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    RewardProductController.createRewardProduct
  )
  .get(RewardProductController.getAllRewardProducts);

// OVERVIEW / SUMMARY ANALYTICS (DEDICATED API)
router
  .route('/overview')
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    RewardProductController.getRewardProductsOverview
  );

// SINGLE + UPDATE + DELETE
router
  .route('/:id')
  .get(RewardProductController.getSingleRewardProduct)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    RewardProductController.updateRewardProduct
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    RewardProductController.deleteRewardProduct
  );

// TOGGLE STATUS
router
  .route('/:id/toggle-status')
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    RewardProductController.toggleRewardProductStatus
  );

// GET QR CODE (ONLY Coffee)
router
  .route('/:id/qr-code')
  .get(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    RewardProductController.getRewardProductQrCode
  );

export default router;