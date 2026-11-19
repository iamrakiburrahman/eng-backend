import express from 'express';
import auth from '../../middlewares/auth';
import { USER_ROLES } from '../../../enums/user';
import { EventController } from './event.controller';
import fileUploadHandler from '../../middlewares/fileUploaderHandler';

const router = express.Router();

// CREATE + GET ALL
router
  .route('/')
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    EventController.createEvent
  )
  .get(auth(), EventController.getAllEvents);

  router.get('/public-events', EventController.getPublicEvents);

// REARRANGE
router.patch(
  '/reorder',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  EventController.rearrangeEvents
);

// EVENT ANALYTICS
router.get(
  '/analytics',
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  EventController.getEventAnalytics
);

// SINGLE + UPDATE + DELETE
router
  .route('/:id')
  .get( EventController.getSingleEvent)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    EventController.updateEvent
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    EventController.deleteEvent
  );

export default router;