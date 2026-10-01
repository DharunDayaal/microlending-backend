import type { Request, Response, NextFunction } from "express";
import * as AuthService from "../../services/authService";
import { successResponse } from "../../helpers";
import {
  LoginByEmailSchema,
  LoginByPhoneSchema,
  RefreshTokenSchema,
  RegisterSchema,
  RequestOtpSchema,
  VerifyOtpSchema,
} from "../../schemas/authSchema";
import * as OtpService from "../../services/otpService";

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const payload = req.body as RegisterSchema;

    const admin = await AuthService.registerAdmin(payload);

    successResponse(
      201,
      res,
      { admin },
      "Registration completed. Admin needs to approve your account before you can log in.",
    );
  } catch (error) {
    next(error);
  }
}

export async function requestOtp(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { phone_number, purpose } = req.body as RequestOtpSchema;
    await OtpService.requestOtp(phone_number, purpose);
    successResponse(200, res, {}, "OTP sent successfully");
  } catch (error) {
    next(error);
  }
}

export async function verifyOtp(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { phone_number, otp_code, purpose } = req.body as VerifyOtpSchema;
    await OtpService.verifyOtp(phone_number, otp_code, purpose);
    successResponse(200, res, null, "OTP verified successfully");
  } catch (error) {
    next(error);
  }
}

export async function loginByEmail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const payload = req.body as LoginByEmailSchema;
    const result = await AuthService.loginByEmail(payload);
    successResponse(200, res, result, "Login successful");
  } catch (error) {
    next(error);
  }
}

export async function loginByPhone(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const payload = req.body as LoginByPhoneSchema;
    const result = await AuthService.loginByPhoneNumber(payload);
    successResponse(200, res, result, "Login successful");
  } catch (error) {
    next(error);
  }
}

export async function refreshTokens(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { refresh_token } = req.body as RefreshTokenSchema;
    const tokens = await AuthService.refreshTokens(refresh_token);
    successResponse(200, res, { tokens }, "Tokens refreshed successfully");
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const { refresh_token } = req.body as RefreshTokenSchema;
    await AuthService.revokeRefreshToken(refresh_token);
    successResponse(200, res, null, "Logged out successfully");
  } catch (error) {
    next(error);
  }
}
