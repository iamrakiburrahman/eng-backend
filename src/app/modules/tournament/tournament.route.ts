import express from 'express';
import { ROLE_GROUPS, USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import { authLimiter } from '../../middlewares/rateLimiter';
import { TournamentController } from './tournament.controller';

const router = express.Router();

// REDEEM PRIZE COINS BY SCANNING QR CODE (PLAYER / AUTH USER)
router.post(
  '/redeem-reward',
  authLimiter,
  auth(...ROLE_GROUPS.All),
  TournamentController.redeemTournamentReward
);

router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    TournamentController.createTournament
  )
  .get(TournamentController.getAllTournaments);

router.get('/analytics', TournamentController.getTournamentAnalytics);

// GET QR CODE PAYLOAD FOR TOURNAMENT (ADMIN / MANAGER)
router.get(
  '/:id/qr-code',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MANAGER),
  TournamentController.getTournamentQrCode
);

router
  .route('/:id')
  .get(TournamentController.getSingleTournament)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    TournamentController.updateTournament
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    TournamentController.deleteTournament
  );

export default router;
