import express from 'express';
import { ROLE_GROUPS } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { ScorePredictionController } from './scorePrediction.controller';

const router = express.Router();

// 1. PUBLIC & CLIENT ENDPOINTS
// Get active prediction rounds in fixtures section
router.get('/active', ScorePredictionController.getActivePredictionRounds);

// Get leaderboard of predictors for a round
router.get('/:id/leaderboard', ScorePredictionController.getRoundLeaderboard);

// 2. AUTHENTICATED USER ENDPOINTS
// Submit score predictions for a round
router.post(
  '/:id/predict',
  auth(...ROLE_GROUPS.All),
  ScorePredictionController.submitUserPrediction
);

// Get user's own predictions history
router.get(
  '/my-predictions',
  auth(...ROLE_GROUPS.All),
  ScorePredictionController.getMyPredictions
);

// 3. ADMIN MANAGEMENT ENDPOINTS
router
  .route('/')
  .post(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    ScorePredictionController.createPredictionRound
  )
  .get(auth(...ROLE_GROUPS.ADMINS), ScorePredictionController.getAllPredictionRounds);

// Settle round and distribute coins to winners
router.post(
  '/:id/settle',
  auth(...ROLE_GROUPS.ADMINS),
  ScorePredictionController.settlePredictionRound
);

router
  .route('/:id')
  .get(ScorePredictionController.getSinglePredictionRound)
  .patch(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    ScorePredictionController.updatePredictionRound
  )
  .delete(auth(...ROLE_GROUPS.ADMINS), ScorePredictionController.deletePredictionRound);

export const ScorePredictionRoutes = router;
export default router;
