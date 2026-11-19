import mongoose from "mongoose";
import { Team } from "../team/team.model";
import { Match } from "../match/match.model";
import { MatchResult } from "../matchResult/matchResult.model";
import { User } from "../user/user.model";
import { ManagerTeam } from "../managerTeam/managerTeam.model";

import { USER_ROLES } from "../../../enums/user";
import { Subscription } from "../subscription/subscription.model";
import { TeamSubscription } from "../teamSubscription/teamSubscription.model";

const getTeamDashboardFromDB = async (teamId: string, userId?: string) => {
  const teamObjectId = new mongoose.Types.ObjectId(teamId);
  // Active subscription user IDs for players
  const activeSubUserIds = await Subscription.find({
    status: "active",
  }).distinct("user");
  // PLAYERS (Only genuine Player profiles belonging to THIS TEAM, exclude Parent accounts)
  const rawPlayers = await User.find({
    selectTeam: { $in: [teamObjectId, teamId] },
    status: "APPROVED",
    role: {
      $in: [
        USER_ROLES.PLAYER,
        USER_ROLES.OTHER_CLUBS,
        USER_ROLES.TOURNAMENT_PLAYER,
      ],
    },
    _id: { $in: activeSubUserIds },
    $or: [
      { parentId: { $ne: null } },
      { position: { $exists: true, $ne: null } },
      { dateOfBirth: { $exists: true, $ne: null } },
      { ageGroup: { $exists: true, $ne: null } },
      { selectTeam: { $exists: true, $ne: null } },
      { email: null },
      { password: null },
    ],
  })
    .select(
      "_id firstName lastName userName profile position ageGroup dateOfBirth selectTeam status emergencyEmail emergencyPhone role jerseyNumber",
    )
    .lean();

  const players = rawPlayers.map((p: any) => ({
    _id: p._id,
    userId: p._id,
    firstName: p.firstName || null,
    lastName: p.lastName || null,
    userName:
      p.userName ||
      (p.firstName ? `${p.firstName} ${p.lastName || ""}`.trim() : "Player"),
    profile: p.profile || null,
    position: p.position || "BENCH",
    ageGroup: p.ageGroup || null,
    dateOfBirth: p.dateOfBirth || null,
    status: p.status || "APPROVED",
    jerseyNumber: p.jerseyNumber,
  }));

  const totalPlayers = players.length;

  // UPCOMING MATCHES
  const upcomingMatches = await Match.find({
    $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
    status: "upcoming",
  })
    .sort({ matchDate: 1 })
    .limit(5)
    .populate("homeTeam awayTeam", "teamName shortName teamLogo");

  // RECENT MATCHES
  const rawRecentMatches = await Match.find({
    $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
    status: "finished",
  })
    .sort({ matchDate: -1, createdAt: -1 })
    .limit(5)
    .populate("homeTeam awayTeam", "teamName shortName teamLogo")
    .populate("league", "leagueName name")
    .lean();

  let won = 0;
  let drawn = 0;
  let lost = 0;

  const form: string[] = (rawRecentMatches || []).map((m: any) => {
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

  const recentMatches = (rawRecentMatches || []).map((m: any) => ({
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

  // MATCH RESULTS
  const matchIds = rawRecentMatches.map((m: any) => m._id);

  const matchResults = await MatchResult.find({
    match: { $in: matchIds },
    team: teamObjectId,
  }).populate("player", "firstName lastName jerseyNumber");

  // TEAM INFO
  const [team, subDoc, subscriberCount] = await Promise.all([
    Team.findById(teamObjectId).select(
      "teamName shortName teamLogo city country stadiumName coin marketValue ageGroup teamType",
    ),
    userId && mongoose.Types.ObjectId.isValid(userId)
      ? TeamSubscription.findOne({ user: userId, team: teamObjectId }).lean()
      : null,
    TeamSubscription.countDocuments({ team: teamObjectId, isBellActive: true }),
  ]);

  const teamForm = {
    title: "Team Form",
    form,
    formString,
    won,
    drawn,
    lost,
    total: form.length,
  };

  return {
    team,
    coin: team?.coin ?? 0,
    marketValue: team?.marketValue ?? 0,
    totalPlayers,
    players,
    upcomingMatches,
    recentMatches,
    form,
    formString,
    won,
    drawn,
    lost,
    totalFormMatches: form.length,
    teamForm,
    matchResults,
    isSubscribed: !!subDoc?.isBellActive,
    subscriberCount,
  };
};

const getClubOverviewFromDB = async (teamId: string) => {
  const teamObjectId = new mongoose.Types.ObjectId(teamId);

  // Team Info
  const managerTeam = await ManagerTeam.findOne({
    team: teamObjectId,
  });

  if (!managerTeam) {
    throw new Error("Team not found");
  }

  // Current League
  const latestMatch = await Match.findOne({
    $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
  }).sort({ createdAt: -1 });

  if (!latestMatch) {
    return null;
  }

  const leagueId = latestMatch.league;

  // All finished matches in league
  const matches = await Match.find({
    league: leagueId,
    status: "finished",
  });

  const standings: Record<string, any> = {};

  matches.forEach((match) => {
    const homeId = match.homeTeam.toString();
    const awayId = match.awayTeam.toString();

    if (!standings[homeId]) {
      standings[homeId] = {
        teamId: homeId,
        points: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalDifference: 0,
      };
    }

    if (!standings[awayId]) {
      standings[awayId] = {
        teamId: awayId,
        points: 0,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalDifference: 0,
      };
    }

    standings[homeId].played++;
    standings[awayId].played++;

    standings[homeId].goalDifference += match.homeScore - match.awayScore;

    standings[awayId].goalDifference += match.awayScore - match.homeScore;

    if (match.homeScore > match.awayScore) {
      standings[homeId].wins++;
      standings[homeId].points += 3;

      standings[awayId].losses++;
    } else if (match.homeScore < match.awayScore) {
      standings[awayId].wins++;
      standings[awayId].points += 3;

      standings[homeId].losses++;
    } else {
      standings[homeId].draws++;
      standings[awayId].draws++;

      standings[homeId].points += 1;
      standings[awayId].points += 1;
    }
  });

  // Sort Table
  const table = Object.values(standings).sort(
    (a: any, b: any) =>
      b.points - a.points || b.goalDifference - a.goalDifference,
  );

  const position =
    table.findIndex((item: any) => item.teamId === teamObjectId.toString()) + 1;

  const currentTeam = table.find(
    (item: any) => item.teamId === teamObjectId.toString(),
  );

  // Last 2 Results
  const recentResults = await Match.find({
    $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
    status: "finished",
  })
    .sort({ matchDate: -1 })
    .limit(2)
    .populate("homeTeam awayTeam", "teamName shortName teamLogo");

  // Next 2 Matches
  const upcomingMatches = await Match.find({
    $or: [{ homeTeam: teamObjectId }, { awayTeam: teamObjectId }],
    status: "upcoming",
  })
    .sort({ matchDate: 1 })
    .limit(2)
    .populate("homeTeam awayTeam", "teamName shortName teamLogo");

  return {
    position,
    points: currentTeam?.points || 0,
    recentResults,
    upcomingMatches,
  };
};

export const TeamDashboardService = {
  getTeamDashboardFromDB,
  getClubOverviewFromDB,
};
