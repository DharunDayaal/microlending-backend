import * as AuthController from "./auth.controller";
import { Router } from "express";
import {
  registerSchema,
  requestOtpSchema,
  verifyOtpSchema,
  loginByEmailSchema,
  loginByPhoneSchema,
  refreshTokenSchema,
  resetPasswordSchema,
} from "./auth.schema";
import { validateBody } from "../../shared/middleware/validateBody";
import { rbacAuth } from "./rbac.middleware";

const router = Router();

router.post("/register", validateBody(registerSchema), AuthController.register);

router.post(
  "/otp/request",
  validateBody(requestOtpSchema),
  AuthController.requestOtp,
);

router.post(
  "/otp/verify",
  validateBody(verifyOtpSchema),
  AuthController.verifyOtp,
);

router.post(
  "/login/email",
  validateBody(loginByEmailSchema),
  AuthController.loginByEmail,
);

router.post(
  "/login/phone",
  validateBody(loginByPhoneSchema),
  AuthController.loginByPhone,
);

router.post(
  "/password/reset",
  validateBody(resetPasswordSchema),
  AuthController.resetPassword,
);

router.post(
  "/refresh",
  validateBody(refreshTokenSchema),
  AuthController.refreshTokens,
);

router.post(
  "/logout",
  validateBody(refreshTokenSchema),
  AuthController.logout,
);

export default router;
