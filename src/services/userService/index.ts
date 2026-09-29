import { AppError } from "../../helpers";
import {
  createUserRepo,
  getUserByIdRepo,
  getUsersOnWeekdayRepo,
  checkUserExistsByPhoneNumberRepo,
  updateUserRepo,
  findLoansByUserIdRepo,
  findReferralsByUserIdRepo,
} from "../../repositories/userRepo";
import { CreateUserSchema } from "../../schemas/userSchema";
import { Loan } from "../../types/loanTypes";
import {
  GetUsersOnWeekdayPayload,
  UpdateUserPayload,
  User,
} from "../../types/userTypes";

export async function createUser(payload: CreateUserSchema) {
  const result = await createUserRepo(payload);

  return result;
}

export async function getUserById(userId: string) {
  const result = await getUserByIdRepo(userId);

  return result;
}

export async function getUsersOnWeekday(payload: GetUsersOnWeekdayPayload) {
  const result = await getUsersOnWeekdayRepo(payload);

  return result;
}

export async function checkUserExistsByPhoneNumber(phoneNumber: string) {
  const result = await checkUserExistsByPhoneNumberRepo(phoneNumber);

  return result;
}

export async function updateUser(userId: string, payload: UpdateUserPayload) {
  const result = await updateUserRepo(userId, payload);

  return result;
}

export async function getUserLoans(id: string): Promise<Loan[]> {
  const rows = await findLoansByUserIdRepo(id);
  if (rows === null) {
    throw new AppError(404, "User not found");
  }

  return rows
    .filter((row) => row.loan_id !== null)
    .map((row) => ({
      id: row.loan_id!,
      user_id: row.user_id!,
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

export async function getUserReferrals(id: string): Promise<User[]> {
  const rows = await findReferralsByUserIdRepo(id);
  if (rows === null) {
    throw new AppError(404, "User not found");
  }
  return rows.filter((row): row is User => row !== null && row.id !== null);
}
