import {
  AppError,
  compareOtp,
  comparePassword,
  hashRefreshToken,
  signAccessToken,
  signRefreshToken,
} from "../../helpers";
import { calculateTotalWeeks } from "../../utils";
import * as AuthRepository from "../../repositories/authRepo";
import {
  AdminUserPublic,
  RegisterAdminPayload,
  RequestingUser,
  TokenPair,
} from "../../types/authTypes";
import { hashPassword } from "../../helpers";
import {
  OTP_MAX_ATTEMPTS,
  PG_UNIQUE_VIOLATION_ERROR_CODE,
  VERIFIED_OTP_VALID_FOR_MINUTES,
} from "../../constants";
import { getPool, withTransaction } from "../../config/database";
import * as OtpRepository from "../../repositories/otpRepo";
import {
  CreateEmployeeSchema,
  LoginByEmailSchema,
  LoginByPhoneSchema,
} from "../../schemas/authSchema";
import * as RefreshRepository from "../../repositories/refreshRepository";

function toController(
  admin: Awaited<ReturnType<typeof AuthRepository.createAdminRepo>>,
): AdminUserPublic {
  const { password_hash, ...rest } = admin;
  return rest;
}

export async function registerAdmin(
  payload: RegisterAdminPayload,
): Promise<AdminUserPublic> {
  const passwordHash = await hashPassword(payload.password);
  const totalWeeks = calculateTotalWeeks(payload.default_total_months);
  const validSince = new Date(
    Date.now() - VERIFIED_OTP_VALID_FOR_MINUTES * 60 * 1000,
  );

  const adminPayload = {
    ...payload,
    password_hash: passwordHash,
    default_total_weeks: totalWeeks,
  };

  try {
    const admin = await withTransaction(async (client) => {
      const verifiedOtp =
        await OtpRepository.findVerifiedUncosumedOtpForUpdateRepo(
          client,
          payload.phone_number,
          "VERIFY_PHONE_NUMBER",
          validSince,
        );
      if (!verifiedOtp) {
        throw new AppError(
          400,
          "Phone number has not been verified or OTP has expired",
        );
      }
      const created = await AuthRepository.createAdminRepo(
        client,
        adminPayload,
      );

      await OtpRepository.markOtpConsumedRepo(client, verifiedOtp.id);
      return created;
    });

    return toController(admin);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    const code = (error as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      throw new AppError(409, "Email or phone number is already registered");
    }

    throw error;
  }
}

export async function loginByEmail(
  payload: LoginByEmailSchema,
): Promise<{ tokens: TokenPair; admin: AdminUserPublic }> {
  const admin = await AuthRepository.findAdminByEmailRepo(payload.email);
  if (!admin) {
    throw new AppError(401, "Invalid email or password");
  }

  const isPasswordValid = await comparePassword(
    payload.password,
    admin.password_hash,
  );
  if (!isPasswordValid) {
    throw new AppError(401, "Invalid email or password");
  }

  if (!admin.is_verified) {
    throw new AppError(
      403,
      "Your account is pending approval from a super admin",
      true,
      "ACCOUNT_PENDING_APPROVAL",
    );
  }

  if (!admin.is_active) {
    throw new AppError(
      403,
      "Your account has been deactivated",
      true,
      "ACCOUNT_DEACTIVATED",
    );
  }

  const accessToken = await signAccessToken({
    user_id: admin.id,
    role: admin.role,
    team_id: admin.admin_id ?? admin.id,
  });
  const { token: refreshToken, expiresAt } = signRefreshToken();

  await RefreshRepository.storeRefreshTokenRepo(
    getPool(),
    admin.id,
    hashRefreshToken(refreshToken),
    expiresAt,
  );

  return {
    tokens: { access_token: accessToken, refresh_token: refreshToken },
    admin: toController(admin),
  };
}

export async function loginByPhoneNumber(
  payload: LoginByPhoneSchema,
): Promise<{ tokens: TokenPair; admin: AdminUserPublic }> {
  const admin = await AuthRepository.findAdminByPhoneNumberRepo(
    payload.phone_number,
  );
  if (!admin) {
    throw new AppError(401, "Invalid phone number or OTP");
  }
  if (!admin.is_verified) {
    throw new AppError(
      403,
      "Your account is pending approval from a super admin",
      true,
      "ACCOUNT_PENDING_APPROVAL",
    );
  }
  if (!admin.is_active) {
    throw new AppError(
      403,
      "Your account has been deactivated",
      true,
      "ACCOUNT_DEACTIVATED",
    );
  }

  type OtpOutcome =
    | { ok: true }
    | { ok: false; status: number; message: string };

  const outcome = await withTransaction<OtpOutcome>(async (client) => {
    const otpRecord = await OtpRepository.findOtpForLoginForUpdateRepo(
      client,
      payload.phone_number,
      payload.purpose,
    );

    if (!otpRecord || otpRecord.expires_at < new Date()) {
      return {
        ok: false,
        status: 400,
        message: "Invalid or expired OTP for login",
      };
    }
    if (otpRecord.verified_at) {
      return {
        ok: false,
        status: 400,
        message: "OTP has already been verified",
      };
    }
    if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
      return {
        ok: false,
        status: 429,
        message: "Too many failed attempts. Please request a new OTP.",
      };
    }

    const isValidOtp = await compareOtp(payload.otp_code, otpRecord.otp_hash);
    if (!isValidOtp) {
      await OtpRepository.incrementOtpAttemptsRepo(client, otpRecord.id);
      return { ok: false, status: 400, message: "Invalid OTP for login" };
    }

    await OtpRepository.markOtpVerification(client, otpRecord.id);
    await OtpRepository.markOtpConsumedRepo(client, otpRecord.id);
    return { ok: true };
  });

  if (!outcome.ok) {
    throw new AppError(outcome.status, outcome.message);
  }

  const accessToken = signAccessToken({
    user_id: admin.id,
    role: admin.role,
    team_id: admin.admin_id ?? admin.id,
  });
  const { token: refreshToken, expiresAt } = signRefreshToken();
  await RefreshRepository.storeRefreshTokenRepo(
    getPool(),
    admin.id,
    hashRefreshToken(refreshToken),
    expiresAt,
  );

  return {
    tokens: { access_token: accessToken, refresh_token: refreshToken },
    admin: toController(admin),
  };
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const tokenHash = hashRefreshToken(refreshToken);
  const outcome = await withTransaction(async (client) => {
    const record = await RefreshRepository.findRefreshTokenByHashForUpdateRepo(
      client,
      tokenHash,
    );
    if (!record) {
      return { ok: false, status: 401, message: "Invalid refresh token" };
    }

    if (record.revoked_at) {
      // Reuse of an already-revoked token signals theft — kill every
      // session for this user. This must commit even though the refresh
      // itself fails
      await RefreshRepository.revokeAllRefreshTokensForUserRepo(
        client,
        record.user_id,
      );
      return {
        ok: false,
        status: 401,
        message: "Refresh token has been revoked. Please login again",
      };
    }

    if (record.expires_at < new Date()) {
      return {
        ok: false,
        status: 401,
        message: "Refresh token has expired. Please login again",
      };
    }

    await RefreshRepository.revokeRefreshTokenRepo(client, record.id);

    const { token: newRefreshToken, expiresAt } = signRefreshToken();
    await RefreshRepository.storeRefreshTokenRepo(
      client,
      record.user_id,
      hashRefreshToken(newRefreshToken),
      expiresAt,
    );

    return { ok: true, userId: record.user_id, newRefreshToken };
  });

  if (!outcome.ok) {
    throw new AppError(outcome.status!, outcome.message!);
  }

  const admin = await AuthRepository.findAdminByIdRepo(outcome.userId!);
  if (!admin || !admin.is_active) {
    throw new AppError(401, "Account no longer active");
  }

  const accessToken = signAccessToken({
    user_id: admin.id,
    role: admin.role,
    team_id: admin.admin_id ?? admin.id,
  });

  return { access_token: accessToken, refresh_token: outcome.newRefreshToken! };
}

export async function revokeAllRefreshToken(
  refreshToken: string,
): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);
  const record = await RefreshRepository.findRefreshTokenByHashRepo(tokenHash);
  if (record && !record.revoked_at) {
    await RefreshRepository.revokeAllRefreshTokensForUserRepo(
      getPool(),
      record.user_id,
    );
  }
}

export async function createEmployee(
  payload: CreateEmployeeSchema,
  creator: RequestingUser,
): Promise<AdminUserPublic> {
  if (creator.role !== "ADMIN") {
    throw new AppError(403, "Only admins can create employees");
  }

  const passwordHash = await hashPassword(payload.password);
  const hasOverrides = payload.default_total_months !== undefined;

  try {
    const employee = await AuthRepository.createEmployeeRepo({
      user_name: payload.user_name,
      phone_number: payload.phone_number,
      email: payload.email,
      password_hash: passwordHash,
      admin_id: creator.id,
      default_upfront_fee_percentage: payload.default_upfront_fee_percentage,
      default_interest_percentage: payload.default_interest_percentage,
      default_total_months: payload.default_total_months,
      default_total_weeks: hasOverrides
        ? calculateTotalWeeks(payload.default_total_months!)
        : undefined,
    });
    return toController(employee);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      throw new AppError(409, "Email or phone number is already registered");
    }
    throw error;
  }
}
