import bcrypt from "bcrypt";
import { StatusCodes } from "http-status-codes";
import { JwtPayload, Secret } from "jsonwebtoken";
import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";
import { USER_ROLES } from "../../../enums/user";
import { jwtHelper } from "../../../helpers/jwtHelper";
import { EmailQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import {
  IAuthResetPassword,
  IChangePassword,
  ILoginData,
  IVerifyEmail,
} from "../../../types/auth";
import cryptoToken from "../../../util/cryptoToken";
import generateOTP from "../../../util/generateOTP";
import { ResetToken } from "../resetToken/resetToken.model";
import { User } from "../user/user.model";
import { IUser } from "../user/user.interface";
import { Subscription } from "../subscription/subscription.model";
import { NotificationQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";
import { checkIsProfileCompleted } from "../user/user.service";
import firebaseAdmin from "../../../firebase/firebase";

//login
const loginUserFromDB = async (payload: ILoginData) => {
  const { email, password } = payload;

  const isExistUser: any = await User.findOne({ email }).select("+password");

  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  // check verified
  if (!isExistUser.verified) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Please verify your account, then try to login again",
    );
  }

  // ✅ Only MANAGER & REFEREE require admin account approval before login
  // Parent (Account Owner) & OTHER_CLUBS log in immediately upon email verification
  //   const rolesRequiringApproval = ['MANAGER', 'REFEREE'];
  //   if (
  //     rolesRequiringApproval.includes(isExistUser.role) &&
  //     isExistUser.status !== 'APPROVED'
  //   ) {
  //     throw new ApiError(
  //       StatusCodes.FORBIDDEN,
  //       'Your account is pending admin approval. Please wait for an admin to approve your profile before logging in.'
  //     );
  //   }

  // check password
  if (
    password &&
    !(await User.isMatchPassword(password, isExistUser.password))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect!");
  }

  // user details are merged into user
  const userDetails = isExistUser;

  // check active subscription
  const subscription = await Subscription.findOne({
    user: isExistUser._id,
    status: "active",
  });

  // create access token
  const accessToken = jwtHelper.createToken(
    {
      id: isExistUser._id,
      role: isExistUser.role,
      email: isExistUser.email,
      permissions: isExistUser.permissions || [],
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );

  // create refresh token
  const refreshToken = jwtHelper.createToken(
    {
      id: isExistUser._id,
      role: isExistUser.role,
      email: isExistUser.email,
      permissions: isExistUser.permissions || [],
    },
    config.jwt.jwtRefreshSecret as Secret,
    config.jwt.jwtRefreshExpiresIn as string,
  );

  const isDetailsSubmitted = checkIsProfileCompleted(isExistUser);

  return {
    accessToken,
    refreshToken,
    role: isExistUser.role,
    permissions: isExistUser.permissions || [],
    profileStatus: userDetails ? userDetails.status : "INCOMPLETE",
    isDetailsSubmitted,
    paymentStatus: subscription ? true : false,
  };
};

//forget password
const forgetPasswordToDB = async (email: string) => {
  const isExistUser = await User.isExistUserByEmail(email);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //send mail
  const otp = generateOTP();
  await EmailQueueHelper.sendPasswordResetEmail(
    isExistUser.email,
    otp.toString(),
  );

  //save to DB
  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };
  await User.findOneAndUpdate({ email }, { $set: { authentication } });
};

//verify email
const verifyEmailToDB = async (payload: IVerifyEmail) => {
  const { email, oneTimeCode } = payload;

  const isExistUser = await User.findOne({ email }).select("+authentication");

  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  if (!oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Please give the otp");
  }

  if (isExistUser.authentication?.oneTimeCode !== oneTimeCode) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Wrong OTP");
  }

  const date = new Date();
  if (date > isExistUser.authentication?.expireAt) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "OTP expired");
  }

  let message;
  let data;

  // =========================
  // ✅ FIRST TIME EMAIL VERIFY → LOGIN TOKEN
  // =========================
  if (!isExistUser.verified) {
    const updatePayload: any = {
      verified: true,
      authentication: {
        oneTimeCode: null,
        expireAt: null,
      },
    };

    // Parent / Account owner OTP email verification automatically approves account status
    const rolesAutoApproved = ["USER", "PARENT", USER_ROLES.OTHER_CLUBS];
    if (
      rolesAutoApproved.includes(isExistUser.role) ||
      (!isExistUser.parentId &&
        isExistUser.role !== USER_ROLES.MANAGER &&
        isExistUser.role !== USER_ROLES.REFEREE)
    ) {
      updatePayload.status = "APPROVED";
    }

    await User.findOneAndUpdate({ _id: isExistUser._id }, updatePayload);

    // 🔥 SAME LOGIN TOKEN LIKE LOGIN API
    data = jwtHelper.createToken(
      {
        id: isExistUser._id,
        email: isExistUser.email,
        role: isExistUser.role,
      },
      config.jwt.jwt_secret as Secret,
      "7d",
    );

    // 🔔 Notify user: email verified via background queue
    await NotificationQueueHelper.sendNotification(
      isExistUser._id.toString(),
      "Welcome! Your email has been verified. You can now access your account.",
      "Email Verified Successfully!",
      NOTIFICATION_TYPE.EMAIL_VERIFIED,
    );

    message = "Email verified successfully";
  }

  // =========================
  // 🔁 FORGOT PASSWORD FLOW → DB TOKEN
  // =========================
  else {
    await User.findOneAndUpdate(
      { _id: isExistUser._id },
      {
        authentication: {
          isResetPassword: true,
          oneTimeCode: null,
          expireAt: null,
        },
      },
    );

    const createToken = cryptoToken();

    await ResetToken.create({
      user: isExistUser._id,
      token: createToken,
      expireAt: new Date(Date.now() + 5 * 60000),
    });

    message = "Verification Successful: Please use code for reset password";
    data = createToken;
  }

  return { data, message };
};

//forget password
const resetPasswordToDB = async (
  token: string,
  payload: IAuthResetPassword,
) => {
  const { newPassword, confirmPassword } = payload;

  //isExist token
  const isExistToken = await ResetToken.isExistToken(token);
  if (!isExistToken) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "You are not authorized");
  }

  //user permission check
  const isExistUser = await User.findById(isExistToken.user).select(
    "+authentication",
  );
  if (!isExistUser?.authentication?.isResetPassword) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "You don't have permission to change the password. Please click again to 'Forgot Password'",
    );
  }

  //validity check
  const isValid = await ResetToken.isExpireToken(token);
  if (!isValid) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Token expired, Please click again to the forget password",
    );
  }

  //check password
  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "New password and Confirm password doesn't match!",
    );
  }

  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const updateData = {
    password: hashPassword,
    authentication: {
      isResetPassword: false,
    },
  };

  await User.findOneAndUpdate({ _id: isExistToken.user }, updateData, {
    new: true,
  });

  // Invalidate/delete reset token after successful password reset
  await ResetToken.deleteMany({ user: isExistToken.user });
};

const changePasswordToDB = async (
  user: JwtPayload,
  payload: IChangePassword,
) => {
  const { currentPassword, newPassword, confirmPassword } = payload;
  const isExistUser = await User.findById(user._id).select("+password");
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //current password match
  if (
    currentPassword &&
    !(await User.isMatchPassword(currentPassword, isExistUser.password))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect");
  }

  //newPassword and current password
  if (currentPassword === newPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Please give different password from current password",
    );
  }

  //new password and confirm password check
  if (newPassword !== confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Password and Confirm password doesn't matched",
    );
  }

  //hash password
  const hashPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  const updateData = {
    password: hashPassword,
  };

  await User.findOneAndUpdate({ _id: user._id }, updateData, { new: true });
};

const newAccessTokenToUser = async (token: string) => {
  // Check if the token is provided
  if (!token) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Token is required!");
  }

  const verifyUser = jwtHelper.verifyToken(
    token,
    config.jwt.jwtRefreshSecret as Secret,
  );
  const isExistUser = await User.findById(verifyUser?.id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Unauthorized access");
  }

  //create token
  const accessToken = jwtHelper.createToken(
    { id: isExistUser._id, role: isExistUser.role, email: isExistUser.email },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string,
  );

  const refreshToken = jwtHelper.createToken(
    { id: isExistUser._id, role: isExistUser.role, email: isExistUser.email },
    config.jwt.jwtRefreshSecret as Secret,
    config.jwt.jwtRefreshExpiresIn as string,
  );

  return { accessToken, refreshToken, token: accessToken };
};

const resendVerificationEmailToDB = async (email: string) => {
  // Find the user by ID
  const existingUser: any = await User.findOne({ email: email }).lean();

  if (!existingUser) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "User with this email does not exist!",
    );
  }

  if (existingUser?.isVerified) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User is already verified!");
  }

  const otp = generateOTP();
  await EmailQueueHelper.sendWelcomeEmail(
    existingUser.email,
    existingUser.firstName || existingUser.userName || "",
    otp.toString(),
  );

  // Update user with authentication details
  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };

  await User.findOneAndUpdate(
    { email: email },
    { $set: { authentication } },
    { new: true },
  );
};

// social authentication (Firebase Google & Apple login)
interface ISocialLoginPayload {
  idToken: string;
  fcmToken?: string | null;
  firstName?: string;
  lastName?: string;
}

const socialLoginFromDB = async (payload: ISocialLoginPayload) => {
  const { idToken, fcmToken, firstName: reqFirstName, lastName: reqLastName } = payload;

  if (!idToken) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Firebase idToken is required");
  }

  let decodedToken: any;
  try {
    decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
  } catch (err: any) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      `Invalid or expired Firebase ID token: ${err.message || 'Verification failed'}`
    );
  }

  const { uid, email, name, picture, firebase } = decodedToken;

  if (!email) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No email associated with this Google/Apple account"
    );
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const provider = firebase?.sign_in_provider || 'google.com';
  const isApple = String(provider).toLowerCase().includes('apple');

  // Check if user exists by email, firebaseUid, or appId
  let user: any = await User.findOne({
    $or: [
      { email: normalizedEmail },
      { firebaseUid: uid },
      { appId: uid },
    ],
  });

  let isNewUser = false;

  if (!user) {
    isNewUser = true;

    // Parse names
    let firstName = reqFirstName?.trim() || "";
    let lastName = reqLastName?.trim() || "";

    if (!firstName && name) {
      const parts = String(name).trim().split(" ");
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(" ") || "";
    }

    if (!firstName) {
      firstName = normalizedEmail.split("@")[0] || "User";
    }

    // Generate clean unique username
    const baseUserName = `${firstName.toLowerCase().replace(/[^a-z0-9]/g, "")}_${Math.floor(1000 + Math.random() * 9000)}`;

    user = await User.create({
      email: normalizedEmail,
      userName: baseUserName,
      firstName,
      lastName,
      profile: picture || undefined,
      role: USER_ROLES.UNASSIGNED, // 👈 New accounts start as UNASSIGNED so user selects role
      verified: true,              // 👈 Google / Apple accounts are pre-verified
      authProvider: isApple ? "apple" : "google",
      firebaseUid: uid,
      appId: uid,
      fcmToken: fcmToken ? String(fcmToken) : "",
      status: "PENDING",
    });
  } else {
    // Existing user: ensure verified is true, sync fcmToken, firebaseUid, and profile if missing
    const updates: Record<string, any> = {};
    if (!user.verified) updates.verified = true;
    if (fcmToken && user.fcmToken !== fcmToken) updates.fcmToken = fcmToken;
    if (!user.profile && picture) updates.profile = picture;
    if (!user.firebaseUid) updates.firebaseUid = uid;
    if (!user.authProvider) updates.authProvider = isApple ? "apple" : "google";

    if (Object.keys(updates).length > 0) {
      user = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true });
    }
  }

  // Create JWT Tokens
  const accessToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      permissions: user.permissions || [],
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );

  const refreshToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      permissions: user.permissions || [],
    },
    config.jwt.jwtRefreshSecret as Secret,
    config.jwt.jwtRefreshExpiresIn as string
  );

  const subscription = await Subscription.findOne({
    user: user._id,
    status: "active",
  });

  const isDetailsSubmitted = checkIsProfileCompleted(user);
  const hasSelectedRole = user.role !== USER_ROLES.UNASSIGNED;

  return {
    accessToken,
    refreshToken,
    role: user.role,
    isNewUser,
    hasSelectedRole,
    permissions: user.permissions || [],
    profileStatus: user.status || "INCOMPLETE",
    isDetailsSubmitted,
    paymentStatus: Boolean(subscription),
  };
};

// Select or assign role for UNASSIGNED accounts
const selectRoleToDB = async (userId: string, requestedRole: USER_ROLES) => {
  const allowedRoles = [
    USER_ROLES.PLAYER,
    USER_ROLES.MANAGER,
    USER_ROLES.REFEREE,
    USER_ROLES.OTHER_CLUBS,
    USER_ROLES.TOURNAMENT_PLAYER,
  ];

  if (!allowedRoles.includes(requestedRole)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Invalid role. Allowed roles are: ${allowedRoles.join(", ")}`
    );
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  user.role = requestedRole;
  await user.save();

  // Create fresh JWT tokens with the updated role
  const accessToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      permissions: user.permissions || [],
    },
    config.jwt.jwt_secret as Secret,
    config.jwt.jwt_expire_in as string
  );

  const refreshToken = jwtHelper.createToken(
    {
      id: user._id,
      role: user.role,
      email: user.email,
      permissions: user.permissions || [],
    },
    config.jwt.jwtRefreshSecret as Secret,
    config.jwt.jwtRefreshExpiresIn as string
  );

  return {
    accessToken,
    refreshToken,
    role: user.role,
    hasSelectedRole: true,
    isDetailsSubmitted: checkIsProfileCompleted(user),
  };
};

// delete user
// delete user
const deleteUserFromDB = async (user: JwtPayload, password: string) => {
  const isExistUser = await User.findById(user.id).select("+password");
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //check match password
  if (
    password &&
    !(await User.isMatchPassword(password, isExistUser.password))
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is incorrect");
  }

  const updateUser = await User.findByIdAndDelete(user.id);
  if (!updateUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }
  return;
};

export const AuthService = {
  verifyEmailToDB,
  loginUserFromDB,
  forgetPasswordToDB,
  resetPasswordToDB,
  changePasswordToDB,
  newAccessTokenToUser,
  resendVerificationEmailToDB,
  socialLoginFromDB,
  selectRoleToDB,
  deleteUserFromDB,
};
