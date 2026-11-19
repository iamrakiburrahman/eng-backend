import { StatusCodes } from "http-status-codes";
import ApiError from "../../../errors/ApiErrors";
import { USER_ROLES } from "../../../enums/user";
import QueryBuilder from "../../../util/queryBuilder";
import { User } from "../user/user.model";
import { Subscription } from "../subscription/subscription.model";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { Match } from "../match/match.model";
import { PlayerEconomy } from "../coinAndBudget/playerEconomySchema.model";
import { carryForwardPlayerStats } from "../../../helpers/playerTransferStatsHelper";

// GET ALL USERS
const getAllUsersFromDB = async (query: Record<string, any>) => {
  const queryObj = { ...query };
  const filterQuery: Record<string, any> = {
    role: { $ne: USER_ROLES.SUPER_ADMIN },
  };

  // Active subscription user IDs for players
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  // Base Eligibility Rule: Incomplete Managers, Incomplete Referees, Unpaid Players, and Pure Parent accounts are HIDDEN from member tables
  const baseEligibilityConditions = [
    // Manager with submitted documents
    {
      role: USER_ROLES.MANAGER,
      dateOfBirth: { $exists: true, $ne: null },
      document: { $exists: true, $ne: null, $nin: [[], ""] },
    },
    // Referee with submitted documents
    {
      role: USER_ROLES.REFEREE,
      dateOfBirth: { $exists: true, $ne: null },
      document: { $exists: true, $ne: null, $nin: [[], ""] },
    },
    // Player with active subscription
    {
      role: {
        $in: [
          USER_ROLES.PLAYER,
          USER_ROLES.OTHER_CLUBS,
          USER_ROLES.TOURNAMENT_PLAYER,
        ],
      },
      $and: [
        {
          $or: [
            { _id: { $in: activeSubUserIds } },
            { isSubscribed: true },
            { hasAccess: true },
          ],
        },
        {
          $or: [
            { parentId: { $exists: true, $ne: null } },
            { position: { $exists: true, $ne: null } },
            { dateOfBirth: { $exists: true, $ne: null } },
            { ageGroup: { $exists: true, $ne: null } },
            { selectTeam: { $exists: true, $ne: null } },
            { email: null },
            { password: null },
          ],
        },
      ],
    },
  ];

  filterQuery.$or = baseEligibilityConditions;

  if (queryObj.role === "PENDING_REQUESTS") {
    filterQuery.status = "PENDING";
    delete queryObj.role;
  } else if (queryObj.role === USER_ROLES.MANAGER) {
    filterQuery.role = USER_ROLES.MANAGER;
    delete queryObj.role;
  } else if (queryObj.role === USER_ROLES.REFEREE) {
    filterQuery.role = USER_ROLES.REFEREE;
    delete queryObj.role;
  } else if (queryObj.role === USER_ROLES.PLAYER) {
    filterQuery.role = USER_ROLES.PLAYER;
    delete queryObj.role;
  } else if (queryObj.role === "ALL") {
    delete queryObj.role;
  }

  if (queryObj.status) {
    if (queryObj.status === "ALL" || queryObj.status === "all") {
      delete filterQuery.status;
    } else {
      filterQuery.status = queryObj.status;
    }
    delete queryObj.status;
  } else if (!filterQuery.status) {
    filterQuery.status = "APPROVED";
  }

  const userQuery = new QueryBuilder(
    User.find(filterQuery)
      .select(
        "userName role profile verified status document selectTeam firstName lastName email phone location parentId ageGroup dateOfBirth position strongFoot previousClub rejectionReason emergencyEmail emergencyPhone playForAcademy academyClubName isDevelopmentPlayer mediaConsent engCoine marketValue createdAt",
      )
      .populate("selectTeam", "teamName shortName teamLogo")
      .populate("parentId", "firstName lastName email phone"),
    queryObj,
  )
    .search(["userName", "email", "firstName", "lastName", "phone", "location"])
    .filter()
    .sort()
    .paginate()
    .fields();

  const rawResult = await userQuery.modelQuery;
  const meta = await userQuery.getPaginationInfo();

  const userIds = rawResult.map((u: any) => u._id);
  const parentIds = rawResult
    .map((u: any) => u.parentId?._id || u.parentId)
    .filter(Boolean);
  const allUserIds = [...new Set([...userIds, ...parentIds])];

  const [activeSubs, managerLinks] = await Promise.all([
    Subscription.find({
      user: { $in: allUserIds },
      status: "active",
    }).populate("package"),
    ManagerTeam.find({
      manager: { $in: userIds },
    }).populate("team", "teamName shortName teamLogo ageGroup city"),
  ]);

  const subMap = new Map();
  activeSubs.forEach((sub: any) => subMap.set(sub.user.toString(), sub));

  const managerTeamMap = new Map<string, any[]>();
  managerLinks.forEach((ml: any) => {
    const mId = ml.manager.toString();
    if (!managerTeamMap.has(mId)) {
      managerTeamMap.set(mId, []);
    }
    if (ml.team) {
      managerTeamMap.get(mId)!.push(ml.team);
    }
  });

  const pe = await PlayerEconomy.findOne();
  const conversionRate = pe?.conversionRate ?? 10;

  const result = rawResult.map((u: any) => {
    const userObj = u.toObject ? u.toObject() : u;
    const userCoins =
      Number(userObj.engCoine ?? userObj.coin ?? userObj.coins) || 0;
    const userMV =
      userObj.marketValue !== undefined && userObj.marketValue !== null
        ? Number(userObj.marketValue)
        : userCoins * conversionRate;

    const directSub = subMap.get(userObj._id?.toString());
    const activeSub = directSub || null;

    const managedTeams = managerTeamMap.get(userObj._id?.toString()) || [];

    return {
      ...userObj,
      managedTeams,
      totalManagedTeams: managedTeams.length,
      selectTeam:
        userObj.role === USER_ROLES.MANAGER && managedTeams.length > 0
          ? managedTeams[0]
          : userObj.selectTeam,
      engCoine: userCoins,
      marketValue: userMV,
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

// GET ALL PARENTS (DEDICATED API)
const getAllParentsFromDB = async (query: Record<string, any>) => {
  const queryObj = { ...query };
  const {
    page = 1,
    limit = 10,
    pageNumber,
    userPage,
    searchTerm,
    searchValue,
    search,
  } = queryObj;

  const pageNum = Number(pageNumber || userPage || page) || 1;
  const limitNum = Number(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const parentIdsWithChildren = await User.find({
    parentId: { $exists: true, $ne: null },
  }).distinct("parentId");

  const andConditions: any[] = [
    {
      $or: [
        { _id: { $in: parentIdsWithChildren } },
        {
          parentId: null,
          email: { $exists: true, $ne: null },
          role: {
            $nin: [
              USER_ROLES.ADMIN,
              USER_ROLES.SUPER_ADMIN,
              USER_ROLES.MANAGER,
              USER_ROLES.REFEREE,
            ],
          },
          position: { $in: [null, ""] },
          dateOfBirth: null,
        },
      ],
    },
  ];

  const rawSearch = (searchTerm || searchValue || search) as string;
  if (rawSearch && rawSearch.trim()) {
    const searchRegex = new RegExp(rawSearch.trim(), "i");
    const nameParts = rawSearch.trim().split(/\s+/);

    const $orConditions: any[] = [
      { firstName: searchRegex },
      { lastName: searchRegex },
      { userName: searchRegex },
      { email: searchRegex },
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
  }

  const finalFilter = { $and: andConditions };

  const [rawParents, total] = await Promise.all([
    User.find(finalFilter)
      .select(
        "userName role profile verified status firstName lastName email phone location createdAt",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    User.countDocuments(finalFilter),
  ]);

  const parentIds = rawParents.map((p: any) => p._id);

  // 1. Fetch child players for all parents
  const childPlayers = await User.find({
    parentId: { $in: parentIds },
    role: {
      $in: [
        USER_ROLES.PLAYER,
        USER_ROLES.OTHER_CLUBS,
        USER_ROLES.TOURNAMENT_PLAYER,
      ],
    },
  })
    .populate("selectTeam", "teamName shortName teamLogo")
    .select(
      "firstName lastName userName position ageGroup dateOfBirth selectTeam status verified profile engCoine marketValue parentId isSubscribed hasAccess",
    )
    .lean();

  // 2. Fetch active subscriptions for parents and ALL individual child players
  const allUserIds = [...parentIds, ...childPlayers.map((c: any) => c._id)];
  const activeSubs = await Subscription.find({
    user: { $in: allUserIds },
    status: "active",
  }).populate("package");

  const subMap = new Map();
  activeSubs.forEach((sub: any) => {
    subMap.set(sub.user.toString(), sub);
  });

  const childMap = new Map();
  childPlayers.forEach((cp: any) => {
    const pId = cp.parentId?.toString();
    if (pId) {
      if (!childMap.has(pId)) {
        childMap.set(pId, []);
      }
      const childSub = subMap.get(cp._id.toString());
      const childObj = {
        ...cp,
        isPaid: Boolean(childSub || cp.isSubscribed || cp.hasAccess),
        subscription: childSub
          ? {
              _id: childSub._id,
              status: childSub.status,
              price: childSub.price,
              trxId: childSub.trxId,
              subscriptionId: childSub.subscriptionId,
              currentPeriodStart: childSub.currentPeriodStart,
              currentPeriodEnd: childSub.currentPeriodEnd,
              packageName:
                (childSub.package as any)?.title ||
                (childSub.package as any)?.name ||
                "ENG Subscription",
              packageDetails: childSub.package || null,
            }
          : null,
      };
      childMap.get(pId).push(childObj);
    }
  });

  const result = rawParents.map((p: any) => {
    const pChildren = childMap.get(p._id.toString()) || [];
    const directSub = subMap.get(p._id.toString());
    const paidChildrenCount = pChildren.filter((c: any) => c.isPaid).length;

    return {
      ...p,
      myPlayers: pChildren,
      children: pChildren,
      childrenCount: pChildren.length,
      paidChildrenCount,
      isPaid: Boolean(directSub || paidChildrenCount > 0),
      subscription: directSub
        ? {
            _id: directSub._id,
            status: directSub.status,
            price: directSub.price,
            trxId: directSub.trxId,
            subscriptionId: directSub.subscriptionId,
            currentPeriodStart: directSub.currentPeriodStart,
            currentPeriodEnd: directSub.currentPeriodEnd,
            packageName:
              (directSub.package as any)?.title ||
              (directSub.package as any)?.name ||
              "ENG Subscription",
            packageDetails: directSub.package || null,
          }
        : null,
    };
  });

  return {
    meta: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPage: Math.ceil(total / limitNum) || 1,
    },
    result,
  };
};

// GET PARENTS OVERVIEW / ANALYTICS (DEDICATED API)
const getParentOverviewFromDB = async () => {
  const parentIdsWithChildren = await User.find({
    parentId: { $exists: true, $ne: null },
  }).distinct("parentId");

  const parentFilter = {
    $or: [
      { _id: { $in: parentIdsWithChildren } },
      {
        parentId: null,
        email: { $exists: true, $ne: null },
        role: {
          $nin: [
            USER_ROLES.ADMIN,
            USER_ROLES.SUPER_ADMIN,
            USER_ROLES.MANAGER,
            USER_ROLES.REFEREE,
          ],
        },
        position: { $in: [null, ""] },
        dateOfBirth: null,
      },
    ],
  };

  const childFilter = {
    parentId: { $exists: true, $ne: null },
    role: {
      $in: [
        USER_ROLES.PLAYER,
        USER_ROLES.OTHER_CLUBS,
        USER_ROLES.TOURNAMENT_PLAYER,
      ],
    },
  };

  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  const [totalParents, totalLinkedChildren, subscribedChildren] = await Promise.all([
    User.countDocuments(parentFilter),
    User.countDocuments(childFilter),
    User.countDocuments({
      ...childFilter,
      $or: [
        { _id: { $in: activeSubUserIds } },
        { isSubscribed: true },
        { hasAccess: true },
      ],
    }),
  ]);

  return {
    totalParents,
    totalLinkedChildren,
    subscribedChildren,
  };
};

// ASSIGN TEAM TO USER / PLAYER BY ADMIN
const assignTeamToUserToDB = async (
  userId: string,
  selectTeam: string | null,
) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { selectTeam: selectTeam || null } },
    { new: true },
  ).populate("selectTeam", "teamName shortName teamLogo");

  if (selectTeam) {
    await carryForwardPlayerStats(userId, selectTeam);
  }

  return updated;
};
// TOGGLE VERIFIED
const toggleVerifiedToDB = async (id: string) => {
  const user = await User.findById(id);

  if (!user) {
    throw new Error("User not found");
  }

  const result = await User.findByIdAndUpdate(
    id,
    {
      verified: !user.verified,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  return result;
};

// DELETE USER
const deleteUserFromDB = async (id: string) => {
  const user = await User.findById(id);

  if (!user) {
    throw new Error("User not found");
  }

  return await User.findByIdAndDelete(id);
};

const getAllRefereesFromDB = async () => {
  const result = await User.find({
    role: { $in: [USER_ROLES.REFEREE] },
  })
    .select("_id userName firstName lastName profile status")
    .lean();

  return result.map((r: any) => {
    const fullName = r.firstName
      ? `${r.firstName} ${r.lastName || ""}`.trim()
      : "";
    const displayName =
      fullName ||
      r.userName ||
      r.name ||
      `Referee (${r._id.toString().slice(-4)})`;
    return {
      ...r,
      userName: displayName,
      name: displayName,
      displayName,
    };
  });
};

const getAllManagersFromDB = async () => {
  const result = await User.find({ role: USER_ROLES.MANAGER })
    .select("_id userName firstName lastName selectTeam")
    .populate("selectTeam", "teamName shortName teamLogo");

  return result;
};

// GET USER MANAGEMENT ANALYTICS
const getUserAnalyticsFromDB = async () => {
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  const playerEligibilityConditions = {
    role: {
      $in: [
        USER_ROLES.PLAYER,
        USER_ROLES.OTHER_CLUBS,
        USER_ROLES.TOURNAMENT_PLAYER,
      ],
    },
    $and: [
      {
        $or: [
          { _id: { $in: activeSubUserIds } },
          { isSubscribed: true },
          { hasAccess: true },
        ],
      },
      {
        $or: [
          { parentId: { $exists: true, $ne: null } },
          { position: { $exists: true, $ne: null } },
          { dateOfBirth: { $exists: true, $ne: null } },
          { ageGroup: { $exists: true, $ne: null } },
          { selectTeam: { $exists: true, $ne: null } },
          { email: null },
          { password: null },
        ],
      },
    ],
  };

  const baseEligibilityConditions = [
    {
      role: USER_ROLES.MANAGER,
      dateOfBirth: { $exists: true, $ne: null },
      document: { $exists: true, $ne: null, $nin: [[], ""] },
    },
    {
      role: USER_ROLES.REFEREE,
      dateOfBirth: { $exists: true, $ne: null },
      document: { $exists: true, $ne: null, $nin: [[], ""] },
    },
    playerEligibilityConditions,
  ];

  const [
    totalUsers,
    totalParents,
    totalPlayers,
    pendingRequests,
    approvedPlayers,
    rejectedPlayers,
    totalManagers,
    totalClubs,
    totalReferees,
    verifiedUsers,
    totalTrialPlayers,
    totalTournamentPlayers,
  ] = await Promise.all([
    User.countDocuments({
      role: { $nin: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
      $or: baseEligibilityConditions,
    }),
    User.countDocuments({
      parentId: null,
      email: { $ne: null },
      role: {
        $nin: [
          USER_ROLES.ADMIN,
          USER_ROLES.SUPER_ADMIN,
          USER_ROLES.MANAGER,
          USER_ROLES.REFEREE,
        ],
      },
      position: { $exists: false },
      dateOfBirth: { $exists: false },
    }),
    User.countDocuments({
      ...playerEligibilityConditions,
      status: { $in: ["APPROVED", "PENDING"] },
    }),
    User.countDocuments({
      status: "PENDING",
      $or: baseEligibilityConditions,
    }),
    User.countDocuments({
      ...playerEligibilityConditions,
      status: "APPROVED",
    }),
    User.countDocuments({
      ...playerEligibilityConditions,
      status: "REJECTED",
    }),
    User.countDocuments({
      role: USER_ROLES.MANAGER,
      dateOfBirth: { $exists: true, $ne: null },
      document: { $exists: true, $ne: null, $nin: [[], ""] },
    }),
    User.countDocuments({ status: "APPROVED", role: USER_ROLES.OTHER_CLUBS }),
    User.countDocuments({
      role: USER_ROLES.REFEREE,
      dateOfBirth: { $exists: true, $ne: null },
      document: { $exists: true, $ne: null, $nin: [[], ""] },
    }),
    User.countDocuments({
      verified: true,
      role: { $nin: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
      $or: baseEligibilityConditions,
    }),
    User.countDocuments({ status: "APPROVED", role: USER_ROLES.OTHER_CLUBS }),
    User.countDocuments({
      status: "APPROVED",
      role: USER_ROLES.TOURNAMENT_PLAYER,
    }),
  ]);

  return {
    totalUsers,
    totalParents,
    totalPlayers,
    pendingRequests,
    approvedPlayers,
    rejectedPlayers,
    totalManagers,
    totalClubs,
    totalReferees,
    verifiedUsers,
    totalTrialPlayers,
    totalTournamentPlayers,
  };
};

// UPDATE USER ROLE (Admin only)
const updateUserRoleToDB = async (userId: string, role: string) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const validRoles = [
    USER_ROLES.PLAYER,
    USER_ROLES.TOURNAMENT_PLAYER,
    USER_ROLES.OTHER_CLUBS,
    USER_ROLES.MANAGER,
    USER_ROLES.REFEREE,
  ];

  if (!validRoles.includes(role as any)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid role type");
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { role } },
    { new: true, runValidators: true },
  );

  return updated;
};

// UPDATE USER PROFILE BY ADMIN (Profile Picture, Name, Details)
const updateUserProfileByAdminToDB = async (userId: string, payload: any) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: payload },
    { new: true, runValidators: true },
  );

  return updated;
};

// GET INCOMPLETE / UNVERIFIED / ABANDONED USERS (FOR ADMIN REMOVAL)
const getIncompleteUsersFromDB = async (query: Record<string, any>) => {
  const queryObj = { ...query };
  const {
    page = 1,
    limit = 10,
    pageNumber,
    userPage,
    searchTerm,
    searchValue,
    search,
  } = queryObj;

  const pageNum = Number(pageNumber || userPage || page) || 1;
  const limitNum = Number(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  // Active subscription user IDs
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  // Parents who have at least one child player
  const parentIdsWithChildren = await User.find({
    parentId: { $exists: true, $ne: null },
  }).distinct("parentId");

  // Incomplete / Broken / Abandoned / Rejected user conditions:
  // 1) status: "REJECTED" (Profile rejected by Admin)
  // 2) verified: false (Email OTP unverified)
  // 3) Parent/User with email, no parentId, not in parentIdsWithChildren, no active sub, no child players
  // 4) Manager or Referee with missing DOB or missing documents
  const incompleteConditions = [
    { status: { $in: ["REJECTED", "rejected"] } },
    { rejectionReason: { $exists: true, $nin: [null, ""] } },
    { verified: false },
    {
      role: {
        $nin: [
          USER_ROLES.ADMIN,
          USER_ROLES.SUPER_ADMIN,
          USER_ROLES.MANAGER,
          USER_ROLES.REFEREE,
        ],
      },
      parentId: null,
      email: { $exists: true, $ne: null },
      _id: { $nin: [...activeSubUserIds, ...parentIdsWithChildren] },
      isSubscribed: { $ne: true },
      hasAccess: { $ne: true },
      dateOfBirth: null,
      position: null,
    },
    {
      role: USER_ROLES.MANAGER,
      $or: [{ dateOfBirth: null }, { document: { $in: [null, [], ""] } }],
    },
    {
      role: USER_ROLES.REFEREE,
      $or: [{ dateOfBirth: null }, { document: { $in: [null, [], ""] } }],
    },
  ];

  const andConditions: any[] = [
    {
      role: { $nin: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
      $or: incompleteConditions,
    },
  ];

  const rawStatus = (query.status || query.statusFilter || query.filter || "")
    .toString()
    .toUpperCase()
    .trim();

  if (rawStatus && rawStatus !== "ALL") {
    if (rawStatus === "UNVERIFIED") {
      andConditions.push({
        $or: [
          { verified: false },
          { verified: null },
          { verified: { $exists: false } },
        ],
      });
    } else if (rawStatus === "VERIFIED") {
      andConditions.push({ verified: true });
    } else if (rawStatus === "REJECTED") {
      andConditions.push({
        $or: [
          { status: { $in: ["REJECTED", "rejected", "REJECT", "reject"] } },
          { rejectionReason: { $exists: true, $nin: [null, ""] } },
        ],
      });
    } else if (rawStatus === "PENDING") {
      andConditions.push({ status: { $in: ["PENDING", "pending"] } });
    }
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
        { phone: searchRegex },
      ],
    });
  }

  const finalFilter = { $and: andConditions };

  const [rawUsers, total] = await Promise.all([
    User.find(finalFilter)
      .select(
        "userName role profile verified status document firstName lastName email phone location rejectionReason createdAt",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    User.countDocuments(finalFilter),
  ]);

  const result = rawUsers.map((u: any) => {
    let reason = "Incomplete Registration Setup";
    if (u.status === "REJECTED") {
      reason = u.rejectionReason || "Profile / Application Rejected by Admin";
    } else if (u.verified === false) {
      reason = "Unverified Email / Abandoned Signup";
    } else if (u.role === USER_ROLES.MANAGER) {
      reason = "Manager Missing Verification Documents";
    } else if (u.role === USER_ROLES.REFEREE) {
      reason = "Referee Missing Verification Documents";
    } else if (!u.parentId) {
      reason = "Parent Profile - No Child Linked";
    }

    return {
      ...u,
      incompleteReason: reason,
    };
  });

  return {
    meta: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPage: Math.ceil(total / limitNum) || 1,
    },
    result,
  };
};

// UPDATE PLAYER JERSEY NUMBER & PROFILE PICTURE BY ADMIN, MANAGER & REFEREE
const updateJerseyNumberToDB = async (
  userId: string,
  payload: { jerseyNumber?: string | null; profile?: string },
  requesterUser?: any
) => {
  const targetUser = await User.findById(userId);
  if (!targetUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
  }

  if (requesterUser && requesterUser.role !== USER_ROLES.ADMIN && requesterUser.role !== USER_ROLES.SUPER_ADMIN) {
    const requesterId = (requesterUser.id || requesterUser._id)?.toString();
    const playerTeamId = targetUser.selectTeam ? targetUser.selectTeam.toString() : null;

    if (!playerTeamId) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Player is not assigned to any team.");
    }

    if (requesterUser.role === USER_ROLES.MANAGER) {
      const isManagerOfTeam = await ManagerTeam.findOne({
        manager: requesterId,
        team: playerTeamId,
      });
      if (!isManagerOfTeam) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          "You can only update details for players in your own team."
        );
      }
    } else if (requesterUser.role === USER_ROLES.REFEREE) {
      const assignedMatch = await Match.findOne({
        referee: requesterId,
        $or: [{ homeTeam: playerTeamId }, { awayTeam: playerTeamId }],
      });
      if (!assignedMatch) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          "You are not assigned to any match involving this player's team."
        );
      }
      // Referees should not overwrite player avatar profile pictures
      if (payload.profile) {
        delete payload.profile;
      }
    }
  }

  const updateData: Record<string, any> = {};
  if (payload.jerseyNumber !== undefined) {
    updateData.jerseyNumber = payload.jerseyNumber
      ? payload.jerseyNumber.toString().trim()
      : null;
  }
  if (payload.profile) {
    updateData.profile = payload.profile;
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true },
  );

  return updated;
};

// GET INCOMPLETE USERS ANALYTICS/STATS
const getIncompleteUsersAnalyticsFromDB = async () => {
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  const parentIdsWithChildren = await User.find({
    parentId: { $exists: true, $ne: null },
  }).distinct("parentId");

  const incompleteConditions = [
    { status: { $in: ["REJECTED", "rejected"] } },
    { rejectionReason: { $exists: true, $nin: [null, ""] } },
    { verified: false },
    {
      role: {
        $nin: [
          USER_ROLES.ADMIN,
          USER_ROLES.SUPER_ADMIN,
          USER_ROLES.MANAGER,
          USER_ROLES.REFEREE,
        ],
      },
      parentId: null,
      email: { $exists: true, $ne: null },
      _id: { $nin: [...activeSubUserIds, ...parentIdsWithChildren] },
      isSubscribed: { $ne: true },
      hasAccess: { $ne: true },
      dateOfBirth: null,
      position: null,
    },
    {
      role: USER_ROLES.MANAGER,
      $or: [{ dateOfBirth: null }, { document: { $in: [null, [], ""] } }],
    },
    {
      role: USER_ROLES.REFEREE,
      $or: [{ dateOfBirth: null }, { document: { $in: [null, [], ""] } }],
    },
  ];

  const baseFilter = {
    role: { $nin: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN] },
    $or: incompleteConditions,
  };

  const allIncompleteUsers = await User.find(baseFilter)
    .select("status verified incompleteReason rejectionReason")
    .lean();

  const totalIncomplete = allIncompleteUsers.length;

  let unverifiedCount = 0;
  let verifiedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;

  allIncompleteUsers.forEach((u: any) => {
    const st = (u.status || "").toUpperCase();
    const reason = (
      u.incompleteReason ||
      u.rejectionReason ||
      ""
    ).toLowerCase();

    const isRejected =
      st === "REJECTED" || st === "REJECT" || reason.includes("reject");
    const isUnverified =
      u.verified === false ||
      u.verified === null ||
      u.verified === undefined ||
      reason.includes("unverified");
    const isPending = st === "PENDING";

    if (isRejected) rejectedCount++;
    if (isUnverified) unverifiedCount++;
    if (u.verified === true) verifiedCount++;
    if (isPending) pendingCount++;
  });

  return {
    totalIncomplete,
    unverifiedCount,
    rejectedCount,
    pendingCount,
    verifiedCount,
  };
};

export const UserManagementService = {
  getAllUsersFromDB,
  getAllParentsFromDB,
  getParentOverviewFromDB,
  getIncompleteUsersFromDB,
  getIncompleteUsersAnalyticsFromDB,
  assignTeamToUserToDB,
  updateJerseyNumberToDB,
  toggleVerifiedToDB,
  deleteUserFromDB,
  getAllRefereesFromDB,
  getAllManagersFromDB,
  getUserAnalyticsFromDB,
  updateUserRoleToDB,
  updateUserProfileByAdminToDB,
};
