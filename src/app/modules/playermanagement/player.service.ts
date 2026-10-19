import QueryBuilder from "../../../util/queryBuilder";
import { User } from "../user/user.model";
import { USER_ROLES } from "../../../enums/user";
import { Subscription } from "../subscription/subscription.model";
import { JwtPayload } from "jsonwebtoken";
import ApiError from "../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import { Types } from "mongoose";
import { NotificationQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";
import { sendNotificationToAdmins } from "../../../helpers/notificationsHelper";
import { PlayerDashboardService } from "../playerDashboard/playerDashboard.service";
import { isPremiumPlayerPackage } from "../../../helpers/packageHelper";
import { getBatchPlayerStatsSummary } from "../../../helpers/playerStatsHelper";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";

const checkCanViewOtherPlayers = async (
  user?: JwtPayload | null,
): Promise<boolean> => {
  if (!user || user.role !== USER_ROLES.PLAYER) return true;

  const userId = user._id || user.id;

  const subscription = await Subscription.findOne({
    user: userId,
    status: "active",
  })
    .sort({ createdAt: -1 })
    .populate("package");

  if (subscription && subscription.package) {
    const pkg = subscription.package as any;
    if (pkg.canViewOtherPlayers === false || pkg.packageType === "Semi Pro") {
      return false;
    }
  }
  return true;
};

// ========================== PARENT PLAYER MANAGEMENT ==========================

// 1. CREATE PLAYER BY PARENT
const createPlayerByParentToDB = async (parentId: string, payload: any) => {
  const parentUser = await User.findById(parentId);
  if (!parentUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Parent account not found");
  }

  // Calculate market value dynamically based on PlayerEconomy conversionRate
  const pe = await PlayerEconomy.findOne();
  const rate = pe?.conversionRate ?? 10;
  const coins = Number(payload.engCoine) || 0;
  const marketValue = payload.marketValue !== undefined ? Number(payload.marketValue) : coins * rate;

  const parseBool = (val: any) =>
    val === true || val === "true" || val === 1 || val === "1";

  let teamId: Types.ObjectId | null = null;
  if (payload.selectTeam && Types.ObjectId.isValid(payload.selectTeam)) {
    teamId = new Types.ObjectId(payload.selectTeam);
  }
  const playerData: any = {
    ...payload,
    parentId: new Types.ObjectId(parentId),
    role: parentUser.role || USER_ROLES.PLAYER,
    status: "PENDING",
    verified: true,
    engCoine: coins,
    marketValue: marketValue,
    emergencyEmail: payload.emergencyEmail || payload.email || "",
    emergencyPhone:
      payload.emergencyPhone || payload.phone || payload.phoneNumber || "",
    isDevelopmentPlayer: parseBool(payload.isDevelopmentPlayer),
    playForAcademy: parseBool(payload.playForAcademy),
    mediaConsent: parseBool(payload.mediaConsent),
    selectTeam: teamId,
    dateOfBirth: payload.dateOfBirth
      ? new Date(payload.dateOfBirth)
      : undefined,
    password: null, // PLAYER HAS NO LOGIN
  };

  // Omit email field completely from child player document to prevent MongoDB index conflicts
  delete playerData.email;

  const newPlayer = await User.create(playerData);

  // Notify admins about new pending player registration
  try {
    await sendNotificationToAdmins({
      title: "New Player Profile Submitted",
      message: `A new player profile (${newPlayer.firstName} ${newPlayer.lastName}) has been added by parent (${parentUser.email}) and is pending approval.`,
      type: NOTIFICATION_TYPE.USER_REGISTERED,
      metadata: {
        playerId: newPlayer._id,
        parentId: parentUser._id,
      },
    });
  } catch (err) {
    console.error("Failed to notify admins of new player registration", err);
  }

  return newPlayer;
};

export const getMyPlayersFromDB = async (parentId: string) => {
  const parentStrId = parentId.toString();
  const parentObjId = Types.ObjectId.isValid(parentStrId)
    ? new Types.ObjectId(parentStrId)
    : null;

  const players = await User.find({
    $or: [
      { parentId: parentStrId },
      ...(parentObjId ? [{ parentId: parentObjId }] : []),
    ],
  })
    .populate("selectTeam", "teamName shortName teamLogo")
    .lean();

  if (!players.length) {
    return [];
  }

  const playerIds = players.map((player) => player._id);

  const [subscriptions, statsMap] = await Promise.all([
    Subscription.find({
      user: { $in: playerIds },
      status: "active",
    })
      .sort({ createdAt: -1 })
      .populate("package")
      .lean(),
    getBatchPlayerStatsSummary(playerIds),
  ]);

  const subscriptionMap = new Map();
  subscriptions.forEach((sub: any) => {
    const uId = sub.user?.toString();
    if (uId && !subscriptionMap.has(uId)) {
      subscriptionMap.set(uId, sub);
    }
  });

  return Promise.all(
    players.map(async (player) => {
      const activeSubscription = subscriptionMap.get(player._id.toString()) || null;
      const pkg = activeSubscription?.package;
      const isPremium = await isPremiumPlayerPackage(pkg);

      const playerStats = statsMap.get(player._id.toString()) || {
        goals: 0,
        assists: 0,
        cleanSheets: 0,
        playerOfTheDay: 0,
        yellowCards: 0,
        redCards: 0,
        totalMatches: 0,
        matchesPlayed: 0,
      };

      return {
        ...player,
        isSubscribed: Boolean(activeSubscription || player.isSubscribed),
        hasAccess: Boolean(activeSubscription || player.hasAccess),
        isPaid: Boolean(activeSubscription || player.isSubscribed || player.hasAccess),
        activeSubscription: activeSubscription || null,
        activePackage: activeSubscription?.package || null,
        isPremium: Boolean(isPremium),
        stats: playerStats,
      };
    })
  );
};

const getPlayerByIdFromDB = async (parentId: string, playerId: string) => {
  const parentStrId = parentId.toString();
  const parentObjId = Types.ObjectId.isValid(parentStrId)
    ? new Types.ObjectId(parentStrId)
    : null;
  const playerObjId = Types.ObjectId.isValid(playerId)
    ? new Types.ObjectId(playerId)
    : playerId;

  const player = await User.findOne({
    $and: [
      {
        $or: [{ _id: playerObjId }, { _id: playerId }],
      },
      {
        $or: [
          { parentId: parentStrId },
          ...(parentObjId ? [{ parentId: parentObjId }] : []),
        ],
      },
    ],
  })
    .populate("selectTeam", "teamName shortName teamLogo")
    .lean();

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
  }

  const [activeSubscription, stats] = await Promise.all([
    Subscription.findOne({
      user: player._id,
      status: "active",
    } as any)
      .sort({ createdAt: -1 })
      .populate("package")
      .lean(),

    PlayerDashboardService.getPlayerDashboardFromDB(player._id.toString()),
  ]);

  const pkg: any = activeSubscription?.package;
  const isPremium = await isPremiumPlayerPackage(pkg);

  return {
    ...player,
    isSubscribed: Boolean(activeSubscription || player.isSubscribed),
    hasAccess: Boolean(activeSubscription || player.hasAccess),
    isPaid: Boolean(activeSubscription || player.isSubscribed || player.hasAccess),
    engCoine: isPremium ? player.engCoine || 0 : null,
    marketValue: isPremium ? player.marketValue || 0 : null,
    activeSubscription: activeSubscription || null,
    activePackage: activeSubscription?.package || null,
    isPremium,
    stats: isPremium ? stats.stats : null,
  };
};

// 4. UPDATE PLAYER BY PARENT (WITH OWNERSHIP CHECK)
const updatePlayerByParentToDB = async (
  parentId: string,
  playerId: string,
  payload: any,
) => {
  const player = await User.findById(playerId);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
  }

  if (!player.parentId || player.parentId.toString() !== parentId.toString()) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not authorized to update this player profile",
    );
  }

  // Recalculate market value if engCoine is updated and marketValue not explicitly provided
  if (payload.engCoine !== undefined && payload.marketValue === undefined) {
    const pe = await PlayerEconomy.findOne();
    const rate = pe?.conversionRate ?? 10;
    payload.marketValue = Number(payload.engCoine) * rate;
  }

  // If player was REJECTED, resubmitting updates resets status to PENDING for admin review
  if (player.status === "REJECTED") {
    payload.status = "PENDING";
    payload.rejectionReason = "";
  }

  const updatedPlayer = await User.findByIdAndUpdate(playerId, payload, {
    new: true,
    runValidators: true,
  }).populate("selectTeam", "teamName shortName teamLogo");

  return updatedPlayer;
};

// 5. DELETE PLAYER BY PARENT (WITH OWNERSHIP CHECK)
const deletePlayerByParentToDB = async (parentId: string, playerId: string) => {
  const player = await User.findById(playerId);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
  }

  if (!player.parentId || player.parentId.toString() !== parentId.toString()) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not authorized to delete this player profile",
    );
  }

  return await User.findByIdAndDelete(playerId);
};

// ========================== ADMIN PLAYER APPROVAL ==========================

// 6. GET ALL PENDING PLAYERS FOR ADMIN REVIEW
const getPendingPlayersForAdminFromDB = async (query: Record<string, any>) => {
  const baseQuery = User.find({
    role: USER_ROLES.PLAYER,
    status: "PENDING",
  })
    .populate("parentId", "firstName lastName email phone")
    .populate("selectTeam", "teamName shortName teamLogo");

  const queryBuilder = new QueryBuilder(baseQuery, query)
    .search(["firstName", "lastName", "position", "ageGroup"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const rawResult = await queryBuilder.modelQuery;
  const meta = await queryBuilder.getPaginationInfo();

  const playerUserIds = rawResult.map((p: any) => p._id);

  const activeSubs = await Subscription.find({
    user: { $in: playerUserIds },
    status: "active",
  }).populate("package");

  const subMap = new Map();
  activeSubs.forEach((sub: any) => subMap.set(sub.user.toString(), sub));

  const result = rawResult.map((p: any) => {
    const playerObj = p.toObject ? p.toObject() : p;
    const directSub = subMap.get(playerObj._id?.toString());
    const activeSub = directSub || null;

    return {
      ...playerObj,
      activeSubscription: activeSub || null,
      activePackage: activeSub?.package || null,
      isPaid: Boolean(activeSub),
    };
  });

  return {
    meta,
    result,
  };
};

// 7. APPROVE PLAYER BY ADMIN
const approvePlayerByAdminToDB = async (playerId: string) => {
  const player = await User.findById(playerId);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
  }

  const updatedPlayer = await User.findByIdAndUpdate(
    playerId,
    { $set: { status: "APPROVED", rejectionReason: "" } },
    { new: true },
  ).populate("parentId", "firstName lastName email phone");

  // Send notification to Parent
  if (player.parentId) {
    try {
      await NotificationQueueHelper.sendNotification(
        player.parentId.toString(),
        `Great news! Player profile for "${player.firstName} ${player.lastName}" has been approved by admin. You can now register for products and events.`,
        "Player Profile Approved",
        NOTIFICATION_TYPE.PLAYER_APPROVED,
      );
    } catch (err) {
      console.error("Failed to send player approval notification", err);
    }
  }

  const activeSub = await Subscription.findOne({
    user: player._id,
    status: "active",
  })
    .sort({ createdAt: -1 })
    .populate("package");

  const playerObj = updatedPlayer?.toObject
    ? updatedPlayer.toObject()
    : updatedPlayer;

  return {
    ...playerObj,
    activeSubscription: activeSub || null,
    activePackage: activeSub?.package || null,
    isPaid: Boolean(activeSub),
  };
};

// 8. REJECT PLAYER BY ADMIN
const rejectPlayerByAdminToDB = async (playerId: string, reason?: string) => {
  const player = await User.findById(playerId);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
  }

  const rejectionReason =
    reason || "Profile did not meet verification criteria.";

  const updatedPlayer = await User.findByIdAndUpdate(
    playerId,
    { $set: { status: "REJECTED", rejectionReason } },
    { new: true },
  ).populate("parentId", "firstName lastName email phone");

  // Send notification to Parent
  if (player.parentId) {
    try {
      await NotificationQueueHelper.sendNotification(
        player.parentId.toString(),
        `Player profile for "${player.firstName} ${player.lastName}" was rejected. Reason: ${rejectionReason}`,
        "Player Profile Rejected",
        NOTIFICATION_TYPE.PLAYER_REJECTED,
      );
    } catch (err) {
      console.error("Failed to send player rejection notification", err);
    }
  }

  const activeSub = await Subscription.findOne({
    user: player._id,
    status: "active",
  } as any)
    .sort({ createdAt: -1 })
    .populate("package");

  const playerObj = updatedPlayer?.toObject
    ? updatedPlayer.toObject()
    : updatedPlayer;

  return {
    ...playerObj,
    activeSubscription: activeSub || null,
    activePackage: activeSub?.package || null,
    isPaid: Boolean(activeSub),
  };
};

// ========================== EXISTING PLAYER QUERIES ==========================

const getAllPlayersFromDB = async (
  query: Record<string, any>,
  user?: JwtPayload | null,
) => {
  const canViewOther = await checkCanViewOtherPlayers(user);
  const queryObj = { ...query };

  // 1. Get user IDs with active subscriptions
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  // 2. Base Player Filter:
  // - MUST be a player profile belonging to a parent (parentId is NOT null)
  // - MUST be paid (active subscription on player, or isSubscribed/hasAccess is true)
  const andConditions: any[] = [
    {
      role: {
        $in: [
          USER_ROLES.PLAYER,
          USER_ROLES.OTHER_CLUBS,
          USER_ROLES.TOURNAMENT_PLAYER,
        ],
      },
    },
    { parentId: { $exists: true, $ne: null } },
    {
      $or: [
        { _id: { $in: activeSubUserIds } },
        { isSubscribed: true },
        { hasAccess: true },
      ],
    },
    { status: "APPROVED" },
  ];

  const rawSearch = (queryObj.searchTerm ||
    queryObj.searchValue ||
    queryObj.search) as string;
  if (rawSearch && rawSearch.trim()) {
    const searchRegex = new RegExp(rawSearch.trim(), "i");
    const nameParts = rawSearch.trim().split(/\s+/);

    const $orConditions: any[] = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { userName: searchRegex },
      { email: searchRegex },
      { position: searchRegex },
      { ageGroup: searchRegex },
      { location: searchRegex },
      { emergencyEmail: searchRegex },
      { phone: searchRegex },
    ];

    if (nameParts.length > 1) {
      $orConditions.push({
        $expr: {
          $regexMatch: {
            input: {
              $concat: [
                { $ifNull: ["$firstName", ""] },
                " ",
                { $ifNull: ["$lastName", ""] },
              ],
            },
            regex: rawSearch.trim().replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"),
            options: "i",
          },
        },
      });
    }

    andConditions.push({ $or: $orConditions });
    delete queryObj.searchTerm;
    delete queryObj.searchValue;
    delete queryObj.search;
  }

  if (queryObj.role && queryObj.role !== "ALL") {
    andConditions.push({ role: queryObj.role });
    delete queryObj.role;
  }

  if (queryObj.ageGroup && queryObj.ageGroup !== "ALL") {
    const cleanedAge = queryObj.ageGroup
      .replace(/^U-/i, "")
      .replace(/^U/i, "")
      .trim();
    andConditions.push({
      $or: [
        { ageGroup: { $regex: new RegExp(queryObj.ageGroup, "i") } },
        { ageGroup: { $regex: new RegExp(`Under ${cleanedAge}`, "i") } },
      ],
    });
    delete queryObj.ageGroup;
  }

  if (queryObj.position && queryObj.position !== "ALL") {
    andConditions.push({
      position: { $regex: new RegExp(queryObj.position, "i") },
    });
    delete queryObj.position;
  }

  if (
    (queryObj.selectTeam || queryObj.teamId || queryObj.team) &&
    queryObj.selectTeam !== "ALL" &&
    queryObj.teamId !== "ALL" &&
    queryObj.team !== "ALL"
  ) {
    const tId = queryObj.selectTeam || queryObj.teamId || queryObj.team;
    if (Types.ObjectId.isValid(tId)) {
      andConditions.push({ selectTeam: new Types.ObjectId(tId) });
    }
  }

  if (!canViewOther && user) {
    andConditions.push({ _id: user._id || user.id });
  }

  // Dynamic Sorting
  let sortOption: any = { createdAt: -1 };
  const sortParam = queryObj.sort || queryObj.sortBy || queryObj.sortOrder;
  if (
    sortParam === "name_asc" ||
    sortParam === "name-asc" ||
    sortParam === "a-z"
  ) {
    sortOption = { firstName: 1, lastName: 1 };
  } else if (
    sortParam === "name_desc" ||
    sortParam === "name-desc" ||
    sortParam === "z-a"
  ) {
    sortOption = { firstName: -1, lastName: -1 };
  } else if (sortParam === "oldest" || sortParam === "createdAt_asc") {
    sortOption = { createdAt: 1 };
  } else if (sortParam === "newest" || sortParam === "createdAt_desc") {
    sortOption = { createdAt: -1 };
  } else if (sortParam === "coins_desc" || sortParam === "coins-desc") {
    sortOption = { engCoine: -1 };
  } else if (sortParam === "coins_asc" || sortParam === "coins-asc") {
    sortOption = { engCoine: 1 };
  }

  const { page = 1, limit = 10, pageNumber, userPage } = queryObj;
  const pageNum = Number(pageNumber || userPage || page) || 1;
  const limitNum = Number(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const finalFilter = { $and: andConditions };

  const [rawPlayers, total] = await Promise.all([
    User.find(finalFilter)
      .populate({
        path: "selectTeam",
        select: "teamName shortName teamLogo",
      })
      .populate({
        path: "parentId",
        select: "firstName lastName email phone userName profile",
      })
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    User.countDocuments(finalFilter),
  ]);

  const playerUserIds = rawPlayers.map((p: any) => p._id);

  const activePlayerSubs = await Subscription.find({
    user: { $in: playerUserIds },
    status: "active",
  }).populate("package");

  const subMap = new Map();
  activePlayerSubs.forEach((sub: any) => {
    subMap.set(sub.user.toString(), sub);
  });

  const players = rawPlayers.map((player: any) => {
    const directSub = subMap.get(player._id?.toString());
    const activeSub = directSub || null;

    return {
      _id: player._id,
      firstName: player.firstName,
      lastName: player.lastName,
      userName:
        player.userName ||
        `${player.firstName || ""} ${player.lastName || ""}`.trim(),
      name:
        `${player.firstName || ""} ${player.lastName || ""}`.trim() ||
        player.userName,
      email: player.email || player.emergencyEmail || null,
      phone: player.phone || null,
      role: player.role || "PLAYER",
      position: player.position || null,
      strongFoot: player.strongFoot || null,
      ageGroup: player.ageGroup || null,
      dateOfBirth: player.dateOfBirth || null,
      location: player.location || null,
      previousClub: player.previousClub || null,
      playForAcademy: player.playForAcademy || null,
      academyClubName: player.academyClubName || null,
      isDevelopmentPlayer: player.isDevelopmentPlayer || false,
      emergencyEmail: player.emergencyEmail || null,
      emergencyPhone: player.emergencyPhone || null,
      mediaConsent: player.mediaConsent || false,
      document: player.document || [],
      rejectionReason: player.rejectionReason || null,
      engCoine: player.engCoine || 0,
      coin: player.engCoine || 0,
      marketValue: player.marketValue ?? 0,
      profile: player.profile || null,
      profilePic: player.profile || null,
      status: player.status || "PENDING",
      verified: player.verified ?? true,
      parentId: player.parentId || null,
      teamName: player.selectTeam?.teamName || null,
      shortName: player.selectTeam?.shortName || null,
      teamLogo: player.selectTeam?.teamLogo || null,
      selectTeam: player.selectTeam || null,
      createdAt: player.createdAt,
      isPaid: Boolean(activeSub),
      subscription: activeSub
        ? {
            _id: activeSub._id,
            status: activeSub.status,
            price: activeSub.price,
            trxId: activeSub.trxId,
            subscriptionId: activeSub.subscriptionId,
            currentPeriodStart: activeSub.currentPeriodStart,
            currentPeriodEnd: activeSub.currentPeriodEnd,
            packageName:
              (activeSub.package as any)?.title ||
              (activeSub.package as any)?.name ||
              "ENG Subscription",
            packageDetails: activeSub.package || null,
          }
        : null,
    };
  });

  return {
    players,
    pagination: {
      total,
      limit: limitNum,
      page: pageNum,
      totalPage: Math.ceil(total / limitNum) || 1,
    },
  };
};

// DEDICATED PLAYER OVERVIEW / ANALYTICS
const getPlayerOverviewFromDB = async () => {
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  const baseFilter: any = {
    role: {
      $in: [
        USER_ROLES.PLAYER,
        USER_ROLES.OTHER_CLUBS,
        USER_ROLES.TOURNAMENT_PLAYER,
      ],
    },
    parentId: { $exists: true, $ne: null },
    $or: [
      { _id: { $in: activeSubUserIds } },
      { isSubscribed: true },
      { hasAccess: true },
    ],
    status: "APPROVED",
  };

  const [totalPlayers, assignedToSquads, stats] = await Promise.all([
    User.countDocuments(baseFilter),
    User.countDocuments({
      ...baseFilter,
      selectTeam: { $exists: true, $ne: null },
    }),
    User.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: null,
          totalCoins: { $sum: { $ifNull: ["$engCoine", 0] } },
        },
      },
    ]),
  ]);

  return {
    totalPlayers,
    assignedToSquads,
    activeSubscriptions: activeSubUserIds.length,
    totalCoins: stats?.[0]?.totalCoins || 0,
  };
};

const getFilteredPlayersFromDB = async (
  query: Record<string, any>,
  user?: JwtPayload | null,
) => {
  const canViewOther = await checkCanViewOtherPlayers(user);
  const {
    team,
    position,
    page = 1,
    limit = 10,
    search,
    searchTerm,
    searchValue,
  } = query;

  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  const andConditions: any[] = [
    {
      role: {
        $in: [
          USER_ROLES.PLAYER,
          USER_ROLES.OTHER_CLUBS,
          USER_ROLES.TOURNAMENT_PLAYER,
        ],
      },
    },
    { parentId: { $exists: true, $ne: null } },
    {
      $or: [
        { _id: { $in: activeSubUserIds } },
        { isSubscribed: true },
        { hasAccess: true },
      ],
    },
  ];

  if (query.status && query.status !== "ALL" && query.status !== "all") {
    andConditions.push({ status: query.status });
  } else if (!query.status) {
    andConditions.push({ status: "APPROVED" });
  }

  if (!canViewOther && user) {
    andConditions.push({ _id: user._id || user.id });
  }

  if (team) {
    andConditions.push({ selectTeam: team });
  }
  if (position) {
    andConditions.push({
      position: {
        $regex: position,
        $options: "i",
      },
    });
  }

  const rawSearch = (searchTerm || searchValue || search) as string;
  if (rawSearch && rawSearch.trim()) {
    const searchRegex = new RegExp(rawSearch.trim(), "i");
    andConditions.push({
      $or: [
        { firstName: searchRegex },
        { lastName: searchRegex },
        { userName: searchRegex },
        { email: searchRegex },
        { position: searchRegex },
      ],
    });
  }

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const skip = (pageNum - 1) * limitNum;
  const result = await User.find({ $and: andConditions })
    .populate({
      path: "selectTeam",
      select: "teamName shortName teamLogo",
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  const total = await User.countDocuments({ $and: andConditions });
  const players = result.map((player: any) => ({
    _id: player._id,
    firstName: player.firstName,
    lastName: player.lastName,
    jerseyNumber: player.jerseyNumber,
    position: player.position,
    engCoine: player.engCoine || 0,
    marketValue: player.marketValue || 0,
    profile: player.profile || null,
    status: player.status || "PENDING",
    parentId: player.parentId || null,
    teamName: player.selectTeam?.teamName || null,
    shortName: player.selectTeam?.shortName || null,
    teamLogo: player.selectTeam?.teamLogo || null,
  }));

  return {
    players,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPage: Math.ceil(total / limitNum),
    },
  };
};

const updatePlayerByAdminToDB = async (id: string, payload: Partial<any>) => {
  const player = await User.findById(id);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player not found");
  }

  if (payload.engCoine !== undefined && payload.marketValue === undefined) {
    const pe = await PlayerEconomy.findOne();
    const rate = pe?.conversionRate ?? 10;
    payload.marketValue = Number(payload.engCoine) * rate;
  }

  const result = await User.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  }).populate({
    path: "selectTeam",
    select: "teamName shortName teamLogo",
  });

  return result;
};

// DELETE PLAYER BY ADMIN
const deletePlayerByAdminToDB = async (id: string) => {
  const player = await User.findById(id);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player not found");
  }

  await Promise.all([
    User.findByIdAndDelete(id),
    Subscription.deleteMany({ user: id }),
  ]);

  return { message: "Player deleted successfully" };
};

// ASSIGN PLAYER JERSEY NUMBER (ADMIN, MANAGER, REFEREE)
const assignJerseyNumberToDB = async (
  playerId: string,
  jerseyNumber: string | null,
) => {
  const player = await User.findById(playerId);

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player profile not found");
  }

  const updatedPlayer = await User.findByIdAndUpdate(
    playerId,
    {
      $set: {
        jerseyNumber: jerseyNumber ? jerseyNumber.toString().trim() : null,
      },
    },
    { new: true },
  ).populate("selectTeam", "teamName shortName teamLogo");

  return updatedPlayer;
};
export const PlayerService = {
  createPlayerByParentToDB,
  getMyPlayersFromDB,
  getPlayerByIdFromDB,
  updatePlayerByParentToDB,
  deletePlayerByParentToDB,
  getPendingPlayersForAdminFromDB,
  approvePlayerByAdminToDB,
  rejectPlayerByAdminToDB,
  getAllPlayersFromDB,
  getPlayerOverviewFromDB,
  getFilteredPlayersFromDB,
  updatePlayerByAdminToDB,
  deletePlayerByAdminToDB,
  assignJerseyNumberToDB,
};
