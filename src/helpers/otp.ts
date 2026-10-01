import { comparePassword, hashPassword } from ".";
import { NODE_ENV } from "../config/env";
import { DEV_OTP_CODE } from "../constants";
import crypto from "crypto";

export function generateOtp(): string {
  if (NODE_ENV !== "production") {
    return DEV_OTP_CODE;
  }

  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export const hashOtp = hashPassword;
export const compareOtp = comparePassword;
