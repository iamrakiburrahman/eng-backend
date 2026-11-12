import express from "express";
import { ROLE_GROUPS, USER_ROLES } from "../../../enums/user";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
const router = express.Router();

router.get("/profile", auth(...ROLE_GROUPS.All), UserController.getUserProfile);

router.post(
  "/create-admin",
  auth(USER_ROLES.SUPER_ADMIN),
  validateRequest(UserValidation.createAdminZodSchema),
  UserController.createAdmin,
);

router
  .route("/")
  .post(
    validateRequest(UserValidation.createUserZodSchema),
    UserController.createUser,
  )
  .patch(
    auth(...ROLE_GROUPS.All),
    fileUploadHandler(),
    UserController.updateProfile,
  );

router
  .route("/player")
  .get(auth(USER_ROLES.PLAYER), UserController.getPlayer)
  .post(
    auth(USER_ROLES.PLAYER),
    // validateRequest(UserValidation.createPlayerZodSchema),
    fileUploadHandler(),
    UserController.createPlayer,
  )
  .patch(
    auth(USER_ROLES.PLAYER),
    fileUploadHandler(),
    UserController.updatePlayer,
  );

router.patch(
  "/update-child-info/:childId",
  auth(USER_ROLES.PLAYER, USER_ROLES.OTHER_CLUBS, USER_ROLES.TOURNAMENT_PLAYER),
  fileUploadHandler(),
  UserController.updateChieldInfo,
);

// manager
router
  .route("/manager")
  .get(auth(USER_ROLES.MANAGER), UserController.getManager)
  .post(
    auth(USER_ROLES.MANAGER),
    // validateRequest(UserValidation.createPlayerZodSchema),
    fileUploadHandler(),
    UserController.createPlayer,
  )
  .patch(
    auth(USER_ROLES.MANAGER),
    fileUploadHandler(),
    UserController.updatePlayer,
  );

router
  .route("/referee")
  .get(auth(USER_ROLES.REFEREE), UserController.getReferee)
  .post(
    auth(USER_ROLES.REFEREE),
    // validateRequest(UserValidation.createPlayerZodSchema),
    fileUploadHandler(),
    UserController.createPlayer,
  )
  .patch(
    auth(USER_ROLES.REFEREE),
    fileUploadHandler(),
    UserController.updatePlayer,
  );

// other clubs

router
  .route("/other-clubs")
  .get(auth(USER_ROLES.OTHER_CLUBS), UserController.getOtherClub)
  .post(
    auth(USER_ROLES.OTHER_CLUBS),
    // validateRequest(UserValidation.createPlayerZodSchema),
    fileUploadHandler(),
    UserController.createPlayer,
  )
  .patch(
    auth(USER_ROLES.OTHER_CLUBS),
    fileUploadHandler(),
    UserController.updatePlayer,
  );

router
  .route("/player-details/:userId")
  .get(UserController.getPlayerDetailsByUserId);

router
  .route("/player-details")
  .get(auth(...ROLE_GROUPS.All), UserController.getPlayer);

// UPDATE USER COIN OR MARKET VALUE (Admin / Super Admin only)
// PATCH /api/v1/user/:userId/economy
// Body: { "engCoine": 500 }  OR  { "marketValue": 20000 }  OR both
router.patch(
  "/:userId/economy",
  auth(...ROLE_GROUPS.ADMINS),
  UserController.updateUserCoinOrMarketValue,
);

// APPROVE OR REJECT USER (Admin / Super Admin only)
// PATCH /api/v1/user/:userId/approve-status
// Body: { "status": "APPROVED" }  OR  { "status": "REJECTED" }
router.patch(
  "/:userId/approve-status",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserController.approveOrRejectUser,
);

// TOGGLE BLUE TICK VERIFICATION FOR USER (Admin / Super Admin only)
// PATCH /api/v1/user/:userId/blue-tick
// Body: { "blueTick": true }  OR  { "blueTick": false }
router.patch(
  "/:userId/blue-tick",
  auth(...ROLE_GROUPS.ADMINS),
  UserController.toggleBlueTickUser,
);

export const UserRoutes = router;
