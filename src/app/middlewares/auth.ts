import { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { Secret } from "jsonwebtoken";
import config from "../../config";
import { jwtHelper } from "../../helpers/jwtHelper";
import ApiError from "../../errors/ApiErrors";
import { User } from "../modules/user/user.model";

const auth =
  (...args: any[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;

      // ----------------------------------------
      // 1. Parse options
      // ----------------------------------------

      let required = true;
      let roles: string[] = [];

      if (args.length === 1 && typeof args[0] === "boolean") {
        required = args[0]; // auth(false)
      } else {
        roles = args; // auth("ADMIN", "USER")
      }

      // ----------------------------------------
      // 2. No token case (Guest handling)
      // ----------------------------------------

      const isInvalidHeader =
        !authHeader ||
        authHeader === "null" ||
        authHeader === "undefined" ||
        authHeader.trim() === "";

      if (isInvalidHeader) {
        if (required) {
          throw new ApiError(
            StatusCodes.UNAUTHORIZED,
            "You are not authorized",
          );
        }

        req.user = null; // guest user
        return next();
      }

      // ----------------------------------------
      // 3. Token extract
      // ----------------------------------------

      const token = authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : authHeader;

      const isInvalidToken =
        !token ||
        token === "null" ||
        token === "undefined" ||
        token.trim() === "";

      if (isInvalidToken) {
        if (required) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, "Token not found");
        }

        req.user = null;
        return next();
      }

      // ----------------------------------------
      // 4. Verify token
      // ----------------------------------------

      let decoded;
      try {
        decoded = jwtHelper.verifyToken(token, config.jwt.jwt_secret as Secret);
      } catch (err) {
        if (required) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid token");
        }

        req.user = null;
        return next();
      }

      // ----------------------------------------
      // 5. DB Verification (User exists and active)
      // ----------------------------------------

      const userId = decoded._id || decoded.id;
      const isExistUser = await User.findById(userId).select("role status verified email");

      if (!isExistUser) {
        if (required) {
          throw new ApiError(StatusCodes.UNAUTHORIZED, "User account no longer exists");
        }
        req.user = null;
        return next();
      }

      if (isExistUser.status === "REJECTED") {
        if (required) {
          throw new ApiError(
            StatusCodes.FORBIDDEN,
            "Your account has been suspended or rejected. Please contact support."
          );
        }
        req.user = null;
        return next();
      }

      req.user = {
        _id: isExistUser._id.toString(),
        id: isExistUser._id.toString(),
        email: isExistUser.email || decoded.email,
        role: isExistUser.role || decoded.role,
      };

      // ----------------------------------------
      // 6. Role check (only if roles given)
      // ----------------------------------------

      if (roles.length) {
        const userRoleUpper = (req.user.role || "")
          .toString()
          .trim()
          .toUpperCase();
        const allowedRolesUpper = roles.map((r) =>
          String(r).trim().toUpperCase(),
        );

        if (!allowedRolesUpper.includes(userRoleUpper)) {
          throw new ApiError(
            StatusCodes.FORBIDDEN,
            "You don't have permission to access this api",
          );
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };

export default auth;
