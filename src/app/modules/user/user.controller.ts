import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UserService } from './user.service';
import catchAsync from '../../../shared/catchAsync';
import sendResponse from '../../../shared/sendResponse';
import ApiError from '../../../errors/ApiErrors';
import pick, { USER_SELF_EDITABLE_FIELDS } from '../../../shared/pick';

// register user
const createUser = catchAsync( async (req: Request, res: Response, next: NextFunction) => {
    const rawData = req.body?.data ? (typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data) : req.body;
    const {
        verified: _verified,
        status: _status,
        engCoine: _engCoine,
        marketValue: _marketValue,
        rewardPoint: _rewardPoint,
        isSubscribed: _isSubscribed,
        hasAccess: _hasAccess,
        permissions: _permissions,
        authentication: _authentication,
        accountInformation: _accountInformation,
        blueTick: _blueTick,
        ...safeRawData
    } = rawData || {};
    const userData = { ...safeRawData };
    if (!userData.role) {
        userData.role = 'PLAYER';
    } else if (typeof userData.role === 'string') {
        userData.role = userData.role.trim().toUpperCase();
    }
    if (userData.phoneNumber && !userData.phone) {
        userData.phone = userData.phoneNumber;
    }
    const result = await UserService.createUserToDB(userData);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'Your account has been successfully created. Verify Your Email By OTP. Check your email',
        data: result,
    });
});

// register admin
const createAdmin = catchAsync( async (req: Request, res: Response, next: NextFunction) => {
    const { email, password, role, firstName, lastName, userName } = req.body;
    const result = await UserService.createAdminToDB({
        email,
        password,
        role,
        firstName,
        lastName,
        userName,
    });

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'Admin created successfully',
        data: result
    });
});

// retrieved user profile
const getUserProfile = catchAsync(async (req: Request, res: Response) => {
   

    const user = req.user;

    if (!user) {
        return sendResponse(res, {
            success: false,
            statusCode: 200,
            message: "Data not found",
            data: null
        });
    }

    const result = await UserService.getUserProfileFromDB(user);

    if (!result) {
        return sendResponse(res, {
            success: false,
            statusCode: 200,
            message: "Data not found",
            data: null
        });
    }

    return sendResponse(res, {
        success: true,
        statusCode: 200,
        message: "Profile data retrieved successfully",
        data: result
    });
});

//update profile
const updateProfile = catchAsync(async (req: Request, res: Response) => {
    const user = req.user;

    // 🚨 AUTH CHECK
    if (!user) {
        throw new ApiError(401, "Unauthorized user - token invalid or missing");
    }

    let profile;

    if (req.files && 'image' in req.files && req.files.image[0]) {
        profile = `/images/${req.files.image[0].filename}`;
    }

    // ✅ parse JSON string safely & enforce editable field allowlist
    let parsedData: any = {};
    if (req.body?.data) {
        try {
            parsedData = typeof req.body.data === 'string'
                ? JSON.parse(req.body.data)
                : req.body.data;
        } catch {
            throw new ApiError(400, "Invalid JSON format in request body");
        }
    } else if (req.body && typeof req.body === 'object') {
        parsedData = req.body;
    }

    if (parsedData?.phoneNumber && !parsedData?.phone) {
        parsedData.phone = parsedData.phoneNumber;
    }

    const safeData: any = pick(parsedData, USER_SELF_EDITABLE_FIELDS);
    if (profile) {
        safeData.profile = profile;
    }

    const result = await UserService.updateProfileToDB(user, safeData);

    sendResponse(res, {
        success: true,
        statusCode: StatusCodes.OK,
        message: 'Profile updated successfully',
        data: result
    });
});


const createPlayer = catchAsync(async (req: Request, res: Response) => {
    const user = req.user as any;

    // 🚨 AUTH CHECK
    if (!user?._id) {
        throw new ApiError(401, "Unauthorized user - token invalid or missing");
    }

    const userId = user._id;
    const role = user.role;

    // 🚨 FILES (single field: document)
    const files = req.files as any;

    const documentFiles =
        files?.document?.map((file: any) => {
            return `/documents/${file.filename}`;
        }) || [];

    // 🚨 BODY CHECK
    if (!req.body) {
        throw new ApiError(400, "Request body is missing");
    }

    // 🚀 PARSE DATA
    let parsedData: any = {};

    try {
        parsedData =
            typeof req.body.data === "string"
                ? JSON.parse(req.body.data)
                : req.body.data || req.body;
    } catch {
        throw new ApiError(400, "Invalid JSON format in request body");
    }

    // // 🔥 REQUIRED FIELD CHECK
    // const requiredFields = [
    //     "firstName",
    //     "lastName",
    //     "dateOfBirth",
        
    // ];

    // const missingFields = requiredFields.filter(
    //     (field) => !parsedData?.[field]
    // );

    // if (missingFields.length > 0) {
    //     throw new ApiError(
    //         400,
    //         `Missing required fields: ${missingFields.join(", ")}`
    //     );
    // }

    // 🚨 PLAYER ROLE SPECIFIC VALIDATION
    if (role === "PLAYER") {
      const playerRequiredFields = ["ageGroup", "selectTeam"];

      const missingPlayerFields = playerRequiredFields.filter(
        (field) => !parsedData?.[field]
      );

      if (missingPlayerFields.length > 0) {
        throw new ApiError(
          400,
          `Player must provide: ${missingPlayerFields.join(", ")}`
        );
      }

      if (parsedData?.playForAcademy === true) {
        if (!parsedData?.academyClubName || parsedData.academyClubName.trim() === "") {
          throw new ApiError(
            400,
            "Academy Club Name is required when playing for a CAT 1 to 3 academy"
          );
        }
      }
    }

    if (parsedData?.phoneNumber && !parsedData?.phone) {
        parsedData.phone = parsedData.phoneNumber;
    }

    // 🚀 FINAL PAYLOAD (allowlisted fields only)
    const safeParsed = pick(parsedData, USER_SELF_EDITABLE_FIELDS);
    const data: any = {
        userId,
        ...safeParsed,
        document: documentFiles.length > 0 ? documentFiles : safeParsed.document || [],
    };

    const result = await UserService.createPlayerToDB(data);

    return sendResponse(res, {
        success: true,
        statusCode: StatusCodes.CREATED,
        message: "Player created successfully",
        data: result,
    });
});

const updateChieldInfo = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  // ✅ AUTH CHECK
  if (!user?._id) {
    throw new ApiError(
      401,
      "Unauthorized user - token invalid or missing"
    );
  }

  const userId = user._id;

  // ✅ FILE HANDLE
  const files = req.files as any;

  let documentFiles: string[] = [];

  if (files?.document?.length) {
    documentFiles = files.document.map((file: any) => {
      return `/documents/${file.filename}`;
    });
  }

  // ✅ SAFE JSON PARSE
  let parsedData: any = {};

  try {
    parsedData =
      typeof req.body.data === "string"
        ? JSON.parse(req.body.data)
        : req.body.data || req.body;
  } catch (error) {
    throw new ApiError(
      400,
      "Invalid JSON format in request body"
    );
  }

  if (parsedData?.phoneNumber && !parsedData?.phone) {
    parsedData.phone = parsedData.phoneNumber;
  }

  // ✅ UPDATE DATA (allowlisted fields only)
  const updateData: any = {
    ...pick(parsedData, USER_SELF_EDITABLE_FIELDS),
    document: documentFiles,
  };

  const childId = req.params.childId as string;
  const result = await UserService.updateChieldInfoToDB(childId, updateData);

  sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Child info updated successfully",
    data: result,
  });
});

const updatePlayer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  // ✅ AUTH CHECK
  if (!user?._id) {
    throw new ApiError(
      401,
      "Unauthorized user - token invalid or missing"
    );
  }

  const userId = user._id;

  // ✅ FILE HANDLE
  const files = req.files as any;

  let documentFiles: string[] = [];

  if (files?.document?.length) {
    documentFiles = files.document.map((file: any) => {
      return `/documents/${file.filename}`;
    });
  }

  // ✅ SAFE JSON PARSE
  let parsedData: any = {};

  try {
    parsedData =
      typeof req.body.data === "string"
        ? JSON.parse(req.body.data)
        : req.body.data || req.body;
  } catch (error) {
    throw new ApiError(
      400,
      "Invalid JSON format in request body"
    );
  }

  if (parsedData?.phoneNumber && !parsedData?.phone) {
    parsedData.phone = parsedData.phoneNumber;
  }

  // ✅ UPDATE DATA (allowlisted fields only)
  const updateData: any = {
    ...pick(parsedData, USER_SELF_EDITABLE_FIELDS),
  };

  // ✅ DOCUMENT ADD
  if (documentFiles.length > 0) {
    updateData.document = documentFiles;
  }

  // 🔥 UPDATE PLAYER
  const result = await UserService.updatePlayerByUserId(
    userId,
    updateData
  );

  return sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player updated successfully",
    data: result,
  });
});


const getPlayer = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as any;

  if (!user?._id) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Unauthorized user"
    );
  }

  const result = await UserService.getPlayerByUserId(
    user._id
  );

  return sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: "Player retrieved successfully",
    data: result,
  });
});

const getManager = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;

    if (!user?._id) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        'Unauthorized user'
      );
    }

    const result =
      await UserService.getManagerByUserId(
        user._id
      );

    return sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Manager retrieved successfully',
      data: result,
    });
  }
);



const getReferee = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;

    if (!user?._id) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        'Unauthorized user'
      );
    }

    const result =
      await UserService.getRefereeByUserId(
        user._id
      );

    return sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Referee retrieved successfully',
      data: result,
    });
  }
);


const getOtherClub = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user as any;

    if (!user?._id) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        'Unauthorized user'
      );
    }

    const result =
      await UserService.getOtherClubByUserId(
        user._id
      );

    return sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Other club retrieved successfully',
      data: result,
    });
  }
);



const getPlayerDetailsByUserId = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.params.userId || req.params.id;

    const result =
      await UserService.getPlayerDetailsByUserId(
        userId as string
      );

    return sendResponse(res, {
      success: true,
      statusCode: StatusCodes.OK,
      message: 'Player details retrieved successfully',
      data: result,
    });
  }
);

const getOtherClubByUserId = getPlayerDetailsByUserId;




// UPDATE USER COIN OR MARKET VALUE (Admin / Super Admin only)
const updateUserCoinOrMarketValue = catchAsync(async (req: Request, res: Response) => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { engCoine, marketValue } = req.body;

  const result = await UserService.updateUserCoinOrMarketValue(userId, { engCoine, marketValue });

  return sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: 'User coin/marketValue updated successfully',
    data: result,
  });
});

// APPROVE OR REJECT USER (Admin / Super Admin only)
const approveOrRejectUser = catchAsync(async (req: Request, res: Response) => {
  const admin = req.user as any;
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { status, rejectionReason } = req.body;

  if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'status must be either "APPROVED" or "REJECTED"'
    );
  }

  const result = await UserService.approveOrRejectUser(admin.role, userId, status, rejectionReason);

  return sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: `User ${status === 'APPROVED' ? 'approved' : 'rejected'} successfully`,
    data: result,
  });
});

// TOGGLE BLUE TICK VERIFICATION FOR USER (Admin / Super Admin only)
const toggleBlueTickUser = catchAsync(async (req: Request, res: Response) => {
  const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const { blueTick } = req.body;

  if (typeof blueTick !== 'boolean') {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      'blueTick must be a boolean (true or false)'
    );
  }

  const result = await UserService.toggleBlueTickUser(userId, blueTick);

  return sendResponse(res, {
    success: true,
    statusCode: StatusCodes.OK,
    message: `User blue tick verification updated to ${blueTick}`,
    data: result,
  });
});

export const UserController = { 
    createUser, 
    createAdmin, 
    getUserProfile, 
    updateProfile,
    createPlayer,
    updatePlayer,
    getPlayer,
    getManager,
    getReferee,
    getOtherClub,
    getOtherClubByUserId,
    getPlayerDetailsByUserId,
    updateUserCoinOrMarketValue,
    approveOrRejectUser,
    toggleBlueTickUser,
    updateChieldInfo,
};