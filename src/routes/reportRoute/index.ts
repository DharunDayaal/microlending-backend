import { Router } from "express";
import * as ReportController from "../../controllers/reportController";
import { validateQuery } from "../../middleware/validateQuery";
import { overdueLoansQuerySchema } from "../../schemas/reportSchema";

const router = Router();

router.get("/cash-outstanding", ReportController.cashOutstanding);
router.get("/earnings", ReportController.earnings);
router.get(
  "/overdue",
  validateQuery(overdueLoansQuerySchema),
  ReportController.overdueLoans,
);

export default router;
