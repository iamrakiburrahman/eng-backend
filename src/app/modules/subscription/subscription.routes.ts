import express from "express";
import auth from "../../middlewares/auth";
import { USER_ROLES } from "../../../enums/user";
import { SubscriptionController } from "./subscription.controller";
const router = express.Router();

router.get("/", 
    auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN), 
    SubscriptionController.subscriptions
);

router.get("/details", 
    auth(USER_ROLES.PLAYER,USER_ROLES.REFEREE,USER_ROLES.MANAGER), 
    SubscriptionController.subscriptionDetails
);

router.get("/:id", 
    auth(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.PLAYER, USER_ROLES.REFEREE, USER_ROLES.MANAGER), 
    SubscriptionController.companySubscriptionDetails
)

export const SubscriptionRoutes = router;