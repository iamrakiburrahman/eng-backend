import express, { NextFunction, Request, Response } from 'express';
import { ROLE_GROUPS, USER_ROLES } from '../../../enums/user';
import auth from '../../middlewares/auth';
import validateRequest from '../../middlewares/validateRequest';
import { AuthController } from './auth.controller';
import { AuthValidation } from './auth.validation';
import { authLimiter, otpLimiter } from '../../middlewares/rateLimiter';
// import passport from '../../../config/passport'
const router = express.Router();

router.post(
    '/login',
    authLimiter,
    validateRequest(AuthValidation.createLoginZodSchema),
    AuthController.loginUser
);

router.post(
    '/forgot-password',
    authLimiter,
    validateRequest(AuthValidation.createForgetPasswordZodSchema),
    AuthController.forgetPassword
);

router.post(
    '/refresh-token',
    AuthController.newAccessToken
);

router.post(
    '/resend-otp',
    authLimiter,
    AuthController.resendVerificationEmail
);

router.post(
    '/verify-email',
    otpLimiter,
    async (req: Request, res: Response, next: NextFunction) => {

        try {
            const { email, oneTimeCode } = req.body;

            req.body = { email, oneTimeCode: Number(oneTimeCode)};
            next();

        } catch (error) {
            return res.status(500).json({ message: "Failed to convert string to number" });
        }
    },
    validateRequest(AuthValidation.createVerifyEmailZodSchema),
    AuthController.verifyEmail
);

router.post(
    '/reset-password',
    authLimiter,
    validateRequest(AuthValidation.createResetPasswordZodSchema),
    AuthController.resetPassword
);

router.post(
    '/change-password',
    auth(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.PLAYER, USER_ROLES.MANAGER, USER_ROLES.OTHER_CLUBS),
    validateRequest(AuthValidation.createChangePasswordZodSchema),
    AuthController.changePassword
);

router.post(
    '/resend-otp',
    AuthController.resendVerificationEmail
);

router.post(
    '/social-login',
    validateRequest(AuthValidation.socialLoginZodSchema),
    AuthController.socialLogin
);

router.post(
    '/select-role',
    auth(...ROLE_GROUPS.All),
    validateRequest(AuthValidation.selectRoleZodSchema),
    AuthController.selectRole
);

router.delete(
    '/delete-account',
    auth(USER_ROLES.ADMIN,USER_ROLES.SUPER_ADMIN),
    AuthController.deleteUser
);


// Google Auth Routes
// router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

// router.get("/google/callback", 
//     passport.authenticate("google", { failureRedirect: "/" }),
//     (req, res) => {
//         res.redirect("/"); // Redirect after successful login
//     }
// );

// Facebook Auth Routes
// router.get("/facebook", passport.authenticate("facebook", { scope: ["email"] }));

// router.get("/facebook/callback",
//     passport.authenticate("facebook", { failureRedirect: "/" }),
//     (req, res) => {
//         res.redirect("/dashboard"); // Redirect after successful login
//     }
// );

export const AuthRoutes = router;