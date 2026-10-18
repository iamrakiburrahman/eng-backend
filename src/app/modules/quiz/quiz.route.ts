import express from 'express';
import { ROLE_GROUPS } from '../../../enums/user';
import auth from '../../middlewares/auth';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';
import { QuizController } from './quiz.controller';

const router = express.Router();

// 1. PUBLIC & CLIENT ENDPOINTS
// Get active quizzes (supports optional category & league filter)
router.get('/active', QuizController.getActiveQuizzes);

// Get leaderboard of top scorers for a quiz
router.get('/:id/leaderboard', QuizController.getQuizLeaderboard);

// 2. AUTHENTICATED USER ENDPOINTS
// Submit answers for a quiz
router.post(
  '/:id/submit',
  auth(...ROLE_GROUPS.All),
  QuizController.submitQuizAttempt
);

// Get user's own quiz attempts
router.get(
  '/my-attempts',
  auth(...ROLE_GROUPS.All),
  QuizController.getMyQuizAttempts
);

// 3. ADMIN MANAGEMENT ENDPOINTS
router
  .route('/')
  .post(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    QuizController.createQuiz
  )
  .get(auth(...ROLE_GROUPS.ADMINS), QuizController.getAllQuizzes);

router.patch(
  '/:id/status',
  auth(...ROLE_GROUPS.ADMINS),
  QuizController.toggleQuizStatus
);

router
  .route('/:id')
  .get(QuizController.getSingleQuiz)
  .patch(
    auth(...ROLE_GROUPS.ADMINS),
    fileUploadHandler(),
    QuizController.updateQuiz
  )
  .delete(auth(...ROLE_GROUPS.ADMINS), QuizController.deleteQuiz);

export const QuizRoutes = router;
export default router;
