import { Router } from "express";
import { validateQuery } from "../../shared/middleware/validateQuery";
import * as C from "./employee.controller";
import {
  createEmployeeSchema,
  listEmployeesQuerySchema,
} from "./employee.schema";
import { validateBody } from "../../shared/middleware/validateBody";

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
