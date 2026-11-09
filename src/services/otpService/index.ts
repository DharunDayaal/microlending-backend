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
import { withTransaction } from "../../config/database";

export async function requestOtp(
  phone_number: string,
  purpose: OtpPurpose,
): Promise<void> {
  const normalizedPhoneNumber = phone_number.trim();

  if (purpose === "VERIFY_PHONE_NUMBER") {
    const existing = await AuthRepository.findAdminByPhoneNumberRepo(
      normalizedPhoneNumber,
    );
    if (existing) {
      throw new AppError(409, "Phone number is already registered");
    }
  }

  // For an unknown number we still go through the whole flow but send no SMS,
  // so the response (and the cooldown) is identical to a real account.
  let sendSms = true;
  if (purpose === "RESET_PASSWORD") {
    const existing = await AuthRepository.findAdminByPhoneNumberRepo(
      normalizedPhoneNumber,
    );
    if (!existing) sendSms = false;
  }

  const otp = await withTransaction(async (client) => {
    // One request per phone + purpose at a time. The lock is released at
    // COMMIT/ROLLBACK, and it is taken before the cooldown read, so the secondre
    // request sees the first one's row.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `otp:${purpose}:${normalizedPhoneNumber}`,
    ]);

    const lastOtp = await OtpRepository.findLatestOtpRepo(
      normalizedPhoneNumber,
      purpose,
      client,
    );
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

    const code = generateOtp();
    const otpHash = await hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    await OtpRepository.createOtpRepo(
      normalizedPhoneNumber,
      otpHash,
      purpose,
      expiresAt,
      client,
    );
    return code;
  });

  // after COMMIT, so the lock is never held during the SMS call
  if (sendSms) {
    await sendOtpSms(normalizedPhoneNumber, otp);
  }
}

export async function verifyOtp(
  phone_number: string,
  otp: string,
  purpose: OtpPurpose,
): Promise<void> {
  type Outcome = { ok: true } | { ok: false; status: number; message: string };

  const outcome = await withTransaction<Outcome>(async (client) => {
    const record = await OtpRepository.findLatestOtpForUpdateRepo(
      client,
      phone_number.trim(),
      purpose,
    );
    if (!record || new Date(record.expires_at).getTime() <= Date.now()) {
      return { ok: false, status: 400, message: "Invalid or expired OTP" };
    }
    if (record.verified_at) {
      return {
        ok: false,
        status: 400,
        message: "OTP has already been verified",
      };
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      return {
        ok: false,
        status: 429,
        message: "Too many failed attempts. Please request a new OTP.",
      };
    }

    const isValidOtp = await compareOtp(otp, record.otp_hash);
    if (!isValidOtp) {
      // return, don't throw: the attempt count must commit
      await OtpRepository.incrementOtpAttemptsRepo(client, record.id);
      return { ok: false, status: 400, message: "Invalid OTP" };
    }

    await OtpRepository.markOtpVerification(client, record.id);
    return { ok: true };
  });

  if (!outcome.ok) {
    throw new AppError(outcome.status, outcome.message);
  }
}
