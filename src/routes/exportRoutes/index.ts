// place at: src/routes/exportRoutes.ts
// mount in index.ts (see exportSetup.md):
//   app.use("/api/internal/exports", exportWorkerRouter);   // no rbacAuth: secret header instead
//   app.use("/api/exports", rbacAuth, exportRouter);
import { Router } from "express";
import * as C from "../../controllers/exportController";

const exportRouter = Router();
exportRouter.post("/", C.createExport);
exportRouter.get("/", C.listExports);
exportRouter.get("/:id", C.getExport);

export const exportWorkerRouter = Router();
exportWorkerRouter.use(C.requireWorkerSecret);
exportWorkerRouter.post("/run", C.runWorker);
exportWorkerRouter.post("/cleanup", C.runCleanup);

export default exportRouter;