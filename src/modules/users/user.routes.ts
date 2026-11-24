import { Router } from "express";
import {
  createUserSchema,
  customerSubListQuerySchema,
  listUsersQuerySchema,
  updateUserSchema,
  weekdayUsersQuerySchema,
} from "./user.schema";
import { validateBody } from "../../shared/middleware/validateBody";
import * as UserController from "./user.controller";
import { validateQuery } from "../../shared/middleware/validateQuery";

const userRouter = Router();

userRouter.post(
  "/create",
  validateBody(createUserSchema),
  UserController.createUser,
);
userRouter.get("/today-summary", UserController.getTodayDashboardSummary);
userRouter.get("/weekday", validateQuery(weekdayUsersQuerySchema), UserController.getUsersOnWeekday);
userRouter.get("/list", validateQuery(listUsersQuerySchema), UserController.listUsers);
userRouter.get("/:id", UserController.getUserById);
userRouter.patch(
  "/update/:userId",
  UserController.updateUser,
);
userRouter.get("/referrals/:userId", validateQuery(customerSubListQuerySchema), UserController.getUserReferrals);
userRouter.get("/loans/:userId", validateQuery(customerSubListQuerySchema), UserController.getUserLoans);

export default userRouter;
