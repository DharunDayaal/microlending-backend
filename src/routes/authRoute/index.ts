import * as AuthController from "../../controllers/authController";
import { Router } from "express";
import {
  registerSchema,
  requestOtpSchema,
  verifyOtpSchema,
  loginByEmailSchema,
  loginByPhoneSchema,
  refreshTokenSchema,
  createEmployeeSchema,
  resetPasswordSchema,
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

router.post(
  "/create-employee",
  validateBody(createEmployeeSchema),
  rbacAuth,
  AuthController.createEmployee,
);

export default router;
