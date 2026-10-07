import { AppError } from "../../helpers";
import {
  createUserRepo,
  getUserByIdRepo,
  getUsersOnWeekdayRepo,
  checkUserExistsByPhoneNumberRepo,
  updateUserRepo,
  findLoansByUserIdRepo,
  findReferralsByUserIdRepo,
  getTodayDashboardSummaryRepo,
} from "../../repositories/userRepo";
import { CreateUserSchema } from "../../schemas/userSchema";
import { RequestingUser } from "../../types/authTypes";
import { Loan } from "../../types/loanTypes";
import {
  GetUsersOnWeekdayPayload,
  UpdateUserPayload,
  User,
} from "../../types/userTypes";

function assertCustomerAccess(customer: User, user: RequestingUser): void {
  if (user.role === "SUPER_ADMIN") return;
  if (customer.owning_admin_id !== user.teamId) {
    throw new AppError(403, "You don't have access to this customer's data");
  }
}

export async function createUser(
  payload: CreateUserSchema,
  createdBy: string,
  owiningAdminId: string,
) {
  const result = await createUserRepo(payload, createdBy, owiningAdminId);

  return result;
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
  const scopedPayload =
    user.role === "SUPER_ADMIN"
      ? payload
      : { ...payload, owningAdminId: user.teamId };
  return getUsersOnWeekdayRepo(scopedPayload);
}

export async function checkUserExistsByPhoneNumber(phoneNumber: string) {
  const result = await checkUserExistsByPhoneNumberRepo(phoneNumber);

  return result;
}

export async function updateUser(
  userId: string,
  payload: UpdateUserPayload,
  user: RequestingUser,
) {
  const existing = await getUserByIdRepo(userId);
  if (!existing) {
    throw new AppError(404, "User not found");
  }
  assertCustomerAccess(existing, user);
  return updateUserRepo(userId, payload);
}

export async function getUserLoans(
  id: string,
  user: RequestingUser,
): Promise<Loan[]> {
  const customer = await getUserByIdRepo(id);
  if (!customer) {
    throw new AppError(404, "User not found");
  }
  assertCustomerAccess(customer, user);

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
    }));
}

export async function getUserReferrals(
  id: string,
  user: RequestingUser,
): Promise<User[]> {
  const customer = await getUserByIdRepo(id);
  if (!customer) {
    throw new AppError(404, "User not found");
  }
  assertCustomerAccess(customer, user);

  const rows = await findReferralsByUserIdRepo(id);
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
      throw new Error("Invalid user role");
  }
}

export async function getTodayDashboardSummary(user: RequestingUser) {
  const owningAdminId = getOwningAdminId(user);
  const summary = await getTodayDashboardSummaryRepo(owningAdminId);

  const today = new Date();
  return {
    date: today.toISOString().split("T")[0],
    weekday: today
      .toLocaleDateString("en-us", {
        weekday: "long",
      })
      .toUpperCase(),
    ...summary,
  };
}
