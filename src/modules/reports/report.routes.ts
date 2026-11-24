import { Router } from "express";
import * as ReportController from "./report.controller";
import { validateQuery } from "../../shared/middleware/validateQuery";
import { overdueLoansQuerySchema } from "./report.schema";

const router = Router();

router.get("/cash-outstanding", ReportController.cashOutstanding);
router.get("/earnings", ReportController.earnings);
router.get(
  "/overdue",
  validateQuery(overdueLoansQuerySchema),
  ReportController.overdueLoans,
);

export default router;
