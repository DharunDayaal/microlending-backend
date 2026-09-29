import { Router } from "express";
import * as ReportController from "../../controllers/reportController";

const router = Router();

router.get("/cash-outstanding", ReportController.cashOutstanding);
router.get("/earnings", ReportController.earnings);
router.get("/overdue", ReportController.overdueLoans);

export default router;
