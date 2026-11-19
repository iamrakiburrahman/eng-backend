import express from "express";
import auth from "../../middlewares/auth";
import { USER_ROLES } from "../../../enums/user";
import { UserManagementController } from "./userManagement.controller";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";

const router = express.Router();

// GET ALL USERS
router.get(
  "/",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.getAllUsers
);

// GET ALL PARENTS (DEDICATED)
router.get(
  "/parents",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.getAllParents
);

// GET PARENTS OVERVIEW / ANALYTICS (DEDICATED)
router.get(
  "/parents/overview",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.getParentOverview
);

// GET INCOMPLETE USERS ANALYTICS/STATS
router.get(
  "/incomplete/analytics",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.getIncompleteUsersAnalytics
);

// GET INCOMPLETE USERS (FOR ADMIN REMOVAL)
router.get(
  "/incomplete",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.getIncompleteUsers
);

// ASSIGN TEAM TO USER / PLAYER BY ADMIN
router.patch(
  "/assign-team/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.assignTeamToUser
);

// UPDATE PLAYER JERSEY NUMBER & PROFILE PICTURE BY ADMIN, MANAGER & REFEREE
router.patch(
  "/jersey-number/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MANAGER, USER_ROLES.REFEREE),
  fileUploadHandler(),
  UserManagementController.updateJerseyNumber
);

// GET USER ANALYTICS
router.get(
  "/analytics",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.getUserAnalytics
);

// GET REFEREES
router.get("/referees", UserManagementController.getAllReferees);

// GET MANAGERS
router.get("/managers", UserManagementController.getAllManagers);

// TOGGLE VERIFIED
router.patch(
  "/toggle-verified/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.toggleVerified
);

// UPDATE USER ROLE
router.patch(
  "/role/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.updateUserRole
);

// UPDATE USER PROFILE BY ADMIN
router.patch(
  "/update-profile/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  fileUploadHandler(),
  UserManagementController.updateUserProfileByAdmin
);

router.patch(
  "/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  fileUploadHandler(),
  UserManagementController.updateUserProfileByAdmin
);

// DELETE USER
router.delete(
  "/:id",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  UserManagementController.deleteUser
);

export default router;