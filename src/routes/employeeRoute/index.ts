import { Router } from "express";
import { validateQuery } from "../../middleware/validateQuery";
import * as C from "../../controllers/employeeController";
import {
  createEmployeeSchema,
  listEmployeesQuerySchema,
} from "../../schemas/employeeSchema";
import { validateBody } from "../../middleware/validateBody";

const employeeRouter = Router();

employeeRouter.post("/", validateBody(createEmployeeSchema), C.createEmployee);
employeeRouter.get(
  "/",
  validateQuery(listEmployeesQuerySchema),
  C.listEmployees,
);
employeeRouter.get("/:id", C.getEmployee);
employeeRouter.patch("/:id/verification", C.setEmployeeVerification);
employeeRouter.patch("/:id/active", C.setEmployeeActive);

export default employeeRouter;
