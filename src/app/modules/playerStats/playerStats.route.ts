import express from 'express';
import auth from '../../middlewares/auth';
import { ROLE_GROUPS } from '../../../enums/user';
import { PlayerStatsController } from './playerStats.controller';

const router = express.Router();

// GET ALL (LEADERBOARD)
router.route('/').get(auth(false), PlayerStatsController.getAllPlayerStats);

// GET SINGLE PLAYER STATS
router.route('/:playerId').get(auth(false), PlayerStatsController.getSinglePlayerStats);

// ADMIN UPDATE
router.route('/:playerId').patch(auth(...ROLE_GROUPS.All), PlayerStatsController.updatePlayerStats);

export default router;