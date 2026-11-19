import ApiError from "../../../errors/ApiErrors";
import { MatchPlayerSelection } from "./matchPlayerSelection.model";
import { Match } from "../match/match.model";
import { Team } from "../team/team.model";
import { ManagerTeam } from "../managerTeam/managerTeam.model";
import { User } from "../user/user.model";
import { USER_ROLES } from "../../../enums/user";
import { NotificationQueueHelper } from "../../../helpers/bullMQ/bullHelper";
import { NOTIFICATION_TYPE } from "../notification/notification.interface";

// Helper to verify all selected players belong to the specified team
const validatePlayersBelongToTeam = async (players: any[], teamId: string) => {
  if (!Array.isArray(players) || players.length === 0) return;

  const playerIds = players
    .map((p: any) => p.player?.toString())
    .filter(Boolean);
  const playerUsers = await User.find({ _id: { $in: playerIds } }).select(
    "firstName lastName selectTeam",
  );

  for (const playerUser of playerUsers) {
    if (
      !playerUser.selectTeam ||
      playerUser.selectTeam.toString() !== teamId.toString()
    ) {
      const playerName =
        `${playerUser.firstName || ""} ${playerUser.lastName || ""}`.trim() ||
        "Selected player";
      throw new ApiError(
        400,
        `Player "${playerName}" does not belong to this team. You can only select players from your own team.`,
      );
    }
  }
};

// Helper to verify if the logged-in manager is assigned to the specified team
const verifyManagerOfTeam = async (user: any, teamId: string) => {
  if (!user) {
    throw new ApiError(401, "Unauthorized access");
  }

  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPER_ADMIN) {
    return true;
  }

  if (user.role === USER_ROLES.MANAGER) {
    const isManagerOfTeam = await ManagerTeam.findOne({
      manager: user._id || user.id,
      team: teamId,
    });

    if (!isManagerOfTeam) {
      throw new ApiError(
        403,
        "Access Denied: You are not the assigned official manager of this team.",
      );
    }

    return true;
  }

  throw new ApiError(
    403,
    "Access Denied: Only managers can perform player selection.",
  );
};

// CREATE
const createSelectionIntoDB = async (payload: any, user: any) => {
  const { match, team, players, teamFormation } = payload;

  // Verify logged-in manager is assigned to this team
  await verifyManagerOfTeam(user, team);

  if (!teamFormation) {
    throw new ApiError(400, "Team formation is required");
  }

  if (!Array.isArray(players) || players.length === 0) {
    throw new ApiError(400, "Players array is required");
  }

  // Verify all selected players belong to this team
  await validatePlayersBelongToTeam(players, team.toString());

  // Validate maxPlayersPerTeam set by Admin
  // const matchData = await Match.findById(match);
  // if (matchData && (matchData as any).maxPlayersPerTeam) {
  //   const maxAllowed = (matchData as any).maxPlayersPerTeam;
  //   if (players.length > maxAllowed) {
  //     throw new ApiError(
  //       400,
  //       `Maximum ${maxAllowed} players allowed per team for this match as set by Admin`,
  //     );
  //   }
  // }

  const unique = new Set(players.map((p: any) => p.player.toString()));
  if (unique.size !== players.length) {
    throw new ApiError(400, "Duplicate players not allowed");
  }

  const result = await MatchPlayerSelection.create({
    match,
    team,
    teamFormation,
    players: players.map((p: any) => ({
      player: p.player,
      position: p.position,
      positionIndex: p.positionIndex,
      substitute: p.substitute ?? false,
    })),
  });

  // Get Team info
  const teamData = await Team.findById(team);
  const teamName = teamData?.teamName || "your team";

  // Send notification to selected players via background queue
  const notifyPromises = players
    .filter((p) => p.player)
    .map((p) => {
      const positionText = p.position ? `as a ${p.position} ` : "";
      const statusText = p.substitute ? "(Substitute)" : "(Starting Lineup)";
      return NotificationQueueHelper.sendNotification(
        p.player.toString(),
        `You have been selected to play ${positionText}${statusText} for ${teamName} in the upcoming match.`,
        "You are Selected",
        NOTIFICATION_TYPE.GENERAL,
        undefined,
        match.toString(),
        "Match",
      );
    });

  await Promise.all(notifyPromises);

  return result;
};

// GET ALL
// const getAllSelectionsFromDB = async () => {

//   const result = await MatchPlayerSelection.find()
//     .populate("match")
//     .populate("team")
//     .populate({
//       path: "players.player",
//       model: "UserDetails", // IMPORTANT FIX
//     })
//     .lean();

//   if (!result.length) {

//     return [];
//   }

//   const formatted = result.map((item: any, itemIndex: number) => {

//     const players = (item.players || []).map((p: any, playerIndex: number) => {

//       const userDetails = p.player;

//       if (!userDetails) {

//       }

//       return {
//         _id: userDetails?._id || null,

//         firstName: userDetails?.firstName || null,
//         lastName: userDetails?.lastName || null,

//         position: p.position,
//         substitute: p.substitute,

//         profile: userDetails?.profile || null,
//       };
//     });

//     return {
//       _id: item._id,
//       match: item.match,
//       team: item.team,
//       players,
//       createdAt: item.createdAt,
//       updatedAt: item.updatedAt,
//     };
//   });

//   return formatted;
// };

const getAllSelectionsFromDB = async () => {
  const result = await MatchPlayerSelection.find()
    .populate({
      path: "players.player",
      model: "User",
      select: "_id profile firstName lastName jerseyNumber",
    })
    .lean();

  if (!result.length) return [];

  // STEP 5: merge both User + UserDetails
  const formattedResult = result.map((match: any) => ({
    ...match,
    players: match.players.map((p: any) => {
      const user = p.player;

      return {
        position: p.position,
        substitute: p.substitute,
        positionIndex: p.positionIndex,

        // FLAT OUTPUT (NO nested object)
        _id: user?._id,
        profile: user?.profile,
        firstName: user?.firstName,
        lastName: user?.lastName,
        jerseyNumber: user?.jerseyNumber,
      };
    }),
  }));

  return formattedResult;
};

// GET SINGLE
const getSingleSelectionFromDB = async (id: string) => {
  const result = await MatchPlayerSelection.findById(id)
    .populate("match")
    .populate("team")
    .populate("players.player");

  if (!result) throw new ApiError(404, "Selection not found");

  return result;
};

// UPDATE
const updateSelectionIntoDB = async (id: string, payload: any, user: any) => {
  const isExist = await MatchPlayerSelection.findById(id);
  if (!isExist) throw new ApiError(404, "Selection not found");

  const targetTeamId = payload.team || isExist.team;
  // Verify logged-in manager is assigned to this team
  await verifyManagerOfTeam(user, targetTeamId.toString());

  const targetMatchId = payload.match || isExist.match;
  if (payload.players && Array.isArray(payload.players)) {
    // Verify all selected players belong to this team
    await validatePlayersBelongToTeam(payload.players, targetTeamId.toString());

    // const matchData = await Match.findById(targetMatchId);
  //   if (matchData && (matchData as any).maxPlayersPerTeam) {
  //     const maxAllowed = (matchData as any).maxPlayersPerTeam;
  //     if (payload.players.length > maxAllowed) {
  //       throw new ApiError(
  //         400,
  //         `Maximum ${maxAllowed} players allowed per team for this match as set by Admin`,
  //       );
  //     }
  //   }
  }

  const updated = await MatchPlayerSelection.findByIdAndUpdate(
    id,
    {
      $set: {
        match: payload.match,
        team: payload.team,
        players: payload.players?.map((p: any) => ({
          player: p.player,
          position: p.position,
          positionIndex: p.positionIndex,
          substitute: p.substitute ?? false,
        })),
      },
    },
    { new: true },
  )
    .populate("match")
    .populate("team")
    .populate("players.player");

  if (!updated) throw new ApiError(404, "Selection not found");

  return updated;
};

// DELETE
const deleteSelectionFromDB = async (id: string, user: any) => {
  const isExist = await MatchPlayerSelection.findById(id);
  if (!isExist) throw new ApiError(404, "Selection not found");

  // Verify logged-in manager is assigned to this team
  await verifyManagerOfTeam(user, isExist.team.toString());

  const deleted = await MatchPlayerSelection.findByIdAndDelete(id);

  return deleted;
};

const getPlayersByMatchAndTeamFromDB = async (
  matchId: string,
  teamId: string,
) => {
  if (!matchId || !teamId) {
    throw new ApiError(400, "matchId and teamId are required");
  }

  // STEP 1: GET LATEST DOCUMENT
  const resultArr = await MatchPlayerSelection.find({
    match: matchId,
    team: teamId,
  })
    .sort({ createdAt: -1 }) // latest first
    .limit(1)
    .populate({
      path: "match",
    })
    .populate({
      path: "team",
    })
    .populate({
      path: "players.player",
      model: "User",
      select: "_id profile firstName lastName jerseyNumber",
    })
    .lean();

  const result = resultArr[0];

  if (!result) {
    throw new ApiError(404, "No players found for this match and team");
  }

  // STEP 5: FORMAT RESPONSE
  const formattedResult = {
    ...result,

    // ensure always present
    teamFormation: result.teamFormation || "4-4-2",

    players: result.players.map((p: any) => {
      const user = p.player;

      return {
        position: p.position,
        substitute: p.substitute,
        positionIndex: p.positionIndex,

        _id: user?._id,
        profile: user?.profile,
        firstName: user?.firstName || null,
        lastName: user?.lastName || null,
        jerseyNumber: user?.jerseyNumber,
      };
    }),
  };

  return formattedResult;
};

export const MatchPlayerSelectionService = {
  createSelectionIntoDB,
  getAllSelectionsFromDB,
  getSingleSelectionFromDB,
  updateSelectionIntoDB,
  deleteSelectionFromDB,
  getPlayersByMatchAndTeamFromDB,
};
