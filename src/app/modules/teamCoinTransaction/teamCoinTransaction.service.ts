import mongoose from "mongoose";
import { TeamCoinTransaction } from "./teamCoinTransaction.model";
import { Team } from "../team/team.model";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { TEAM_COIN_CATEGORY } from "./teamCoinTransaction.interface";
import { recordTeamCoinTransaction } from "../../../helpers/teamCoinLedgerHelper";
import ApiError from "../../../errors/ApiErrors";
import { StatusCodes } from "http-status-codes";
import { USER_ROLES } from "../../../enums/user";

const getTeamCoinHistoryFromDB = async (
  teamId: string,
  query: Record<string, any>,
  user?: any
) => {
  if (!mongoose.Types.ObjectId.isValid(teamId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid Team ID");
  }

  const teamDoc = await Team.findById(teamId).select(
    "teamName shortName teamLogo coin marketValue ageGroup creator"
  ).lean();

  if (!teamDoc) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Team not found");
  }

  // Access control: Only ADMIN, SUPER_ADMIN, or the assigned Manager/creator of the team can view coin history
  if (user && user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPER_ADMIN) {
    const requesterId = (user.id || user._id)?.toString();
    const isManager = await ManagerTeam.findOne({
      manager: requesterId,
      team: teamId,
    });
    const isCreator =
      (teamDoc as any).creator &&
      (teamDoc as any).creator.toString() === requesterId;

    if (!isManager && !isCreator) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You are not authorized to view coin history for this team."
      );
    }
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const filter: any = { team: new mongoose.Types.ObjectId(teamId) };

  // Category filter: support aliases, case-insensitive, or comma-separated
  if (query.category) {
    const rawCat = String(query.category).trim();
    if (rawCat && rawCat !== "ALL") {
      const catList = rawCat.split(",").map((c) => c.trim()).filter(Boolean);
      const regexPatterns = catList.map((cat) => {
        const pattern = cat.replace(/[-_ ]+/g, ".*");
        return new RegExp(`^.*${pattern}.*$`, "i");
      });
      filter.category = regexPatterns.length === 1 ? regexPatterns[0] : { $in: regexPatterns };
    }
  }

  // Type filter: CREDIT or DEBIT
  if (query.type) {
    const typeUpper = String(query.type).trim().toUpperCase();
    if (typeUpper === "CREDIT" || typeUpper === "DEBIT") {
      filter.type = typeUpper;
    }
  }

  // Search filter
  if (query.searchTerm || query.search) {
    const searchStr = String(query.searchTerm || query.search).trim();
    if (searchStr) {
      filter.$or = [
        { title: { $regex: searchStr, $options: "i" } },
        { description: { $regex: searchStr, $options: "i" } },
      ];
    }
  }

  const [transactions, total] = await Promise.all([
    TeamCoinTransaction.find(filter)
      .select(
        "_id title type amount balanceBefore balanceAfter category description match opponentTeam transferredPlayer transfer createdAt"
      )
      .populate({
        path: "match",
        select: "homeTeam awayTeam matchDate venueName matchType",
        populate: [
          { path: "homeTeam", select: "teamName shortName teamLogo" },
          { path: "awayTeam", select: "teamName shortName teamLogo" },
        ],
      })
      .populate("opponentTeam", "teamName shortName teamLogo")
      .populate("transferredPlayer", "firstName lastName userName profile jerseyNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    TeamCoinTransaction.countDocuments(filter),
  ]);

  const targetTeamIdStr = teamId.toString();

  const enrichedData = transactions.map((tx: any) => {
    let opponentTeam: any = tx.opponentTeam || null;
    let fixture: string | null = null;

    if (tx.match && typeof tx.match === "object") {
      const home = tx.match.homeTeam;
      const away = tx.match.awayTeam;
      const homeName = home?.teamName || home?.shortName || "Home Team";
      const awayName = away?.teamName || away?.shortName || "Away Team";
      fixture = `${homeName} vs ${awayName}`;

      const homeId = home?._id ? home._id.toString() : (home?.toString() || "");
      const awayId = away?._id ? away._id.toString() : (away?.toString() || "");

      if (!opponentTeam) {
        if (targetTeamIdStr === homeId) {
          opponentTeam = away;
        } else if (targetTeamIdStr === awayId) {
          opponentTeam = home;
        } else {
          opponentTeam = away || home || null;
        }
      }

      const oppName = opponentTeam?.teamName || opponentTeam?.shortName;
      if (
        oppName &&
        tx.description &&
        !tx.description.toLowerCase().includes(" vs ") &&
        !tx.description.toLowerCase().includes(oppName.toLowerCase())
      ) {
        tx.description = `${tx.description} vs ${oppName}`;
      }
    }

    return {
      ...tx,
      opponentTeam: opponentTeam
        ? {
            _id: opponentTeam._id,
            teamName: opponentTeam.teamName,
            shortName: opponentTeam.shortName,
            teamLogo: opponentTeam.teamLogo,
          }
        : null,
      fixture,
    };
  });

  const totalPage = Math.ceil(total / limit) || 1;

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
    },
    team: {
      _id: teamDoc._id,
      teamName: teamDoc.teamName,
      shortName: teamDoc.shortName,
      teamLogo: teamDoc.teamLogo,
      coin: teamDoc.coin || 0,
      marketValue: teamDoc.marketValue || 0,
    },
    data: enrichedData,
  };
};

const adminAdjustTeamCoinsInDB = async (
  adminId: string,
  teamId: string,
  payload: {
    amount: number;
    reason: string;
    title?: string;
  }
) => {
  const { amount, reason, title = "Admin Team Coin Adjustment" } = payload;

  if (amount === undefined || isNaN(Number(amount)) || Number(amount) === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "A non-zero numeric amount is required");
  }

  if (!reason || reason.trim().length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "A reason note is required for admin team coin adjustments");
  }

  const team = await Team.findById(teamId);
  if (!team) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Team not found");
  }

  const result = await recordTeamCoinTransaction({
    teamId: team._id,
    amount: Number(amount),
    category: TEAM_COIN_CATEGORY.ADMIN_ADJUSTMENT,
    title,
    description: reason.trim(),
    createdBy: adminId,
  });

  return result;
};



export const TeamCoinTransactionService = {
  getTeamCoinHistoryFromDB,
  adminAdjustTeamCoinsInDB,
};
