import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError, logger } from "../helpers";
import { verifyAccessToken } from "../helpers/jwt";
import { findAdminByIdRepo } from "../repositories/authRepo";
import { getAllowedRoles, isPublicRoute } from "../rbac/rbacRules";
import { AccessTokenPayload } from "../types/authTypes";

function requestPath(req: Request): string {
  const combined = `${req.baseUrl}${req.path}`;
  if (combined.length > 1 && combined.endsWith("/")) {
    return combined.slice(0, -1);
  }

  return combined || "/";
}

export async function rbacAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const path = requestPath(req);
    if (isPublicRoute(req.method, path)) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next(
        new AppError(
          401,
          "Missing or invalid access token",
          true,
          "TOKEN_MISSING",
        ),
      );
    }

    const token = authHeader.split(" ")[1];
    let decodedToken: AccessTokenPayload;
    try {
      decodedToken = verifyAccessToken(token);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return next(
          new AppError(401, "Access token expired", true, "TOKEN_EXPIRED"),
        );
      }
      return next(
        new AppError(401, "Invalid access token", true, "TOKEN_INVALID"),
      );
    }

    const admin = await findAdminByIdRepo(decodedToken.user_id);
    if (!admin || !admin.is_active) {
      return next(
        new AppError(
          401,
          "Account is no longer active",
          true,
          "ACCOUNT_INACTIVE",
        ),
      );
    }

    const allowedRoles = getAllowedRoles(req.method, path);
    if (!allowedRoles) {
      return next(new AppError(404, "Route not found"));
    }
    if (!allowedRoles?.includes(admin.role)) {
      return next(
        new AppError(
          403,
          "You don't have permission to perform this action",
          true,
          "FORBIDDEN",
        ),
      );
    }

    req.user = { id: admin.id, role: admin.role, teamId: admin.admin_id ?? admin.id };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    logger.error(`Unexpected error in rbacAuth middleware: ${error}`);
    next(
      new AppError(
        401,
        "Invalid or expired access token",
        true,
        "TOKEN_INVALID",
      ),
    );
  }
}
