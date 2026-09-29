import { Router } from "express";
import { createUserSchema, updateUserSchema } from "../../schemas/userSchema";
import { validateBody } from "../../middleware/validateBody";
import * as UserController from "../../controllers/userController";

const userRouter = Router();

userRouter.post(
  "/create",
  validateBody(createUserSchema),
  UserController.createUser,
);
userRouter.get("/weekday", UserController.getUsersOnWeekday);
userRouter.get("/:id", UserController.getUserById);
userRouter.patch(
  "/update/:userId",
  UserController.updateUser,
);
userRouter.get("/referrals/:userId", UserController.getUserReferrals);
userRouter.get("/loans/:userId", UserController.getUserLoans);

export default userRouter;
