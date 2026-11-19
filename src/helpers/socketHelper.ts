import colors from "colors";
import { Server, Socket } from "socket.io";
import { Secret } from "jsonwebtoken";
import config from "../config";
import { jwtHelper } from "./jwtHelper";
import { logger } from "../shared/logger";
import { socketService } from "./socket/service";
import { USER_ROLES } from "../enums/user";

const socket = (io: Server) => {
  // Initialize SocketService (Redis Adapter is initialized in serverLifecycle.ts)
  socketService.init(io);

  // Socket Authentication Middleware
  io.use((socket: Socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers?.authorization?.startsWith("Bearer ")
          ? socket.handshake.headers.authorization.split(" ")[1]
          : socket.handshake.headers?.authorization) ||
        socket.handshake.query?.token;

      if (!token || typeof token !== "string") {
        // Allow unauthenticated connection for public rooms (e.g. guest watching match live score)
        socket.data.user = null;
        return next();
      }

      try {
        const decoded = jwtHelper.verifyToken(
          token,
          config.jwt.jwt_secret as Secret,
        );
        socket.data.user = decoded;
        return next();
      } catch {
        return next(
          new Error("Authentication error: Invalid or expired token"),
        );
      }
    } catch (err: any) {
      return next(err);
    }
  });

  io.on("connection", (socket: Socket) => {
    logger.info(colors.blue("A User connected: " + socket.id));

    // Auto-join private room if authenticated
    if (socket.data.user) {
      const authUserId = (
        socket.data.user._id || socket.data.user.id
      )?.toString();
      if (authUserId) {
        socket.join(authUserId);
        socket.join(`user-${authUserId}`);
        logger.info(
          colors.green(
            `Authenticated user auto-joined room: user-${authUserId}`,
          ),
        );
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // JOIN USER-SPECIFIC ROOM (With Auth Protection & Legacy Support)
    // ─────────────────────────────────────────────────────────────────────
    socket.on("join", (requestedUserId: any) => {
      const authUser = socket.data.user;

      if (authUser) {
        const callerId = (authUser._id || authUser.id)?.toString();
        const isAdmin =
          authUser.role === USER_ROLES.ADMIN ||
          authUser.role === USER_ROLES.SUPER_ADMIN;

        let targetId = callerId;
        if (isAdmin && requestedUserId) {
          targetId =
            typeof requestedUserId === "object"
              ? requestedUserId._id || requestedUserId.id || callerId
              : requestedUserId.toString();
        }

        if (targetId) {
          socket.join(targetId);
          socket.join(`user-${targetId}`);
          logger.info(
            colors.green(
              `Authenticated User (${targetId}) joined room: user-${targetId}`,
            ),
          );
        }
      } else if (requestedUserId) {
        // Fallback for older mobile app builds that have not yet updated to send the token
        let actualUserId = requestedUserId;
        if (typeof requestedUserId === "object" && requestedUserId !== null) {
          actualUserId =
            requestedUserId._id || requestedUserId.id || requestedUserId.userId;
        }
        if (actualUserId) {
          const strUserId = actualUserId.toString();
          socket.join(strUserId);
          socket.join(`user-${strUserId}`);
          logger.info(
            colors.yellow(`Legacy unauthenticated join: user-${strUserId}`),
          );
        }
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // LEAVE USER-SPECIFIC ROOM
    // ─────────────────────────────────────────────────────────────────────
    socket.on("leave", (userId: any) => {
      if (userId) {
        let actualUserId = userId;
        if (typeof userId === "object" && userId !== null) {
          actualUserId = userId._id || userId.id || userId.userId;
        }
        if (actualUserId) {
          const strUserId = actualUserId.toString();
          socket.leave(strUserId);
          socket.leave(`user-${strUserId}`);
          logger.info(
            colors.yellow(
              `User ${strUserId} left room: ${strUserId} & user-${strUserId}`,
            ),
          );
        }
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // JOIN/LEAVE MATCH DETAIL ROOMS (OPTIMIZATION)
    // ─────────────────────────────────────────────────────────────────────
    socket.on("join_match", (matchId: any) => {
      if (matchId) {
        let actualMatchId = matchId;
        if (typeof matchId === "object" && matchId !== null) {
          actualMatchId = matchId._id || matchId.id || matchId.matchId;
        }
        if (actualMatchId) {
          const strMatchId = actualMatchId.toString();
          socket.join(`match_${strMatchId}`);
          logger.info(
            colors.green(
              `Socket ${socket.id} joined room: match_${strMatchId}`,
            ),
          );
        }
      }
    });

    socket.on("leave_match", (matchId: any) => {
      if (matchId) {
        let actualMatchId = matchId;
        if (typeof matchId === "object" && matchId !== null) {
          actualMatchId = matchId._id || matchId.id || matchId.matchId;
        }
        if (actualMatchId) {
          const strMatchId = actualMatchId.toString();
          socket.leave(`match_${strMatchId}`);
          logger.info(
            colors.yellow(
              `Socket ${socket.id} left room: match_${strMatchId}`,
            ),
          );
        }
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      logger.info(colors.red("A user disconnected: " + socket.id));
    });
  });
};

export const socketHelper = { socket };
