import express from "express";
import auth from "../../middlewares/auth";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
import validateRequest from "../../middlewares/validateRequest";
import { ROLE_GROUPS, USER_ROLES } from "../../../enums/user";
import { PlayerController } from "./player.controller";
import { UserValidation } from "../user/user.validation";

const parseFormDataBody = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.body?.data && typeof req.body.data === 'string') {
    try {
      const parsed = JSON.parse(req.body.data);
      req.body = { ...req.body, ...parsed };
    } catch (e) {
      // ignore
    }
  }
  next();
};

const router = express.Router();

// ========================== PARENT PLAYER ROUTES ==========================

// 1. ADD PLAYER BY PARENT
router.post(
  "/",
  auth(...ROLE_GROUPS.All),
  fileUploadHandler(),
  parseFormDataBody,
  validateRequest(UserValidation.createPlayerZodSchema),
  PlayerController.createPlayerByParent
);

// 2. GET ALL PLAYERS OF AUTHENTICATED PARENT
router.get(
  "/my-players",
   auth(...ROLE_GROUPS.All),
  PlayerController.getMyPlayers
);

// 3. GET SINGLE PLAYER BY PARENT
router.get(
  "/my-players/:id",
  auth(...ROLE_GROUPS.All),
  PlayerController.getPlayerById
);

// 4. UPDATE PLAYER BY PARENT
router.patch(
  "/my-players/:id",
  auth(...ROLE_GROUPS.All),
  fileUploadHandler(),
  PlayerController.updatePlayerByParent
);

// 5. DELETE PLAYER BY PARENT
router.delete(
  "/my-players/:id",
   auth(...ROLE_GROUPS.All),
  PlayerController.deletePlayerByParent
);

// ========================== ADMIN APPROVAL ROUTES ==========================

// 6. GET PENDING PLAYERS FOR ADMIN REVIEW
router.get(
  "/admin/pending",
  auth(...ROLE_GROUPS.ADMINS),
  PlayerController.getPendingPlayersForAdmin
);

// 7. APPROVE PLAYER BY ADMIN
router.patch(
  "/admin/:id/approve",
  auth(...ROLE_GROUPS.ADMINS),
  PlayerController.approvePlayerByAdmin
);

// 8. REJECT PLAYER BY ADMIN
router.patch(
  "/admin/:id/reject",
  auth(...ROLE_GROUPS.ADMINS),
  PlayerController.rejectPlayerByAdmin
);

// ========================== EXISTING PUBLIC/LISTING ROUTES ==========================

// GET ALL PLAYERS
router.get("/", auth(false), PlayerController.getAllPlayers);

// FILTER PLAYERS BY TEAM AND/OR POSITION
router.get("/filter", auth(false), PlayerController.getFilteredPlayers);

// DEDICATED PLAYER OVERVIEW / ANALYTICS
router.get("/overview", auth(false), PlayerController.getPlayerOverview);

// UPDATE PLAYER DATA (ADMIN & SUPER_ADMIN)
router.patch(
  "/:id",
  auth(...ROLE_GROUPS.ADMINS),
  fileUploadHandler(),
  PlayerController.updatePlayerByAdmin
);

// ASSIGN / UPDATE PLAYER JERSEY NUMBER (ADMIN, MANAGER, REFEREE, SUPER_ADMIN)
router.patch(
  "/:id/jersey-number",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.MANAGER, USER_ROLES.REFEREE),
  PlayerController.assignJerseyNumber
);

// DELETE PLAYER (ADMIN & SUPER_ADMIN)
router.delete(
  "/:id",
  auth(...ROLE_GROUPS.ADMINS),
  PlayerController.deletePlayerByAdmin
);

export default router;