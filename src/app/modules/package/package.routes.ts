import express from "express";
import auth from "../../middlewares/auth";
import { USER_ROLES } from "../../../enums/user";
import { PackageController } from "./package.controller";
import validateRequest from "../../middlewares/validateRequest";
import { PackageValidation } from "./package.validation";
import fileUploadHandler from "../../middlewares/fileUploaderHandler";
const router = express.Router()

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

router
    .route("/")
    .post(
        fileUploadHandler(), 
        parseFormDataBody,
        auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN), 
        validateRequest(PackageValidation.createPackageZodSchema), 
        PackageController.createPackage
    )
    .get(auth(false), PackageController.getPackage)

router.get(
  "/overview",
  auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
  PackageController.getPackageOverview
);

router
    .route("/:id")
    .patch(
        fileUploadHandler(),
        parseFormDataBody,
        auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN), 
        PackageController.updatePackage
    )
    .delete(auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN), PackageController.deletePackage)

    router.patch(
    "/toggle/:id",
    auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN),
    PackageController.togglePackageStatus
    
    );

    router.get("/all", PackageController.getActivePackages)

// Auto-generate checkout URL with client_reference_id from logged-in user's token
router.get(
    "/:id/checkout",
    auth(USER_ROLES.PLAYER, USER_ROLES.TOURNAMENT_PLAYER, USER_ROLES.OTHER_CLUBS),
    PackageController.getCheckoutUrl
);

export default router;