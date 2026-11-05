import type { NextFunction, Request, Response } from "express";
import { AppError, successResponse } from "../../helpers";
import * as Service from "../../services/profileService";
import {
  activeSchema,
  changePasswordSchema,
  changePhoneSchema,
  idParamSchema,
  updateDefaultsSchema,
  updateLimitsSchema,
  updateProfileSchema,
  verificationSchema,
} from "../../schemas/profileSchema";
import type {
  ListAdminsQuerySchema,
  StatsQuerySchema,
  TeamQuerySchema,
} from "../../schemas/profileSchema";

type Handler = (req: Request, res: Response) => Promise<void>;

const wrap =
  (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

const q = <T>(res: Response) => res.locals.query as T;

function idParam(value: unknown, label: string): string {
  const parsed = idParamSchema.safeParse(String(value));
  if (!parsed.success) throw new AppError(400, `Invalid ${label}`);
  return parsed.data;
}

export const getMe = wrap(async (req, res) => {
  const profile = await Service.getProfile(req.user!);
  successResponse(200, res, { profile }, "Profile fetched successfully");
});

export const updateMe = wrap(async (req, res) => {
  const payload = updateProfileSchema.parse(req.body);
  const profile = await Service.updateProfile(req.user!, payload);
  successResponse(200, res, { profile }, "Profile updated successfully");
});

export const changePhone = wrap(async (req, res) => {
  const payload = changePhoneSchema.parse(req.body);
  const profile = await Service.changePhone(req.user!, payload);
  successResponse(200, res, { profile }, "Phone number updated successfully");
});

export const changePassword = wrap(async (req, res) => {
  const payload = changePasswordSchema.parse(req.body);
  const result = await Service.changePassword(req.user!, payload);
  successResponse(200, res, result, "Password changed successfully");
});

export const listSessions = wrap(async (req, res) => {
  const sessions = await Service.listSessions(req.user!);
  successResponse(200, res, { sessions }, "Sessions fetched successfully");
});

export const revokeSession = wrap(async (req, res) => {
  await Service.revokeSession(req.user!, idParam(req.params.id, "session id"));
  successResponse(200, res, {}, "Session signed out successfully");
});

export const revokeAllSessions = wrap(async (req, res) => {
  const result = await Service.revokeAllSessions(req.user!);
  successResponse(200, res, result, "Signed out of all devices");
});

export const getStats = wrap(async (req, res) => {
  const stats = await Service.getStats(req.user!, q<StatsQuerySchema>(res));
  successResponse(200, res, { stats }, "Stats fetched successfully");
});

export const updateDefaults = wrap(async (req, res) => {
  const payload = updateDefaultsSchema.parse(req.body);
  const profile = await Service.updateDefaults(req.user!, payload);
  successResponse(200, res, { profile }, "Loan defaults updated successfully");
});

export const getTeam = wrap(async (req, res) => {
  const data = await Service.getTeam(req.user!, q<TeamQuerySchema>(res));
  successResponse(200, res, data, "Team fetched successfully");
});

export const listAdmins = wrap(async (req, res) => {
  const filters = q<ListAdminsQuerySchema>(res);
  const { rows, total } = await Service.listAdmins(req.user!, filters);
  successResponse(
    200,
    res,
    {
      admins: rows,
      metadata: {
        current_page: filters.page,
        limit: filters.limit,
        has_next_page: filters.page * filters.limit < total,
      },
    },
    "Admins fetched successfully",
  );
});

export const setAdminVerification = wrap(async (req, res) => {
  const { is_verified } = verificationSchema.parse(req.body);
  const admin = await Service.setAdminVerification(
    req.user!,
    idParam(req.params.id, "admin id"),
    is_verified,
  );
  successResponse(200, res, { admin }, "Admin verification updated");
});

export const setAdminActive = wrap(async (req, res) => {
  const { is_active } = activeSchema.parse(req.body);
  const admin = await Service.setAdminActive(
    req.user!,
    idParam(req.params.id, "admin id"),
    is_active,
  );
  successResponse(200, res, { admin }, "Admin status updated");
});

export const getLimits = wrap(async (_req, res) => {
  const limits = await Service.getLimits();
  successResponse(200, res, { limits }, "Limits fetched successfully");
});

export const updateLimits = wrap(async (req, res) => {
  const payload = updateLimitsSchema.parse(req.body);
  const limits = await Service.updateLimits(req.user!, payload);
  successResponse(200, res, { limits }, "Limits updated successfully");
});
