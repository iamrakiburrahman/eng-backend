import express from 'express';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { USER_ROLES } from '../../../enums/user';
import { LiveTransferMarketController } from './liveTransferMarket.controller';
import { LiveTransferMarketValidation } from './liveTransferMarket.validation';

const router = express.Router();

// 1. Join Live Transfer Market (Player / Parent / Admin)
router.post(
  '/join',
  auth(USER_ROLES.PLAYER, USER_ROLES.UNASSIGNED, USER_ROLES.OTHER_CLUBS, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  validateRequest(LiveTransferMarketValidation.joinMarketZodSchema),
  LiveTransferMarketController.joinMarket
);

// 2. Leave Live Transfer Market (Player / Parent / Admin)
router.post(
  '/leave',
  auth(USER_ROLES.PLAYER, USER_ROLES.UNASSIGNED, USER_ROLES.OTHER_CLUBS, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  LiveTransferMarketController.leaveMarket
);

// 3. Get My Listing Status (Player / Parent)
router.get(
  '/my-listing',
  auth(USER_ROLES.PLAYER, USER_ROLES.UNASSIGNED, USER_ROLES.OTHER_CLUBS, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  LiveTransferMarketController.getMyListing
);

// 4. Browse Active Players on Live Transfer Market (Manager / Admin / Super Admin / Player)
router.get(
  '/players',
  auth(USER_ROLES.MANAGER, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.PLAYER, USER_ROLES.OTHER_CLUBS),
  LiveTransferMarketController.getLiveMarketPlayers
);

// 5. Submit Transfer Bid for a Live Market Player (Buying Manager)
router.post(
  '/request',
  auth(USER_ROLES.MANAGER),
  validateRequest(LiveTransferMarketValidation.requestTransferZodSchema),
  LiveTransferMarketController.requestLiveTransfer
);

// 6. Player / Parent Consent Response (Accept / Reject)
router.patch(
  '/:id/player-respond',
  auth(USER_ROLES.PLAYER, USER_ROLES.UNASSIGNED, USER_ROLES.OTHER_CLUBS),
  validateRequest(LiveTransferMarketValidation.respondTransferZodSchema),
  LiveTransferMarketController.respondByPlayer
);

// 7. Current Club Manager Consent Response (Accept / Reject)
router.patch(
  '/:id/manager-respond',
  auth(USER_ROLES.MANAGER),
  validateRequest(LiveTransferMarketValidation.respondTransferZodSchema),
  LiveTransferMarketController.respondByManager
);

// 8. Offers Received by Player
router.get(
  '/my-offers',
  auth(USER_ROLES.PLAYER, USER_ROLES.UNASSIGNED, USER_ROLES.OTHER_CLUBS),
  LiveTransferMarketController.getMyOffers
);

// 9. Bids Received for Current Club's Players (Selling Manager)
router.get(
  '/selling-requests',
  auth(USER_ROLES.MANAGER),
  LiveTransferMarketController.getSellingRequests
);

// 10. Bids Sent by Manager's Club (Buying Manager)
router.get(
  '/buying-requests',
  auth(USER_ROLES.MANAGER),
  LiveTransferMarketController.getBuyingRequests
);

// 11. Single Live Transfer Details
router.get(
  '/:id',
  auth(),
  LiveTransferMarketController.getSingleLiveTransfer
);

export const LiveTransferMarketRoutes = router;
