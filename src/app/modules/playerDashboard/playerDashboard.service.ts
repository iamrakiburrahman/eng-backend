import mongoose from "mongoose";

import { MatchResult } from "../matchResult/matchResult.model";
import { Team } from "../team/team.model";
import { User } from "../user/user.model";


import { StatusCodes } from "http-status-codes";
import { USER_ROLES } from "../../../enums/user";
import ApiError from "../../../errors/ApiErrors";

import { Subscription } from "../subscription/subscription.model";
import { isPremiumPlayerPackage } from "../../../helpers/packageHelper";
import { getPlayerStatsSummary } from "../../../helpers/playerStatsHelper";
import { LiveTransferMarket } from "../liveTransferMarket/liveTransferMarket.model";

const getPlayerDashboardFromDB = async (playerId: string) => {
  const playerObjectId = new mongoose.Types.ObjectId(playerId);

  // PLAYER INFO (Filter by PLAYER / TOURNAMENT_PLAYER / OTHER_CLUBS roles)
  const player = await User.findOne({
    _id: playerObjectId,
    role: { $in: [USER_ROLES.PLAYER, USER_ROLES.TOURNAMENT_PLAYER, USER_ROLES.OTHER_CLUBS] },
  }).populate("selectTeam");

  if (!player) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Player not found or specified user is not a player");
  }

  // Calculate age
  const today = new Date();
  const dob = player.dateOfBirth ? new Date(player.dateOfBirth) : today;

  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();

  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getDate() < dob.getDate())
  ) {
    age--;
  }

  const playerData: any = player.toObject();

  // Add profile and age separately
  playerData.profile = playerData.profile || null;
//   playerData.age = age;

  // Optional: mapping _id to userId for consistency
  playerData.userId = playerObjectId;

  // MATCH STATS (Goals, Assists, Clean Sheets, Player Of The Day, Yellow Card, Red Card)
  const stats = await getPlayerStatsSummary(playerObjectId);

  // RECENT MATCHES
  const recentMatches = await MatchResult.find({
    player: playerObjectId,
  })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("match team");

  const [activeSub, activeListing] = await Promise.all([
    Subscription.findOne({
      user: player._id,
      status: "active",
    } as any)
      .sort({ createdAt: -1 })
      .populate("package")
      .lean(),
    LiveTransferMarket.findOne({
      player: player._id,
      status: "ACTIVE",
    }).lean(),
  ]);

  const pkg: any = activeSub?.package;
  const isPremium = await isPremiumPlayerPackage(pkg);
  const isListedOnMarket = Boolean(activeListing || player.isLiveTransferListed);

  playerData.isSubscribed = Boolean(activeSub || player.isSubscribed);
  playerData.hasAccess = Boolean(activeSub || player.hasAccess);
  playerData.isPaid = Boolean(activeSub || player.isSubscribed || player.hasAccess);
  playerData.isListedOnMarket = isListedOnMarket;
  playerData.isLiveTransferListed = isListedOnMarket;

  if (!isPremium) {
    playerData.engCoine = null;
    playerData.marketValue = null;
  }

  return {
    player: playerData,
    activeSubscription: activeSub || null,
    activePackage: activeSub?.package || null,
    isPremium,
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
    recentMatches: isPremium ? recentMatches : [],
  };
};

export const PlayerDashboardService = {
  getPlayerDashboardFromDB,
};