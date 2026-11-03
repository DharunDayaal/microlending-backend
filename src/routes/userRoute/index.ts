import { Router } from "express";
import { createUserSchema, listUsersQuerySchema, updateUserSchema } from "../../schemas/userSchema";
import { validateBody } from "../../middleware/validateBody";
import * as UserController from "../../controllers/userController";
import { validateQuery } from "../../middleware/validateQuery";

const userRouter = Router();

userRouter.post(
  "/create",
  validateBody(createUserSchema),
  UserController.createUser,
);
userRouter.get("/today-summary", UserController.getTodayDashboardSummary);
userRouter.get("/weekday", UserController.getUsersOnWeekday);
userRouter.get("/list", validateQuery(listUsersQuerySchema), UserController.listUsers);
userRouter.get("/:id", UserController.getUserById);
userRouter.patch(
  "/update/:userId",
  UserController.updateUser,
);
userRouter.get("/referrals/:userId", UserController.getUserReferrals);
userRouter.get("/loans/:userId", UserController.getUserLoans);

export default userRouter;
