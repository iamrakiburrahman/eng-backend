import mongoose, { Types } from "mongoose";
import QueryBuilder from "../../../util/queryBuilder";
import { Team } from "./team.model";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { LeagueTeam } from "../leagueTeam/leagueTeam.model";
import { User } from "../user/user.model";
import { ClubEconomy } from "../coinAndBudget/clubEconomySchema.model";
import { USER_ROLES } from "../../../enums/user";
import { Subscription } from "../subscription/subscription.model";
import { League } from "../league/league.model";
import { Match } from "../match/match.model";
import { recordTeamCoinTransaction } from "../../../helpers/teamCoinLedgerHelper";
import { TEAM_COIN_CATEGORY } from "../teamCoinTransaction/teamCoinTransaction.interface";

// CREATE TEAM
const createTeamToDB = async (payload: any) => {
  // Always assign starting budget and starting market value from ClubEconomy config in DB
  const clubEconomy = await ClubEconomy.findOne();
  const startingBudget = clubEconomy ? clubEconomy.startingBudget : 100000;
  const rate = clubEconomy?.conversionRate ?? 10;
  payload.coin = payload.coin !== undefined ? payload.coin : startingBudget;
  payload.marketValue = payload.marketValue !== undefined ? payload.marketValue : (payload.coin * rate);
  return await Team.create(payload);
};

// GET ALL TEAMS
const getAllTeamsFromDB = async (query: Record<string, any>) => {
  const {
    leagueId,
    league,
    managerId,
    manager,
    teamType,
    searchTerm,
    ageGroup,
    ageGroupCategory,
    page,
    limit,
    sort,
  } = query;

  const andConditions: any[] = [];

  // 1. League Filter
  const targetLeague = leagueId || league;
  if (targetLeague && targetLeague !== "ALL") {
    const matchingLeagueTeams = await LeagueTeam.find({ league: targetLeague }).select("team");
    const teamIdsInLeague = matchingLeagueTeams.map((lt) => lt.team);
    andConditions.push({
      $or: [
        { league: targetLeague },
        { _id: { $in: teamIdsInLeague } },
      ],
    });
  }

  // 2. Manager Filter
  const targetManager = managerId || manager;
  if (targetManager && targetManager !== "ALL") {
    if (targetManager === "UNASSIGNED") {
      const assignedManagerLinks = await ManagerTeam.find().select("team");
      const assignedTeamIds = assignedManagerLinks.map((mt) => mt.team);
      andConditions.push({ _id: { $nin: assignedTeamIds } });
    } else {
      const managerLinks = await ManagerTeam.find({ manager: targetManager }).select("team");
      const managerTeamIds = managerLinks.map((mt) => mt.team);
      andConditions.push({ _id: { $in: managerTeamIds } });
    }
  }

  // 3. Team Type Filter
  if (teamType && teamType !== "ALL") {
    andConditions.push({ teamType: { $regex: new RegExp(`^${teamType}$`, "i") } });
  }

  // 4. SearchTerm Filter
  if (searchTerm && typeof searchTerm === "string" && searchTerm.trim() !== "") {
    const searchRegex = { $regex: searchTerm.trim(), $options: "i" };
    andConditions.push({
      $or: [
        { teamName: searchRegex },
        { shortName: searchRegex },
        { city: searchRegex },
        { country: searchRegex },
        { stadiumName: searchRegex },
        { teamType: searchRegex },
      ],
    });
  }

  // 5. Age Group Filter (Directly on Team collection)
  if (ageGroup && ageGroup !== "ALL" && ageGroup !== "null" && ageGroup !== "undefined") {
    andConditions.push({
      ageGroup: { $regex: new RegExp(`^${ageGroup.trim()}$`, "i") },
    });
  }

  const initialFilter = andConditions.length > 0 ? { $and: andConditions } : {};

  // Pagination calculation
  const pageNumber = Math.max(1, parseInt(page as string, 10) || 1);
  const limitNumber = Math.max(1, parseInt(limit as string, 10) || 10);
  const skip = (pageNumber - 1) * limitNumber;

  const total = await Team.countDocuments(initialFilter);
  const totalPage = Math.ceil(total / limitNumber) || 1;

  const sortField = (sort as string) || "-createdAt";

  const teams = await Team.find(initialFilter)
    .sort(sortField)
    .skip(skip)
    .limit(limitNumber);

  const meta = {
    total,
    limit: limitNumber,
    page: pageNumber,
    totalPage,
  };

  const teamIds = teams.map((t) => t._id);

  // Active subscription user IDs for players
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  // MEMBERS COUNT (Only genuine, approved, active paid players)
  const memberCounts = await User.aggregate([
    {
      $match: {
        selectTeam: { $in: teamIds },
        status: "APPROVED",
        role: {
          $in: [
            USER_ROLES.PLAYER,
            USER_ROLES.OTHER_CLUBS,
            USER_ROLES.TOURNAMENT_PLAYER,
          ],
        },
        $or: [
          { _id: { $in: activeSubUserIds } },
          { isSubscribed: true },
          { hasAccess: true },
        ],
      },
    },
    {
      $group: {
        _id: "$selectTeam",
        totalMembers: { $sum: 1 },
      },
    },
  ]);

  // MANAGER LINKS
  const managerLinks = await ManagerTeam.find({
    team: { $in: teamIds },
  });

  const managerUserIds = managerLinks.map((m) => m.manager);

  // USER DETAILS (PROFILE FROM USER MODEL)
  const users = await User.find({
    _id: { $in: managerUserIds },
  }).select("profile firstName lastName userName email phone");

  // LEAGUE LINKS
  const leagueLinks = await LeagueTeam.find({
    team: { $in: teamIds },
  }).populate("league", "leagueName name");

  // MAP RESULT
  const result = teams.map((team) => {
    const members = memberCounts.find(
      (m) => m._id.toString() === team._id.toString()
    );

    const teamLeagueObjs = leagueLinks
      .filter((l) => l.team.toString() === team._id.toString())
      .map((l) => l.league)
      .filter(Boolean);

    const managers = managerLinks
      .filter((m) => m.team.toString() === team._id.toString())
      .map((m) => {
        const user = users.find(
          (u) => u._id.toString() === m.manager.toString()
        );

        return {
          _id: m.manager,
          firstName: user?.firstName || null,
          lastName: user?.lastName || null,
          userName: user?.userName || null,
          profile: user?.profile || null,
          email: user?.email || null,
          phone: user?.phone || null,
        };
      });

    const primaryManager = managers[0] || null;
    const primaryLeague = teamLeagueObjs[0] || null;

    return {
      ...team.toObject(),
      totalMembers: members?.totalMembers || 0,
      totalManagers: managers.length,
      managers: managers,
      manager: primaryManager,
      isManagerAssigned: Boolean(primaryManager),
      leagues: teamLeagueObjs,
      league: primaryLeague,
      leagueName: (primaryLeague as any)?.leagueName || (primaryLeague as any)?.name || null,
    };
  });

  return {
    meta,
    result,
  };
};

// GET SINGLE TEAM
const getSingleTeamFromDB = async (id: string) => {
  const team = await Team.findById(id);

  if (!team) {
    throw new Error("Team not found");
  }

  const teamObjectId = Types.ObjectId.isValid(id)
    ? new Types.ObjectId(id)
    : id;

  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");

  const playerFilter: any = {
    selectTeam: { $in: [teamObjectId, id] },
    status: "APPROVED",
    role: {
      $in: [
        USER_ROLES.PLAYER,
        USER_ROLES.OTHER_CLUBS,
        USER_ROLES.TOURNAMENT_PLAYER,
      ],
    },
    $or: [
      { _id: { $in: activeSubUserIds } },
      { isSubscribed: true },
      { hasAccess: true },
    ],
  };

  const rawMembers = await User.find(playerFilter).select(
    "firstName lastName userName email phone profile position status engCoine marketValue role jerseyNumber ageGroup dateOfBirth parentId"
  ).lean();

  const members = rawMembers.map((m: any) => ({
    ...m,
    name: m.userName || `${m.firstName || ""} ${m.lastName || ""}`.trim(),
    isPaid: true,
  }));

  const managerLinks = await ManagerTeam.find({ team: id });
  const managerUserIds = managerLinks.map((m) => m.manager);
  const managerUsers = await User.find({ _id: { $in: managerUserIds } }).select(
    "firstName lastName userName profile email phone"
  );

  const managers = managerLinks.map((m) => {
    const user = managerUsers.find((u) => u._id.toString() === m.manager.toString());
    return {
      _id: m.manager,
      firstName: user?.firstName || null,
      lastName: user?.lastName || null,
      userName: user?.userName || null,
      profile: user?.profile || null,
      email: user?.email || null,
      phone: user?.phone || null,
    };
  });

  const leagueLinks = await LeagueTeam.find({ team: id }).populate("league", "leagueName name");
  const teamLeagueObjs = leagueLinks.map((l) => l.league).filter(Boolean);

  // RECENT MATCHES & TEAM FORM (Last 5 finished matches)
  const [finishedMatches, upcomingMatch] = await Promise.all([
    Match.find({
      $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
      status: "finished",
    })
      .sort({ matchDate: -1, createdAt: -1 })
      .limit(5)
      .populate("homeTeam", "teamName teamLogo shortName")
      .populate("awayTeam", "teamName teamLogo shortName")
      .populate("league", "leagueName name")
      .lean(),
    Match.findOne({
      $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
      status: { $in: ["upcoming", "scheduled"] },
    })
      .sort({ matchDate: 1 })
      .populate("homeTeam", "teamName teamLogo shortName")
      .populate("awayTeam", "teamName teamLogo shortName")
      .populate("league", "leagueName name")
      .lean(),
  ]);

  let won = 0;
  let drawn = 0;
  let lost = 0;

  const form: string[] = (finishedMatches || []).map((m: any) => {
    const isHome = m.homeTeam?._id?.toString() === teamObjectId.toString();
    const teamGoals = isHome ? (Number(m.homeScore) || 0) : (Number(m.awayScore) || 0);
    const oppGoals = isHome ? (Number(m.awayScore) || 0) : (Number(m.homeScore) || 0);
    if (teamGoals > oppGoals) {
      won++;
      return "W";
    }
    if (teamGoals < oppGoals) {
      lost++;
      return "L";
    }
    drawn++;
    return "D";
  }).reverse(); // chronological order: e.g. ['W', 'D', 'L', 'W', 'W']

  const formString = form.length > 0 ? form.join(" - ") : "N/A";

  // Clean lightweight recent matches summary (removes bloated internal matchReview, timers, etc.)
  const cleanRecentMatches = (finishedMatches || []).map((m: any) => ({
    _id: m._id,
    matchDate: m.matchDate,
    homeScore: Number(m.homeScore) || 0,
    awayScore: Number(m.awayScore) || 0,
    status: m.status,
    homeTeam: m.homeTeam
      ? {
          _id: m.homeTeam._id,
          teamName: m.homeTeam.teamName,
          shortName: m.homeTeam.shortName,
          teamLogo: m.homeTeam.teamLogo,
        }
      : null,
    awayTeam: m.awayTeam
      ? {
          _id: m.awayTeam._id,
          teamName: m.awayTeam.teamName,
          shortName: m.awayTeam.shortName,
          teamLogo: m.awayTeam.teamLogo,
        }
      : null,
    league: m.league
      ? {
          _id: m.league._id,
          leagueName: m.league.leagueName || m.league.name,
        }
      : null,
  }));

  // Clean lightweight upcoming fixture summary
  const upcomingObj = upcomingMatch as any;
  const cleanUpcomingFixture = upcomingObj
    ? {
        _id: upcomingObj._id,
        matchDate: upcomingObj.matchDate,
        venueName: upcomingObj.venueName || null,
        status: upcomingObj.status,
        homeTeam: upcomingObj.homeTeam
          ? {
              _id: upcomingObj.homeTeam._id,
              teamName: upcomingObj.homeTeam.teamName,
              shortName: upcomingObj.homeTeam.shortName,
              teamLogo: upcomingObj.homeTeam.teamLogo,
            }
          : null,
        awayTeam: upcomingObj.awayTeam
          ? {
              _id: upcomingObj.awayTeam._id,
              teamName: upcomingObj.awayTeam.teamName,
              shortName: upcomingObj.awayTeam.shortName,
              teamLogo: upcomingObj.awayTeam.teamLogo,
            }
          : null,
        league: upcomingObj.league
          ? {
              _id: upcomingObj.league._id,
              leagueName: upcomingObj.league.leagueName || upcomingObj.league.name,
            }
          : null,
      }
    : null;

  return {
    ...team.toObject(),
    members,
    managers,
    manager: managers[0] || null,
    isManagerAssigned: Boolean(managers[0]),
    leagues: teamLeagueObjs,
    league: teamLeagueObjs[0] || null,
    totalMembers: members.length,
    totalManagers: managers.length,
    form,
    formString,
    won,
    drawn,
    lost,
    totalFormMatches: form.length,
    recentMatches: cleanRecentMatches,
    upcomingFixture: cleanUpcomingFixture,
  };
};

// UPDATE TEAM
const updateTeamToDB = async (id: string, payload: any) => {
  const team = await Team.findById(id);

  if (!team) {
    throw new Error("Team not found");
  }

  // Auto sync marketValue using dynamic conversion rate when coin is provided
  if (payload.coin !== undefined) {
    const clubEconomy = await ClubEconomy.findOne();
    const rate = clubEconomy?.conversionRate ?? 10;
    payload.marketValue = Number(payload.coin) * rate;
  }

  return await Team.findByIdAndUpdate(id, payload, {
    new: true,
    runValidators: true,
  });
};

// DELETE TEAM
const deleteTeamFromDB = async (id: string) => {
  const team = await Team.findById(id);

  if (!team) {
    throw new Error("Team not found");
  }

  return await Team.findByIdAndDelete(id);
};

// UPDATE TEAM COIN OR MARKET VALUE (Admin only)
const updateTeamCoinOrMarketValue = async (
  id: string,
  payload: { coin?: number; marketValue?: number }
) => {
  const team = await Team.findById(id);

  if (!team) {
    throw new Error("Team not found");
  }

  const clubEconomy = await ClubEconomy.findOne();
  const rate = clubEconomy?.conversionRate ?? 10;

  const updateData: Record<string, number> = {};

  if (payload.coin !== undefined) {
    if (typeof payload.coin !== "number" || payload.coin < 0) {
      throw new Error("coin must be a non-negative number");
    }
    const currentCoin = Number(team.coin) || 0;
    const delta = payload.coin - currentCoin;
    if (delta !== 0) {
      await recordTeamCoinTransaction({
        teamId: team._id,
        amount: delta,
        category: TEAM_COIN_CATEGORY.ADMIN_ADJUSTMENT,
        title: "Admin Coin Adjustment",
        description:
          delta > 0
            ? `Admin credited ${delta.toLocaleString()} coins`
            : `Admin deducted ${Math.abs(delta).toLocaleString()} coins`,
        syncMarketValue: payload.marketValue === undefined,
      });
    }
    updateData.coin = payload.coin;
    // Auto sync marketValue to coin using dynamic conversion rate
    updateData.marketValue =
      payload.marketValue !== undefined ? payload.marketValue : payload.coin * rate;
  } else if (payload.marketValue !== undefined) {
    if (typeof payload.marketValue !== "number" || payload.marketValue < 0) {
      throw new Error("marketValue must be a non-negative number");
    }
    updateData.marketValue = payload.marketValue;
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error("At least one field (coin or marketValue) must be provided");
  }

  return await Team.findByIdAndUpdate(
    id,
    { $set: updateData },
    { new: true, runValidators: true }
  );
};

const getTeamAnalyticsFromDB = async () => {
  const [totalTeams, totalLeagues, distinctManagers, economyAgg] =
    await Promise.all([
      Team.countDocuments(),
      League.countDocuments(),
      ManagerTeam.distinct("manager"),
      Team.aggregate([
        {
          $group: {
            _id: null,
            totalCoins: { $sum: "$coin" },
            totalMarketValue: { $sum: "$marketValue" },
          },
        },
      ]),
    ]);

  return {
    totalTeams,
    totalLeagues,
    totalManagers: distinctManagers.length,
    totalCoins: economyAgg[0]?.totalCoins || 0,
    totalMarketValue: economyAgg[0]?.totalMarketValue || 0,
  };
};

export const TeamService = {
  createTeamToDB,
  getAllTeamsFromDB,
  getSingleTeamFromDB,
  updateTeamToDB,
  deleteTeamFromDB,
  updateTeamCoinOrMarketValue,
  getTeamAnalyticsFromDB,
};
