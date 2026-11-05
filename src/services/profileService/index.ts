// place at: src/services/profileService.ts
import {
  AppError,
  comparePassword,
  hashPassword,
  hashRefreshToken,
} from "../../helpers";
import {
  PG_UNIQUE_VIOLATION_ERROR_CODE,
  VERIFIED_OTP_VALID_FOR_MINUTES,
} from "../../constants";
import { getPool, withTransaction } from "../../config/database";
import * as OtpRepository from "../../repositories/otpRepo";
import * as AnalyticsRepo from "../../repositories/analyticsRepo";
import * as Repo from "../../repositories/profileRepo";
import type { RequestingUser } from "../../types/authTypes";
import type {
  ChangePasswordSchema,
  ChangePhoneSchema,
  ListAdminsQuerySchema,
  StatsQuerySchema,
  TeamQuerySchema,
  UpdateDefaultsSchema,
  UpdateLimitsSchema,
  UpdateProfileSchema,
} from "../../schemas/profileSchema";
import { calculateTotalWeeks } from "../../utils";

const isUniqueViolation = (e: unknown) =>
  (e as { code?: string }).code === PG_UNIQUE_VIOLATION_ERROR_CODE;

/**
 * Public user fields with the EFFECTIVE loan defaults: a USER with no override
 * (all four default_* are null) inherits the admin's values, so the client
 * always gets numbers plus `defaults_inherited`.
 */
async function buildProfile(user: Repo.UserRow) {
  let eff = user;
  let inherited = false;
  let sourceAdminId: string | null = user.id;

  const noOwnDefaults =
    user.default_upfront_fee_percentage === null &&
    user.default_interest_percentage === null &&
    user.default_total_months === null &&
    user.default_total_weeks === null;

  if (user.role === "USER" && noOwnDefaults && user.admin_id) {
    const admin = await Repo.findUserRepo(user.admin_id);
    if (admin) {
      eff = admin;
      inherited = true;
      sourceAdminId = admin.id;
    }
  }

  const limits = await Repo.getLimitsRepo();
  return {
    ...user,
    default_upfront_fee_percentage: eff.default_upfront_fee_percentage,
    default_interest_percentage: eff.default_interest_percentage,
    default_total_months: eff.default_total_months,
    default_total_weeks: eff.default_total_weeks,
    defaults_inherited: inherited,
    defaults_source_admin_id: sourceAdminId,
    can_edit_defaults: user.role !== "USER",
    limits,
  };
}

export async function getProfile(user: RequestingUser) {
  const row = await Repo.findUserRepo(user.id);
  if (!row) throw new AppError(404, "Account not found");
  return buildProfile(row);
}

export async function updateProfile(
  user: RequestingUser,
  payload: UpdateProfileSchema,
) {
  const before = await Repo.findUserRepo(user.id);
  if (!before) throw new AppError(404, "Account not found");

  const changes: { user_name?: string; email?: string } = {};
  if (payload.user_name !== undefined && payload.user_name !== before.user_name)
    changes.user_name = payload.user_name;
  if (payload.email !== undefined && payload.email !== before.email)
    changes.email = payload.email;

  if (Object.keys(changes).length === 0) return buildProfile(before);

  try {
    const updated = await withTransaction(async (client) => {
      const row = await Repo.updateProfileRepo(client, user.id, changes);
      await Repo.insertAuditRepo(client, {
        actor_id: user.id,
        target_id: user.id,
        action: "PROFILE_UPDATED",
        old_value: {
          user_name: before.user_name,
          email: before.email,
        },
        new_value: { user_name: row.user_name, email: row.email },
      });
      return row;
    });
    return buildProfile(updated);
  } catch (error) {
    // only user_name and email are written here; email is the unique one
    if (isUniqueViolation(error)) {
      throw new AppError(409, "This email is already in use");
    }
    throw error;
  }
}

// phone (reuses the existing OTP send/verify flow, like registration)
export async function changePhone(
  user: RequestingUser,
  payload: ChangePhoneSchema,
) {
  const before = await Repo.findUserRepo(user.id);
  if (!before) throw new AppError(404, "Account not found");
  if (before.phone_number === payload.phone_number) {
    throw new AppError(400, "That is already your phone number");
  }

  const validSince = new Date(
    Date.now() - VERIFIED_OTP_VALID_FOR_MINUTES * 60 * 1000,
  );

  try {
    const updated = await withTransaction(async (client) => {
      const otp = await OtpRepository.findVerifiedUncosumedOtpForUpdateRepo(
        client,
        payload.phone_number,
        "VERIFY_PHONE_NUMBER",
        validSince,
      );
      if (!otp) {
        throw new AppError(
          400,
          "Phone number has not been verified or OTP has expired",
        );
      }
      const row = await Repo.updatePhoneRepo(
        client,
        user.id,
        payload.phone_number,
      );
      await OtpRepository.markOtpConsumedRepo(client, otp.id);
      await Repo.insertAuditRepo(client, {
        actor_id: user.id,
        target_id: user.id,
        action: "PHONE_CHANGED",
        old_value: { phone_number: before.phone_number },
        new_value: { phone_number: row.phone_number },
      });
      return row;
    });
    return buildProfile(updated);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (isUniqueViolation(error)) {
      throw new AppError(409, "This phone number is already registered");
    }
    throw error;
  }
}

export async function changePassword(
  user: RequestingUser,
  payload: ChangePasswordSchema,
): Promise<{ other_sessions_signed_out: number }> {
  const newHash = await hashPassword(payload.new_password);
  const keepHash = payload.refresh_token
    ? hashRefreshToken(payload.refresh_token)
    : null;

  return withTransaction(async (client) => {
    const currentHash = await Repo.findPasswordHashRepo(user.id, client);
    if (!currentHash) throw new AppError(404, "Account not found");

    const ok = await comparePassword(payload.current_password, currentHash);
    if (!ok) throw new AppError(400, "Current password is incorrect");

    await Repo.updatePasswordHashRepo(client, user.id, newHash);
    const revoked = await Repo.revokeSessionsRepo(client, user.id, keepHash);
    await Repo.insertAuditRepo(client, {
      actor_id: user.id,
      target_id: user.id,
      action: "PASSWORD_CHANGED",
    });
    return { other_sessions_signed_out: revoked };
  });
}

export async function listSessions(user: RequestingUser) {
  return Repo.listSessionsRepo(user.id);
}

export async function revokeSession(user: RequestingUser, sessionId: string) {
  const n = await Repo.revokeSessionRepo(user.id, sessionId);
  if (n === 0) throw new AppError(404, "Session not found");
}

export async function revokeAllSessions(user: RequestingUser) {
  const n = await Repo.revokeSessionsRepo(getPool(), user.id, null);
  return { signed_out: n };
}

export async function updateDefaults(
  user: RequestingUser,
  payload: UpdateDefaultsSchema,
) {
  if (user.role === "USER") {
    throw new AppError(403, "Loan defaults are set by your admin");
  }
  const before = await Repo.findUserRepo(user.id);
  if (!before) throw new AppError(404, "Account not found");
  const limits = await Repo.getLimitsRepo();

  const fee =
    payload.default_upfront_fee_percentage ??
    before.default_upfront_fee_percentage!;
  const interest =
    payload.default_interest_percentage ?? before.default_interest_percentage!;
  const months = payload.default_total_months ?? before.default_total_months!;

  if (fee < 0 || fee > limits.max_fee_percent) {
    throw new AppError(
      400,
      `Upfront fee must be between 0 and ${limits.max_fee_percent}%`,
    );
  }
  if (interest < 0 || interest > limits.max_interest_percent) {
    throw new AppError(
      400,
      `Interest must be between 0 and ${limits.max_interest_percent}%`,
    );
  }
  if (months < limits.min_months || months > limits.max_months) {
    throw new AppError(
      400,
      `Term must be between ${limits.min_months} and ${limits.max_months} months`,
    );
  }

  const weeks = calculateTotalWeeks(months);
  const updated = await withTransaction(async (client) => {
    const row = await Repo.updateDefaultsRepo(client, user.id, {
      fee,
      interest,
      months,
      weeks,
    });
    await Repo.insertAuditRepo(client, {
      actor_id: user.id,
      target_id: user.id,
      action: "LOAN_DEFAULTS_UPDATED",
      old_value: {
        fee: before.default_upfront_fee_percentage,
        interest: before.default_interest_percentage,
        months: before.default_total_months,
        weeks: before.default_total_weeks,
      },
      new_value: { fee, interest, months, weeks },
    });
    return row;
  });
  return buildProfile(updated);
}

export async function getLimits() {
  return Repo.getLimitsRepo();
}

export async function updateLimits(
  user: RequestingUser,
  payload: UpdateLimitsSchema,
) {
  if (user.role !== "SUPER_ADMIN") {
    throw new AppError(403, "Only the super admin can change global limits");
  }
  const before = await Repo.getLimitsRepo();
  const next: Repo.Limits = { ...before };
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) (next as unknown as Record<string, number>)[k] = v;
  }
  if (next.min_principal > next.max_principal) {
    throw new AppError(
      400,
      "Minimum principal cannot exceed maximum principal",
    );
  }
  if (next.min_months > next.max_months) {
    throw new AppError(400, "Minimum term cannot exceed maximum term");
  }

  await withTransaction(async (client) => {
    await Repo.upsertLimitsRepo(client, next, user.id);
    await Repo.insertAuditRepo(client, {
      actor_id: user.id,
      target_id: null,
      action: "LOAN_LIMITS_UPDATED",
      old_value: before,
      new_value: next,
    });
  });
  return next;
}

const todayIst = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function periodFor(range: "week" | "month", today: string) {
  if (range === "week") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    const from = shift(today, -((dow + 6) % 7)); // Monday
    return { from, to: shift(from, 6) };
  }
  const [y, m] = today.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from,
    to: `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`,
  };
}

function statsScope(
  user: RequestingUser,
  q: StatsQuerySchema,
): { owningAdminId?: string; createdBy?: string } {
  if (q.scope === "me") {
    if (user.role === "USER")
      return { owningAdminId: user.teamId, createdBy: user.id };
    if (user.role === "ADMIN")
      return { owningAdminId: user.id, createdBy: user.id };
    return { createdBy: user.id };
  }
  if (q.scope === "team") {
    if (user.role === "USER") {
      throw new AppError(403, "You don't have permission to view team stats");
    }
    if (user.role === "ADMIN") return { owningAdminId: user.id };
    if (!q.admin_id) {
      throw new AppError(400, "admin_id is required for team scope");
    }
    return { owningAdminId: q.admin_id };
  }
  if (user.role !== "SUPER_ADMIN") {
    throw new AppError(403, "You don't have permission to view platform stats");
  }
  return {};
}

export async function getStats(user: RequestingUser, q: StatsQuerySchema) {
  const scope = statsScope(user, q);
  const today = todayIst();
  const { from, to } = periodFor(q.range, today);

  const [trend, behaviour, overview, customersPaid] = await Promise.all([
    AnalyticsRepo.getCollectionsTrendRepo(scope, from, to, "month"),
    AnalyticsRepo.getPaymentBehaviourRepo(scope, from, to < today ? to : today),
    AnalyticsRepo.getOverviewRepo(scope),
    Repo.countCustomersPaidRepo(scope, from, to),
  ]);

  const target = trend.reduce((s, r) => s + r.target, 0);
  const collected = trend.reduce((s, r) => s + r.collected, 0);
  const t = behaviour.timing;

  return {
    range: q.range,
    scope: q.scope,
    from,
    to,
    collected,
    target,
    customers_paid: customersPaid,
    overdue_count: overview.totals.overdue_loans,
    on_time_ratio:
      t.payments > 0 ? Math.round((t.on_time / t.payments) * 100) / 100 : null,
  };
}

export async function getTeam(user: RequestingUser, q: TeamQuerySchema) {
  if (user.role === "USER") {
    throw new AppError(403, "You don't have permission to view the team");
  }

  let adminId: string | null = null;
  if (user.role === "ADMIN") {
    adminId = user.id;
  } else if (q.admin_id) {
    const admin = await Repo.findUserRepo(q.admin_id);
    if (!admin || admin.role !== "ADMIN") {
      throw new AppError(404, "Admin not found");
    }
    adminId = admin.id;
  }

  if (adminId) {
    const members = await Repo.listMembersRepo(adminId);
    return {
      members,
      pending_count: members.filter((m) => !m.is_verified).length,
    };
  }

  const [teams, pendingAdmins] = await Promise.all([
    Repo.listTeamsRepo(),
    Repo.countPendingAdminsRepo(),
  ]);
  return { teams, pending_admin_approvals: pendingAdmins };
}

// admin approval (SUPER_ADMIN)
function requireSuperAdmin(user: RequestingUser) {
  if (user.role !== "SUPER_ADMIN") {
    throw new AppError(403, "Only the super admin can manage admin accounts");
  }
}

export async function listAdmins(
  user: RequestingUser,
  q: ListAdminsQuerySchema,
) {
  requireSuperAdmin(user);
  const { rows, total } = await Repo.listAdminsRepo(
    q.status,
    q.search,
    q.page,
    q.limit,
  );
  return { rows, total };
}

async function setAdminFlag(
  user: RequestingUser,
  adminId: string,
  flag: "is_verified" | "is_active",
  value: boolean,
) {
  requireSuperAdmin(user);
  const before = await Repo.findUserRepo(adminId);
  if (!before || before.role !== "ADMIN") {
    throw new AppError(404, "Admin not found");
  }
  if (before[flag] === value) return before;

  return withTransaction(async (client) => {
    const row = await Repo.setAdminFlagRepo(client, adminId, flag, value);
    // a deactivated admin must not keep refreshing a session
    if (flag === "is_active" && !value) {
      await Repo.revokeSessionsRepo(client, adminId, null);
    }
    await Repo.insertAuditRepo(client, {
      actor_id: user.id,
      target_id: adminId,
      action:
        flag === "is_verified"
          ? "ADMIN_VERIFICATION_CHANGED"
          : "ADMIN_ACTIVE_CHANGED",
      old_value: { [flag]: before[flag] },
      new_value: { [flag]: value },
    });
    return row;
  });
}

export const setAdminVerification = (
  user: RequestingUser,
  adminId: string,
  isVerified: boolean,
) => setAdminFlag(user, adminId, "is_verified", isVerified);

export const setAdminActive = (
  user: RequestingUser,
  adminId: string,
  isActive: boolean,
) => setAdminFlag(user, adminId, "is_active", isActive);
