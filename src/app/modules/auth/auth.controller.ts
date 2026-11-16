import { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { AuthService } from "./auth.service";

const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  const { ...verifyData } = req.body;
  const result = await AuthService.verifyEmailToDB(verifyData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.message,
    data: result.data,
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const { ...loginData } = req.body;
  const result = await AuthService.loginUserFromDB(loginData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "User login successfully",
    data: result,
  });
});

const forgetPassword = catchAsync(async (req: Request, res: Response) => {
  const email = req.body.email;
  const result = await AuthService.forgetPasswordToDB(email);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Please check your email, we send a OTP!",
    data: result,
  });
});

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const token = req.headers.authorization;
  const { ...resetData } = req.body;
  const result = await AuthService.resetPasswordToDB(token!, resetData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Password reset successfully",
    data: result,
  });
});

const changePassword = catchAsync(async (req: Request, res: Response) => {
  const user = req.user;
  const { ...passwordData } = req.body;
  if (!user) {
    return sendResponse(res, {
      success: false,
      statusCode: 401,
      message: "Unauthorized user - token invalid or missing",
      data: null,
    });
  }
  await AuthService.changePasswordToDB(user, passwordData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Password changed successfully",
  });
});

const newAccessToken = catchAsync(async (req: Request, res: Response) => {
  const token =
    (req.headers.refreshtoken as string) ||
    (req.headers["refresh-token"] as string) ||
    (req.headers["refreshtoken"] as string) ||
    req.body?.refreshToken ||
    req.body?.token

  console.log(token, "controller token");
  const result = await AuthService.newAccessTokenToUser(token as string);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Generate Access Token successfully",
    data: result,
  });
});

const resendVerificationEmail = catchAsync(
  async (req: Request, res: Response) => {
    const { email } = req.body;
    const result = await AuthService.resendVerificationEmailToDB(email);

    sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: "Generate OTP and send successfully",
      data: result,
    });
  },
);

// delete user
const deleteUser = catchAsync(async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return sendResponse(res, {
      success: false,
      statusCode: 401,
      message: "Unauthorized user - token invalid or missing",
      data: null,
    });
  }
  const result = await AuthService.deleteUserFromDB(user, req.body.password);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Account Deleted successfully",
    data: result,
  });
});

const socialLogin = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthService.socialLoginFromDB(req.body);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: result.isNewUser
      ? "Account created and logged in successfully"
      : "Login successful",
    data: result,
  });
});

const selectRole = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;
  const result = await AuthService.selectRoleToDB(user.id, req.body.role);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Role assigned successfully",
    data: result,
  });
});

export const AuthController = {
  verifyEmail,
  loginUser,
  forgetPassword,
  resetPassword,
  changePassword,
  newAccessToken,
  resendVerificationEmail,
  socialLogin,
  selectRole,
  deleteUser,
};
