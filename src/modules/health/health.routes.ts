import { Router } from "express";
import { getPool } from "../../config/database";
import { logger } from "../../shared/logger";
import { successResponse } from "../../shared/http/response";

const healthRouter = Router();

// liveness: the process is up (no dependencies, always cheap)
healthRouter.get("/health", (_req, res) => {
  successResponse(200, res, null, "Server is healthy");
});

// readiness: the process is up AND the database answers
healthRouter.get("/health/ready", async (_req, res) => {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      getPool().query("SELECT 1"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db timeout")), 3000);
      }),
    ]);
    successResponse(
      200,
      res,
      { database: "up", latency_ms: Date.now() - started },
      "Server is healthy",
    );
  } catch (error) {
    logger.error(error, "Health check failed:");
    res.status(503).json({
      success: false,
      message: "Service unavailable",
      database: "down",
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
});

export default healthRouter;
