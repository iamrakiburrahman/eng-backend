import { Types } from "mongoose";
import { USER_ROLES } from "../../../enums/user";
import { IUser } from "./user.interface";
import { JwtPayload } from "jsonwebtoken";
import { User } from "./user.model";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import generateOTP from "../../../util/generateOTP";
import { EmailQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import unlinkFile from "../../../shared/unlinkFile";
import { Subscription } from "../subscription/subscription.model";
import { sendNotificationToAdmins } from "../../../helpers/notificationsHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { getPlayerStatsSummary } from "../../../helpers/playerStatsHelper";
import { isPremiumPlayerPackage, isUserPremiumPlayer } from "../../../helpers/packageHelper";
import { recordCoinTransaction } from "../../../helpers/coinLedgerHelper";
import { COIN_TRANSACTION_CATEGORY } from "../coinTransaction/coinTransaction.interface";
import { carryForwardPlayerStats } from "../../../helpers/playerTransferStatsHelper";

const createAdminToDB = async (payload: any): Promise<IUser> => {
  // check admin is exist or not;
  const isExistAdmin = await User.findOne({ email: payload.email });
  if (isExistAdmin) {
    throw new ApiError(StatusCodes.CONFLICT, "This Email already taken");
  }

  // create admin to db
  const createAdmin = await User.create(payload);
  if (!createAdmin) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create Admin");
  } else {
    await User.findByIdAndUpdate(
      { _id: createAdmin?._id },
      { verified: true },
      { new: true },
    );
  }

  return createAdmin;
};

const createUserToDB = async (payload: Partial<IUser>): Promise<IUser> => {
  if (payload.role === USER_ROLES.OTHER_CLUBS) {
    payload.marketValue = 0;
  }

  // Roles requiring Admin Approval: PLAYER, MANAGER, REFEREE, OTHER_CLUBS
  const rolesRequiringApproval = [
    USER_ROLES.PLAYER,
    USER_ROLES.MANAGER,
    USER_ROLES.REFEREE,
    USER_ROLES.OTHER_CLUBS,
  ];

  if (payload.role && rolesRequiringApproval.includes(payload.role as any)) {
    payload.status = "PENDING";
  } else {
    payload.status = "APPROVED";
  }

  const createUser = await User.create(payload);
  if (!createUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create user");
  }

  const otp = generateOTP();
  const recipientName = createUser.firstName
    ? `${createUser.firstName} ${createUser.lastName || ""}`.trim()
    : createUser.userName || createUser.email || "User";
  await EmailQueueHelper.sendWelcomeEmail(
    createUser.email!,
    recipientName,
    otp.toString(),
  );

  //save to DB
  const authentication = {
    oneTimeCode: otp,
    expireAt: new Date(Date.now() + 3 * 60000),
  };

  await User.findOneAndUpdate(
    { _id: createUser._id },
    { $set: { authentication } },
  );

  // 🔔 Notify all admins: new user registered
  // await sendNotificationToAdmins({
  //   title: "New User Registered",
  //   message: `A new user (${createUser.email}) has registered on the platform.`,
  //   type: NOTIFICATION_TYPE.USER_REGISTERED,
  //   metadata: {
  //     userId: createUser._id,
  //     email: createUser.email,
  //     role: createUser.role,
  //   },
  // });

  return createUser;
};

export const checkIsProfileCompleted = (user: any): boolean => {
  if (!user) return false;

  const role = user.role;

  if (role === USER_ROLES.MANAGER) {
    // Screen 2 details for Manager: Date of Birth, Team, DBS / 1st Aid Certificate Document
    const hasDob = Boolean(user.dateOfBirth);
    const hasTeam = Boolean(user.selectTeam);
    const hasDoc = Array.isArray(user.document)
      ? user.document.length > 0
      : Boolean(user.document);
    return hasDob && hasTeam && hasDoc;
  }

  if (role === USER_ROLES.REFEREE) {
    // Screen 2 details for Referee: Date of Birth, DBS / 1st Aid Certificate Document
    const hasDob = Boolean(user.dateOfBirth);
    const hasDoc = Array.isArray(user.document)
      ? user.document.length > 0
      : Boolean(user.document);
    return hasDob && hasDoc;
  }

  // if (role === USER_ROLES.PLAYER) {
  //   // Screen 2 details for Player: Date of Birth, selectTeam or position
  //   const hasDob = Boolean(user.dateOfBirth);
  //   const hasTeamOrPos = Boolean(user.selectTeam || user.position);
  //   return hasDob && hasTeamOrPos;
  // }

  return Boolean(user.firstName && user.lastName && user.email);
};

const getUserProfileFromDB = async (user: JwtPayload) => {
  const id = user?._id;

  if (!id) {
    return null;
  }

  const isExistUser = await User.findById(id);

  if (!isExistUser) {
    return null;
  }

  // user details are merged into user
  const userDetails = isExistUser;

  // active subscription (always latest active)
  const subscription = await Subscription.findOne({
    user: id,
    status: "active",
  })
    .sort({ createdAt: -1 })
    .populate("package");

  const isDetailsSubmitted = checkIsProfileCompleted(isExistUser);
  const pkg: any = subscription?.package;
  const isPremium = await isPremiumPlayerPackage(pkg);

  return {
    _id: isExistUser._id,
    email: isExistUser.email,
    userName: isExistUser.userName,
    profile: isExistUser.profile,
    role: isExistUser.role,
    jerseyNumber: isExistUser.jerseyNumber || null,
    firstName: userDetails?.firstName || null,
    lastName: userDetails?.lastName || null,
    dateOfBirth: isExistUser.dateOfBirth || null,
    selectTeam: isExistUser.selectTeam || null,
    document: isExistUser.document || [],
    phone: isExistUser.phone || null,
    status: userDetails?.status || "PENDING",
    permissions: isExistUser.permissions || [],

    // Coin & Market Value: Only visible if user has an active Professional/Premium plan
    engCoine: isPremium ? (isExistUser.engCoine || 0) : null,
    marketValue: isPremium ? (isExistUser.marketValue || 0) : null,
    isPremium,
    isSubscribed: Boolean(subscription || isExistUser.isSubscribed),
    hasAccess: Boolean(subscription || isExistUser.hasAccess),

    // ✅ Screen 2 profile details completion status
    isDetailsSubmitted,

    subscription: subscription
      ? {
          _id: subscription._id,
          price: subscription.price,
          trxId: subscription.trxId,
          subscriptionId: subscription.subscriptionId,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          remaining: subscription.remaining,
          status: subscription.status,

          package: subscription.package,
        }
      : false,
  };
};

const updateChieldInfoToDB = async (id: string, payload: any) => {
  const isExistUser = await User.findById(id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Child user not found");
  }

  // Clean up empty string / invalid ObjectId fields like selectTeam or parentId
  if ("selectTeam" in payload) {
    if (
      !payload.selectTeam ||
      payload.selectTeam === "" ||
      payload.selectTeam === "null" ||
      !Types.ObjectId.isValid(payload.selectTeam)
    ) {
      payload.selectTeam = null;
    }
  }

  if ("parentId" in payload) {
    if (
      !payload.parentId ||
      payload.parentId === "" ||
      payload.parentId === "null" ||
      !Types.ObjectId.isValid(payload.parentId)
    ) {
      delete payload.parentId;
    }
  }

  // If document files were uploaded in this request:
  // If payload.document is empty (no new file uploaded), keep existing documents.
  // If new files were uploaded, replace old documents and unlink old files from disk.
  if (Array.isArray(payload.document)) {
    if (payload.document.length === 0) {
      delete payload.document;
    } else if (
      payload.document.length > 0 &&
      Array.isArray(isExistUser.document)
    ) {
      isExistUser.document.forEach((oldDoc: string) => {
        if (oldDoc && !payload.document.includes(oldDoc)) {
          unlinkFile(oldDoc);
        }
      });
    }
  }

  if (payload.profile && isExistUser.profile) {
    unlinkFile(isExistUser.profile);
  }

  // If user status is REJECTED, change back to PENDING and clear rejectionReason
  if (isExistUser.status === "REJECTED") {
    payload.status = "PENDING";
    payload.rejectionReason = "";
  }

  const result = await User.findByIdAndUpdate(
    id,
    { $set: payload },
    { new: true, runValidators: true },
  );

  if (payload.selectTeam) {
    await carryForwardPlayerStats(id, payload.selectTeam);
  }

  return result;
};

const updateProfileToDB = async (
  user: JwtPayload,
  payload: Partial<IUser>,
): Promise<Partial<IUser | null>> => {
  const { _id } = user;
  const isExistUser = await User.isExistUserById(_id);
  if (!isExistUser) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User doesn't exist!");
  }

  //unlink file here
  if (payload.profile) {
    unlinkFile(isExistUser.profile);
  }
  if (!payload.profile) {
    delete payload.profile;
  }
  // if (Array.isArray(payload.document)) {
  //   payload.document = [...isExistUser.document, ...payload.document];
  // }

  const updateDoc = await User.findOneAndUpdate({ _id: _id }, payload, {
    new: true,
  });
  return updateDoc;
};

const createPlayerToDB = async (payload: any) => {
  // Find the user to get their role
  const user = await User.findById(payload.userId);
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found");

  if (
    user.role === USER_ROLES.OTHER_CLUBS ||
    payload.role === USER_ROLES.OTHER_CLUBS
  ) {
    payload.marketValue = 0;
  } else {
    const pe = await PlayerEconomy.findOne();
    if (payload.marketValue === undefined) {
      payload.marketValue = pe ? pe.startingMarketValue : 100000;
    }
    if (payload.engCoine === undefined) {
      const rate = Number(pe?.conversionRate) || 10;
      const startMV = Number(pe?.startingMarketValue) || 100000;
      payload.engCoine = Number(pe?.startingCoins) || (rate > 0 ? Math.round(startMV / rate) : 10000);
    }
  }

  const result = await User.findOneAndUpdate({ _id: payload.userId }, payload, {
    new: true,
    runValidators: true,
  });

  if (!result) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to create player");
  }

  const role = user?.role || "USER";

  // 🔔 Notify all admins: new player/referee/manager/club profile created
  await sendNotificationToAdmins({
    title: `New ${role} Profile Submitted`,
    message: `A ${role.toLowerCase()} (${result.firstName} ${result.lastName}) has submitted their profile for review.`,
    type: NOTIFICATION_TYPE.PLAYER_PROFILE_CREATED,
    metadata: {
      userId: payload.userId,
      role: role,
    },
  });

  return result;
};

const updatePlayerByUserId = async (userId: string, payload: any) => {
  const isExist = await User.findById(userId);

  if (!isExist) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player not found");
  }

  if ("selectTeam" in payload) {
    if (
      !payload.selectTeam ||
      payload.selectTeam === "" ||
      payload.selectTeam === "null" ||
      !Types.ObjectId.isValid(payload.selectTeam)
    ) {
      payload.selectTeam = null;
    }
  }

  // If document files were uploaded in this request:
  // If payload.document is empty (no new file uploaded), keep existing documents.
  // If new files were uploaded, replace old documents and unlink old files from disk.
  if (Array.isArray(payload.document)) {
    if (payload.document.length === 0) {
      delete payload.document;
    } else if (payload.document.length > 0 && Array.isArray(isExist.document)) {
      isExist.document.forEach((oldDoc: string) => {
        if (oldDoc && !payload.document.includes(oldDoc)) {
          unlinkFile(oldDoc);
        }
      });
    }
  }

  // If user status is REJECTED, change back to PENDING and clear rejectionReason
  if (isExist.status === "REJECTED") {
    payload.status = "PENDING";
    payload.rejectionReason = "";
  }

  const result = await User.findByIdAndUpdate(userId, payload, {
    new: true,
    runValidators: true,
  });

  if (payload.selectTeam) {
    await carryForwardPlayerStats(userId, payload.selectTeam);
  }

  return result;
};

const getPlayerByUserId = async (userId: string) => {
  const [result, activeSub, stats] = await Promise.all([
    User.findById(userId)
      .populate({
        path: "selectTeam",
        select: "teamName shortName teamLogo",
      })
      .lean(),
    Subscription.findOne({
      user: userId,
      status: "active",
    })
      .sort({ createdAt: -1 })
      .populate("package")
      .lean(),
    getPlayerStatsSummary(userId),
  ]);

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player not found");
  }

  const isDetailsSubmitted = checkIsProfileCompleted(result);
  const pkg: any = activeSub?.package;
  const isPremium = await isPremiumPlayerPackage(pkg);

  return {
    ...result,
    userId: result._id,
    jerseyNumber: result.jerseyNumber || null,
    activeSubscription: activeSub || null,
    activePackage: activeSub?.package || null,
    isPremium,
    isSubscribed: Boolean(activeSub || result.isSubscribed),
    hasAccess: Boolean(activeSub || result.hasAccess),
    isPaid: Boolean(activeSub || result.isSubscribed || result.hasAccess),
    engCoine: isPremium ? (result.engCoine || 0) : null,
    marketValue: isPremium ? (result.marketValue || 0) : null,

    stats: {
      goals: stats.goals,
      assists: stats.assists,
      cleanSheets: stats.cleanSheets,
      playerOfTheDay: stats.playerOfTheDay,
      yellowCards: stats.yellowCards,
      redCards: stats.redCards,
      totalMatches: stats.totalMatches,
      matchesPlayed: stats.matchesPlayed,
    },
    isDetailsSubmitted,
    isProfileCompleted: isDetailsSubmitted,
    isCompleted: isDetailsSubmitted,
    isDetailsCompleted: isDetailsSubmitted,
  };
};

const getManagerByUserId = async (userId: string) => {
  const [result, managerTeams] = await Promise.all([
    User.findById(userId)
      .populate("selectTeam", "teamName shortName teamLogo ageGroup")
      .lean(),
    ManagerTeam.find({ manager: userId })
      .populate("team", "teamName shortName teamLogo ageGroup city")
      .lean(),
  ]);

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Manager not found");
  }

  const isDetailsSubmitted = checkIsProfileCompleted(result);
  const managedTeams = managerTeams.map((mt: any) => mt.team).filter(Boolean);

  return {
    ...result,
    userId: result._id,
    managedTeams,
    totalManagedTeams: managedTeams.length,
    selectTeam: managedTeams[0] || result.selectTeam || null,
    isDetailsSubmitted,
    isProfileCompleted: isDetailsSubmitted,
    isCompleted: isDetailsSubmitted,
    isDetailsCompleted: isDetailsSubmitted,
  };
};

const getRefereeByUserId = async (userId: string) => {
  const result = await User.findById(userId).lean();

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Referee not found");
  }

  const isDetailsSubmitted = checkIsProfileCompleted(result);

  return {
    ...result,
    userId: result?._id,
    isDetailsSubmitted,
    isProfileCompleted: isDetailsSubmitted,
    isCompleted: isDetailsSubmitted,
    isDetailsCompleted: isDetailsSubmitted,
  };
};

const getOtherClubByUserId = async (userId: string) => {
  const result = await User.findById(userId).lean();

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Other club not found");
  }

  return { ...result, userId: result?._id };
};

const getPlayerDetailsByUserId = async (userId: string) => {
  const [result, activeSub, stats] = await Promise.all([
    User.findById(userId)
      .populate({
        path: "selectTeam",
        select: "teamName shortName teamLogo _id",
      })
      .lean(),
    Subscription.findOne({
      user: userId,
      status: "active",
    })
      .sort({ createdAt: -1 })
      .populate("package")
      .lean(),
    getPlayerStatsSummary(userId),
  ]);

  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player/User not found");
  }

  const teamData: any = result.selectTeam;
  const pkg: any = activeSub?.package;
  const isPremium = await isPremiumPlayerPackage(pkg);

  return {
    ...result,
    userId: result._id,
    selectTeam: teamData?.teamName || null,
    selectTeamId: teamData?._id || null,
    teamDetails: teamData || null,
    activeSubscription: activeSub || null,
    activePackage: activeSub?.package || null,
    isPremium,
    isSubscribed: Boolean(activeSub || result.isSubscribed),
    hasAccess: Boolean(activeSub || result.hasAccess),
    isPaid: Boolean(activeSub || result.isSubscribed || result.hasAccess),
    engCoine: isPremium ? (result.engCoine || 0) : null,
    marketValue: isPremium ? (result.marketValue || 0) : null,
    stats: {
      goals: stats.goals,
      assists: stats.assists,
      cleanSheets: stats.cleanSheets,
      playerOfTheDay: stats.playerOfTheDay,
      yellowCards: stats.yellowCards,
      redCards: stats.redCards,
      totalMatches: stats.totalMatches,
      matchesPlayed: stats.matchesPlayed,
    },
  };
};

const getOtherClubByUserIdUserId = getPlayerDetailsByUserId;

// UPDATE USER COIN OR MARKET VALUE (Admin only)
const updateUserCoinOrMarketValue = async (
  userId: string,
  payload: { engCoine?: number; marketValue?: number },
) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updateData: Record<string, number> = {};
  const isPlayer = user.role === USER_ROLES.PLAYER || Boolean(user.parentId);
  const isPro = isPlayer ? await isUserPremiumPlayer(userId) : true;

  // Dynamic player economy configuration from DB
  const pe = await PlayerEconomy.findOne();
  const conversionRate = pe?.conversionRate ?? 10;
  const minFloorMV = Number(pe?.startingMarketValue) || 10000000;
  const minFloorCoin = Number(pe?.startingCoins) || (conversionRate > 0 ? Math.round(minFloorMV / conversionRate) : 10000);

  if (payload.engCoine !== undefined) {
    if (typeof payload.engCoine !== "number" || payload.engCoine < 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "engCoine must be a non-negative number",
      );
    }

    let targetCoin = payload.engCoine;
    if (isPlayer) {
      if (isPro) {
        // Professional player floor: dynamic from PlayerEconomy config
        targetCoin = Math.max(minFloorCoin, payload.engCoine);
      } else {
        // Non-professional players have no coin access, force 0
        targetCoin = 0;
      }
    }

    const currentCoin = Number(user.engCoine) || 0;
    const delta = targetCoin - currentCoin;
    if (delta !== 0) {
      await recordCoinTransaction({
        userId,
        amount: delta,
        category: COIN_TRANSACTION_CATEGORY.ADMIN_ADJUSTMENT,
        title: "Admin Coin Adjustment",
        description:
          delta > 0
            ? `Admin credited ${delta.toLocaleString()} ENG Coins`
            : `Admin deducted ${Math.abs(delta).toLocaleString()} ENG Coins`,
        syncMarketValue: payload.marketValue === undefined,
      });
    }

    if (payload.marketValue === undefined) {
      updateData.marketValue = targetCoin * conversionRate;
    }
  }

  if (payload.marketValue !== undefined) {
    if (typeof payload.marketValue !== "number" || payload.marketValue < 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "marketValue must be a non-negative number",
      );
    }

    if (isPlayer) {
      if (isPro) {
        updateData.marketValue = Math.max(minFloorMV, payload.marketValue);
      } else {
        updateData.marketValue = 0;
      }
    } else {
      updateData.marketValue = payload.marketValue;
    }
  }

  if (Object.keys(updateData).length > 0) {
    return await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, runValidators: true },
    );
  }

  return await User.findById(userId);
};

// APPROVE OR REJECT USER (Admin only)
const approveOrRejectUser = async (
  adminRole: string,
  userId: string,
  status: "APPROVED" | "REJECTED",
  rejectionReason?: string,
) => {
  // Only ADMIN and SUPER_ADMIN can perform this
  const allowedAdminRoles = ["ADMIN", "SUPER_ADMIN"];
  if (!allowedAdminRoles.includes(adminRole)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only admins can approve or reject users",
    );
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  // Only these roles need approval
  const rolesRequiringApproval = [
    USER_ROLES.PLAYER,
    USER_ROLES.OTHER_CLUBS,
    USER_ROLES.MANAGER,
    USER_ROLES.REFEREE,
    USER_ROLES.TOURNAMENT_PLAYER,
  ];
  if (!rolesRequiringApproval.includes(user.role)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Only PLAYER, MANAGER, REFEREE and OTHER_CLUBS accounts require approval. This user is a ${user.role}.`,
    );
  }

  const updateFields: Record<string, any> = { status };
  if (status === "REJECTED") {
    updateFields.rejectionReason =
      rejectionReason || "Profile did not meet verification criteria.";
  } else if (status === "APPROVED") {
    updateFields.rejectionReason = "";
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true },
  );

  // ⚽ AUTO-ASSIGN MANAGER TO TEAM ON APPROVAL
  if (
    status === "APPROVED" &&
    user.role === USER_ROLES.MANAGER &&
    user.selectTeam
  ) {
    await ManagerTeam.findOneAndUpdate(
      { team: user.selectTeam },
      {
        manager: user._id,
        team: user.selectTeam,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      },
    );
  }

  // Fetch active subscription for user
  const activeSub = await Subscription.findOne({
    user: user._id,
    status: "active",
  } as any)
    .sort({ createdAt: -1 })
    .populate("package");

  const updatedObj = updated?.toObject ? updated.toObject() : updated;

  return {
    ...updatedObj,
    activeSubscription: activeSub || null,
    activePackage: activeSub?.package || null,
    isPaid: Boolean(activeSub),
  };
};

// TOGGLE BLUE TICK VERIFICATION FOR USER (Admin only)
const toggleBlueTickUser = async (userId: string, blueTick: boolean) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { blueTick } },
    { new: true },
  );

  return updated;
};

export const UserService = {
  createUserToDB,
  getUserProfileFromDB,
  updateProfileToDB,
  createAdminToDB,
  createPlayerToDB,
  updatePlayerByUserId,
  getPlayerByUserId,
  getManagerByUserId,
  getRefereeByUserId,
  getOtherClubByUserId,
  getOtherClubByUserIdUserId,
  getPlayerDetailsByUserId,
  updateUserCoinOrMarketValue,
  approveOrRejectUser,
  toggleBlueTickUser,
  updateChieldInfoToDB,
};
