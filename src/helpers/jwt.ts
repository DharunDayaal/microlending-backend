import jwt from "jsonwebtoken";
import crypto from "crypto";
import { JWT_ACCESS_EXPIRY, JWT_REFRESH_EXPIRY_DAYS } from "../constants";
import { JWT_ACCESS_SECRET, JWT_REFRESH_SECRET } from "../config/env";
import { AccessTokenPayload } from "../types/authTypes";

if (!JWT_ACCESS_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error("JWT secrets must be set");
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_ACCESS_SECRET as string, {
    expiresIn: JWT_ACCESS_EXPIRY,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decodeToken = jwt.verify(
    token,
    JWT_ACCESS_SECRET as string,
  ) as AccessTokenPayload;

  if (
    typeof decodeToken !== "object" ||
    decodeToken === null ||
    typeof decodeToken.userId !== "string" ||
    (decodeToken.role !== "ADMIN" && decodeToken.role !== "SUPER_ADMIN")
  ) {
    throw new Error("Invalid token payload");
  }

  return {
    userId: decodeToken.userId,
    role: decodeToken.role,
  };
}

export function signRefreshToken(): { token: string; expiresAt: Date } {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + JWT_REFRESH_EXPIRY_DAYS);
  const token = crypto.randomBytes(48).toString("hex");

  return { token, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
