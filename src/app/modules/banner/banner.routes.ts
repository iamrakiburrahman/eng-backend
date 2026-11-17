import express from "express";
import auth from "../../middlewares/auth";
import { USER_ROLES } from "../../../enums/user";
import { BannerController } from "./banner.controller";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";

const router = express.Router();

router
  .route("/")
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    BannerController.createBanner
  )
  .get(BannerController.getAllBanner);

router
  .route("/:id")
  .get(BannerController.getSingleBanner)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    BannerController.updateBanner
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    BannerController.deleteBanner
  );

router.patch(
  "/:id/status",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  BannerController.toggleStatus
);

router.patch(
  "/:id/toggle-status",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  BannerController.toggleStatus
);

export const BannerRoutes = router;
