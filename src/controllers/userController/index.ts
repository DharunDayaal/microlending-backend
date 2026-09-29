import type { Request, Response, NextFunction } from "express";
import { CreateUserSchema, updateUserSchema } from "../../schemas/userSchema";
import * as UserService from "../../services/userService";
import { AppError, failureResponse, successResponse } from "../../helpers";
import { Week } from "../../types/userTypes";
import {
  PG_FOREIGN_KEY_VIOLATION_ERROR_CODE,
  PG_UNIQUE_VIOLATION_ERROR_CODE,
} from "../../constants";

export async function createUser(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const payload: CreateUserSchema = req.body;

    if (!payload.created_at) {
      payload.created_at = new Date();
    }

    const user = await UserService.createUser(payload);

    successResponse(201, res, { user }, "User created successfully");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      throw new AppError(409, "Phone number is already registered");
    }
    if (code === PG_FOREIGN_KEY_VIOLATION_ERROR_CODE) {
      throw new AppError(404, "Referring user not found");
    }
    next(error);
  }
}

export async function getUserById(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.params.id;

    const user = await UserService.getUserById(userId);

    if (!user) {
      failureResponse(404, res, "User not found");
      return;
    }

    successResponse(200, res, { user }, "User retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function getUsersOnWeekday(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.query.week || typeof req.query.week !== "string") {
      failureResponse(400, res, "Weekday is required");
    }

    const weekday = req.query.week as Week;

    const page =
      typeof req.query.page === "string"
        ? parseInt(req.query.page, 10) || 1
        : 1;
    const limit =
      typeof req.query.limit === "string"
        ? parseInt(req.query.limit, 10) || 10
        : 10;

    const search = req.query.search as string;
    const startIndex = (page - 1) * limit;

    const payload = {
      page,
      limit: limit + 1,
      startIndex,
      weekday,
      search,
    };

    const users = await UserService.getUsersOnWeekday(payload);

    const totalUsersLength = users.length;

    if (totalUsersLength === 0) {
      failureResponse(404, res, "No users found for the specified weekday");
    }

    const hasNextPage = totalUsersLength > limit;

    if (hasNextPage) {
      users.pop();
    }
    successResponse(
      200,
      res,
      {
        users,
        metadata: { current_page: page, limit, has_next_page: hasNextPage },
      },
      "Users retrieved successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function updateUser(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId } = req.params;
    const payload = updateUserSchema.parse(req.body);
    const updatedUser = await UserService.updateUser(userId, payload);
    if (!updatedUser) {
      failureResponse(404, res, "User not found");
    }
    successResponse(
      200,
      res,
      { user: updatedUser },
      "User updated successfully",
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === PG_UNIQUE_VIOLATION_ERROR_CODE) {
      throw new AppError(409, "Phone number is already registered");
    }
    next(error);
  }
}

export async function getUserLoans(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId } = req.params;
    const loans = await UserService.getUserLoans(userId);
    successResponse(200, res, { loans }, "User loans retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function getUserReferrals(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction,
) {
  try {
    const { userId } = req.params;
    const referrals = await UserService.getUserReferrals(userId);
    successResponse(200, res, { referrals }, "User referrals retrieved successfully");
  } catch (error) {
    next(error);
  }
}
