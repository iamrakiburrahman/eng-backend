import express from "express";
import { USER_ROLES } from "../../../enums/user";
import auth from "../../middlewares/auth";
import { NewsController } from "./news.controller";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";

const router = express.Router();

// CREATE
router
  .route("/")
  .post(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    NewsController.createNews,
  )
  .get(auth(), NewsController.getAllNews);
router.get("/public-news", NewsController.getPublicNews);
router.get(
  "/analytics",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  NewsController.getNewsAnalytics
);
router.patch(
  "/reorder",
  auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
  NewsController.rearrangeNews,
);

// SINGLE + UPDATE + DELETE
router
  .route("/:id")
  .get(NewsController.getSingleNews)
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    fileUploadHandler(),
    NewsController.updateNews,
  )
  .delete(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    NewsController.deleteNews,
  );

// TOGGLE STATUS
router
  .route("/:id/toggle-status")
  .patch(
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN),
    NewsController.toggleNewsStatus,
  );

export default router;
