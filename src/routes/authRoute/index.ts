import * as AuthController from "../../controllers/authController";
import { Router } from "express";
import {
  registerSchema,
  requestOtpSchema,
  verifyOtpSchema,
  loginByEmailSchema,
  loginByPhoneSchema,
  refreshTokenSchema,
} from "../../schemas/authSchema";
import { validateBody } from "../../middleware/validateBody";
import { rbacAuth } from "../../middleware/rbacAuth";

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
  "/refresh",
  validateBody(refreshTokenSchema),
  rbacAuth,
  AuthController.refreshTokens,
);

router.post(
  "/logout",
  validateBody(refreshTokenSchema),
  rbacAuth,
  AuthController.logout,
);

export default router;
