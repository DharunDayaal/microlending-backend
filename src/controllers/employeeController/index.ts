// place at: src/controllers/employeeController.ts
import type { NextFunction, Request, Response } from "express";
import { AppError, successResponse } from "../../helpers";
import * as Service from "../../services/employeeService";
import {
  createEmployeeSchema,
  employeeActiveSchema,
  employeeIdParamSchema,
  employeeVerificationSchema,
} from "../../schemas/employeeSchema";
import type { ListEmployeesQuerySchema } from "../../schemas/employeeSchema";
import { auditContext } from "../../services/auditService";

type Handler = (req: Request, res: Response) => Promise<void>;

const wrap =
  (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

function employeeId(req: Request): string {
  const parsed = employeeIdParamSchema.safeParse(String(req.params.id));
  if (!parsed.success) throw new AppError(400, "Invalid employee id");
  return parsed.data;
}

export const listEmployees = wrap(async (req, res) => {
  const filters = res.locals.query as ListEmployeesQuerySchema;
  const { rows, total } = await Service.listEmployees(req.user!, filters);
  successResponse(
    200,
    res,
    {
      employees: rows,
      metadata: {
        current_page: filters.page,
        limit: filters.limit,
        has_next_page: filters.page * filters.limit < total,
      },
    },
    "Employees fetched successfully",
  );
});

export const createEmployee = wrap(async (req, res) => {
  const payload = createEmployeeSchema.parse(req.body);
  const employee = await Service.createEmployee(
    payload,
    req.user!,
    auditContext(req),
  );
  successResponse(201, res, { employee }, "Employee created successfully");
});

export const getEmployee = wrap(async (req, res) => {
  const employee = await Service.getEmployee(req.user!, employeeId(req));
  successResponse(200, res, { employee }, "Employee fetched successfully");
});

export const setEmployeeVerification = wrap(async (req, res) => {
  const { is_verified } = employeeVerificationSchema.parse(req.body);
  const employee = await Service.setEmployeeVerification(
    req.user!,
    employeeId(req),
    is_verified,
    auditContext(req),
  );
  successResponse(200, res, { employee }, "Employee verification updated");
});

export const setEmployeeActive = wrap(async (req, res) => {
  const { is_active } = employeeActiveSchema.parse(req.body);
  const employee = await Service.setEmployeeActive(
    req.user!,
    employeeId(req),
    is_active,
    auditContext(req),
  );
  successResponse(200, res, { employee }, "Employee status updated");
});
