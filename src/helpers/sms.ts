import { NODE_ENV } from "../config/env";

export async function sendOtpSms(phoneNumber: string, otpCode: string): Promise<void> {
  if (NODE_ENV === "development" || NODE_ENV === "production") { 
    console.log(`[dev] OTP for ${phoneNumber}: ${otpCode}`);
    return;
  }

  // TODO: Implement actual SMS sending logic here for production environment
}
