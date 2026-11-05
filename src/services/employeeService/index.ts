import {
  AppError,
  hashPassword,
} from "../../helpers";
import {
  PG_UNIQUE_VIOLATION_ERROR_CODE,
} from "../../constants";
import { withTransaction } from "../../config/database";
import * as Repo from "../../repositories/employeeRepo";
import {
  insertAuditRepo,
  revokeSessionsRepo,
} from "../../repositories/profileRepo";
import type { EmployeeDetail } from "../../types/employeeTypes";
import type { ListEmployeesQuerySchema } from "../../schemas/employeeSchema";
import type { CreateEmployeeSchema } from "../../schemas/employeeSchema";
import { calculateTotalWeeks } from "../../utils";
import type { AdminUserPublic, RequestingUser } from "../../types/authTypes";

/**
 * ADMIN       -> only employees whose admin_id is the caller
 * SUPER_ADMIN -> every employee (optionally one team via admin_id)
 * USER        -> no access
 */
function requireManager(user: RequestingUser): void {
  if (user.role === "USER") {
    throw new AppError(403, "You don't have permission to manage employees");
  }
}

/** Loads an employee the caller may manage; 404 for anything else. */
async function loadManaged(user: RequestingUser, id: string) {
  requireManager(user);
  const row = await Repo.findEmployeeRepo(id);
  const outOfScope =
    !row ||
    row.role !== "USER" ||
    (user.role === "ADMIN" && row.admin_id !== user.id);
  if (outOfScope) throw new AppError(404, "Employee not found");
  return row;
}

export async function listEmployees(
  user: RequestingUser,
  q: ListEmployeesQuerySchema,
) {
  requireManager(user);
  return Repo.listEmployeesRepo({
    adminId: user.role === "ADMIN" ? user.id : q.admin_id,
    status: q.status,
    search: q.search,
    page: q.page,
    limit: q.limit,
  });
}

export async function createEmployee(
  payload: CreateEmployeeSchema,
  creator: RequestingUser,
): Promise<AdminUserPublic> {
  if (creator.role !== "ADMIN") {
    throw new AppError(403, "Only admins can create employees");
  }

  const passwordHash = await hashPassword(payload.password);

  try {
    const employee = await Repo.createEmployeeRepo({
      user_name: payload.user_name,
      phone_number: payload.phone_number,
      email: payload.email,
      password_hash: passwordHash,
      admin_id: creator.id,
      default_upfront_fee_percentage: payload.default_upfront_fee_percentage,
      default_interest_percentage: payload.default_interest_percentage,
      default_total_months: payload.default_total_months,
      default_total_weeks: calculateTotalWeeks(payload.default_total_months),
    });
    const { password_hash: _passwordHash, ...publicEmployee } = employee;
    return publicEmployee;
  } catch (error) {
    if ((error as { code?: string }).code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      throw new AppError(409, "Email or phone number is already registered");
    }
    throw error;
  }
}

export async function getEmployee(
  user: RequestingUser,
  id: string,
): Promise<EmployeeDetail> {
  await loadManaged(user, id);
  const detail = await Repo.getEmployeeDetailRepo(id);
  if (!detail) throw new AppError(404, "Employee not found");
  return detail;
}

async function setFlag(
  user: RequestingUser,
  id: string,
  flag: "is_verified" | "is_active",
  value: boolean,
): Promise<EmployeeDetail> {
  const before = await loadManaged(user, id);
  const beforeValue = flag === "is_verified" ? before.is_verified : before.is_active;

  if (beforeValue !== value) {
    await withTransaction(async (client) => {
      await Repo.setEmployeeFlagRepo(client, id, flag, value);
      // a deactivated employee must not keep refreshing a session
      if (flag === "is_active" && !value) {
        await revokeSessionsRepo(client, id, null);
      }
      await insertAuditRepo(client, {
        actor_id: user.id,
        target_id: id,
        action:
          flag === "is_verified"
            ? "EMPLOYEE_VERIFICATION_CHANGED"
            : "EMPLOYEE_ACTIVE_CHANGED",
        old_value: { [flag]: beforeValue },
        new_value: { [flag]: value },
      });
    });
  }
  return getEmployee(user, id);
}

export const setEmployeeVerification = (
  user: RequestingUser,
  id: string,
  isVerified: boolean,
) => setFlag(user, id, "is_verified", isVerified);

export const setEmployeeActive = (
  user: RequestingUser,
  id: string,
  isActive: boolean,
) => setFlag(user, id, "is_active", isActive);