import { OtpPurpose } from "../../types/authTypes";
import * as AuthRepository from "../../repositories/authRepo";
import * as OtpRepository from "../../repositories/otpRepo";
import { AppError, compareOtp, hashOtp, sendOtpSms } from "../../helpers";
import {
  OTP_EXPIRY_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from "../../constants";
import { generateOtp } from "../../helpers";
import { getPool } from "../../config/database";

export async function requestOtp(
  phone_number: string,
  purpose: OtpPurpose,
): Promise<void> {
  if (purpose === "VERIFY_PHONE_NUMBER") {
    const existing =
      await AuthRepository.findAdminByPhoneNumberRepo(phone_number);
    if (existing) {
      throw new AppError(409, "Phone number is already registered");
    }
  }

  if (purpose === "RESET_PASSWORD") {
    const existing =
      await AuthRepository.findAdminByPhoneNumberRepo(phone_number);
    if (!existing) {
      throw new AppError(409, "No account found with this phone number");
    }
  }

  const lastOtp = await OtpRepository.findLatestOtpRepo(phone_number, purpose);
  if (lastOtp) {
    const secondsSinceLastOtp =
      (Date.now() - lastOtp.created_at.getTime()) / 1000;
    if (secondsSinceLastOtp < OTP_RESEND_COOLDOWN_SECONDS) {
      throw new AppError(
        429,
        `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastOtp)} seconds before requesting a new OTP`,
      );
    }
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await OtpRepository.createOtpRepo(phone_number, otpHash, purpose, expiresAt);
  await sendOtpSms(phone_number, otp);
}

export async function verifyOtp(
  phone_number: string,
  otp: string,
  purpose: OtpPurpose,
): Promise<void> {
  const record = await OtpRepository.findLatestOtpRepo(phone_number, purpose);
  if (!record || record.expires_at < new Date()) {
    throw new AppError(400, "Invalid or expired OTP");
  }
  if (record.verified_at) {
    throw new AppError(400, "OTP has already been verified");
  }
  if (record.attempts >= OTP_MAX_ATTEMPTS)
    throw new AppError(
      429,
      "Too many failed attempts. Please request a new OTP.",
    );

  const isValidOtp = await compareOtp(otp, record.otp_hash);
  if (!isValidOtp) {
    await OtpRepository.incrementOtpAttemptsRepo(getPool(),record.id);
    throw new AppError(400, "Invalid OTP");
  }

  await OtpRepository.markOtpVerification(getPool(), record.id);
}
