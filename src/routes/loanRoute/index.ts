import { Router } from "express";
import {
  collectionsDueQuerySchema,
  collectPaymentSchema,
  createLoanSchema,
  listLoansQuerySchema,
  listPaymentsQuerySchema,
  updateLoanStatusSchema,
} from "../../schemas/loanSchema";
import { validateBody } from "../../middleware/validateBody";
import * as LoanController from "../../controllers/loanController";
import { validateQuery } from "../../middleware/validateQuery";

const loanRouter = Router();

loanRouter.get("/details/:loanId", LoanController.getLoanById);
loanRouter.post(
  "/issue",
  validateBody(createLoanSchema),
  LoanController.createLoan,
);
loanRouter.post(
  "/collect/payment/:loanId",
  validateBody(collectPaymentSchema),
  LoanController.collectPayment,
);
loanRouter.get(
  "/list",
  validateQuery(listLoansQuerySchema),
  LoanController.listLoans,
);
loanRouter.patch(
  "/update/status/:loanId",
  validateBody(updateLoanStatusSchema),
  LoanController.updateLoanStatus,
);
loanRouter.get(
  "/collections/due",
  validateQuery(collectionsDueQuerySchema),
  LoanController.collectionsDue,
);
loanRouter.get("/payments/:loanId", validateQuery(listPaymentsQuerySchema), LoanController.listPayments);

export default loanRouter;
