import { AppError } from "../../helpers";
import {
  createUserRepo,
  getUserByIdRepo,
  getUsersOnWeekdayRepo,
  checkUserExistsByPhoneNumberRepo,
  updateUserRepo,
  findLoansByUserIdRepo,
  findReferralsByUserIdRepo,
  findCustomerAccessInfoRepo,
  getTodayDashboardSummaryRepo,
  listUsersRepo,
  findCustomerForUpdateRepo,
} from "../../repositories/userRepo";
import { CreateUserSchema } from "../../schemas/userSchema";
import { RequestingUser } from "../../types/authTypes";
import { Loan } from "../../types/loanTypes";
import {
  GetUsersOnWeekdayPayload,
  UpdateUserPayload,
  User,
} from "../../types/userTypes";
import { withTransaction } from "../../config/database";
import { AUDIT } from "../../constants/auditActions";
import { changedValues, recordAudit } from "../../services/auditService";

type AccessInfo = { owning_admin_id: string; created_by: string };
type AuditMeta = Record<string, unknown>;

/**
 * SUPER_ADMIN: everything. ADMIN: their team (owning_admin_id).
 * USER (employee): only customers they created.
 */
function getScope(user: RequestingUser): {
  owningAdminId?: string;
  createdBy?: string;
} {
  return {
    owningAdminId: user.role === "SUPER_ADMIN" ? undefined : user.teamId,
    createdBy: user.role === "USER" ? user.id : undefined,
  };
}

function assertCustomerAccess(
  customer: AccessInfo,
  user: RequestingUser,
): void {
  if (user.role === "SUPER_ADMIN") return;
  if (customer.owning_admin_id !== user.teamId) {
    throw new AppError(403, "You don't have access to this customer's data");
  }
  if (user.role === "USER" && customer.created_by !== user.id) {
    throw new AppError(403, "You don't have access to this customer's data");
  }
}

/** Cheap existence + access check (no profile aggregation). */
async function requireCustomerAccess(
  customerId: string,
  user: RequestingUser,
): Promise<void> {
  const info = await findCustomerAccessInfoRepo(customerId);
  if (!info) throw new AppError(404, "User not found");
  assertCustomerAccess(info, user);
}

/** A referrer must be a customer of the same team. Other teams look like "not found". */
async function assertReferrerInTeam(
  referredById: string | null | undefined,
  owningAdminId: string,
): Promise<void> {
  if (!referredById) return;
  const referrer = await findCustomerAccessInfoRepo(referredById);
  if (!referrer || referrer.owning_admin_id !== owningAdminId) {
    throw new AppError(404, "Referring customer not found");
  }
}

export async function createUser(
  payload: CreateUserSchema,
  createdBy: string,
  owningAdminId: string,
  meta?: AuditMeta,
) {
  await assertReferrerInTeam(payload.referred_by_id, owningAdminId);

  return withTransaction(async (client) => {
    const created = await createUserRepo(
      payload,
      createdBy,
      owningAdminId,
      client,
    );

    await recordAudit(client, {
      action: AUDIT.CUSTOMER_CREATED,
      actor_id: createdBy,
      entity_type: "CUSTOMER",
      entity_id: created.id,
      owning_admin_id: owningAdminId,
      new_value: { ...payload },
      meta,
    });
    return created;
  });
}

export async function getUserById(userId: string, user: RequestingUser) {
  const result = await getUserByIdRepo(userId);
  if (!result) {
    throw new AppError(404, "User not found");
  }
  assertCustomerAccess(result, user);
  return result;
}

export async function getUsersOnWeekday(
  payload: GetUsersOnWeekdayPayload,
  user: RequestingUser,
) {
  return getUsersOnWeekdayRepo({ ...payload, ...getScope(user) });
}

export async function checkUserExistsByPhoneNumber(phoneNumber: string) {
  return checkUserExistsByPhoneNumberRepo(phoneNumber);
}

export async function updateUser(
  userId: string,
  payload: UpdateUserPayload,
  user: RequestingUser,
  meta?: Record<string, unknown>,
) {
  await requireCustomerAccess(userId, user);

  return withTransaction(async (client) => {
    const before = await findCustomerForUpdateRepo(client, userId);
    if (!before) return null;

    const updated = await updateUserRepo(userId, payload, client);
    if (!updated) return null;

    const change = changedValues(
      before,
      updated as unknown as Record<string, unknown>,
      Object.keys(payload),
    );
    if (change) {
      await recordAudit(client, {
        action: AUDIT.CUSTOMER_UPDATED,
        actor_id: user.id,
        entity_type: "CUSTOMER",
        entity_id: userId,
        owning_admin_id: before.owning_admin_id as string,
        ...change,
        meta,
      });
    }
    return updated;
  });
}

export async function getUserLoans(
  id: string,
  user: RequestingUser,
): Promise<Loan[]> {
  await requireCustomerAccess(id, user);

  const rows = await findLoansByUserIdRepo(id);
  if (rows === null) {
    throw new AppError(404, "User not found");
  }

  return rows
    .filter((row) => row.loan_id !== null)
    .map((row) => ({
      id: row.loan_id!,
      customer_id: row.customer_id!,
      issued_by_admin_id: row.issued_by_admin_id!,
      owning_admin_id: row.owning_admin_id!,
      nominal_amount: row.nominal_amount!,
      upfront_fee: row.upfront_fee!,
      disbursed_amount: row.disbursed_amount!,
      total_payable_amount: row.total_payable_amount!,
      weekly_payable_amount: row.weekly_payable_amount!,
      total_months: row.total_months!,
      total_weeks: row.total_weeks!,
      status: row.status!,
      issued_at: row.issued_at!,
      closed_at: row.closed_at,
    }));
}

export async function getUserReferrals(
  id: string,
  user: RequestingUser,
): Promise<User[]> {
  await requireCustomerAccess(id, user);

  const rows = await findReferralsByUserIdRepo(id, getScope(user));
  if (rows === null) {
    throw new AppError(404, "User not found");
  }
  return rows.filter((row): row is User => row !== null && row.id !== null);
}

function getOwningAdminId(user: RequestingUser) {
  switch (user.role) {
    case "SUPER_ADMIN":
      return null;
    case "ADMIN":
      return user.id;
    case "USER":
      if (!user.teamId)
        throw new AppError(400, "User is not associated with an admin");
      return user.teamId;
    default:
      throw new AppError(403, "Invalid user role");
  }
}

export async function getTodayDashboardSummary(user: RequestingUser) {
  const owningAdminId = getOwningAdminId(user);
  const createdBy = user.role === "USER" ? user.id : null;
  const summary = await getTodayDashboardSummaryRepo(owningAdminId, createdBy);

  const now = new Date();
  return {
    // en-CA formats as YYYY-MM-DD
    date: now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
    weekday: now
      .toLocaleDateString("en-us", {
        weekday: "long",
        timeZone: "Asia/Kolkata",
      })
      .toUpperCase(),
    ...summary,
  };
}

export async function listUsers(
  filters: { page: number; limit: number; search?: string },
  user: RequestingUser,
) {
  return listUsersRepo({ ...filters, ...getScope(user) });
}
