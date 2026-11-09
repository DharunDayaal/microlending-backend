import express from "express";
import helmet from "helmet";
import { PORT } from "./config/env";
import cors from "cors";
import {
  AppError,
  errorHandler,
  httpLogger,
  logger,
  successResponse,
} from "./helpers";
import authRouter from "./routes/authRoute";
import userRouter from "./routes/userRoute";
import loanRouter from "./routes/loanRoute";
import reportRouter from "./routes/reportRoute";
import { getPool, warmPool } from "./config/database";
import { rbacAuth } from "./middleware/rbacAuth";
import { apiRateLimitConfig } from "./middleware/rateLimiter";
import analyticsRouter from "./routes/analyticsRoute";
import { adminsRouter, meRouter, settingsRouter } from "./routes/profileRoute";
import employeeRouter from "./routes/employeeRoute";
import analyticsAdvancedRouter from "./routes/analyticsAdvancedRoute";
import auditRouter from "./routes/auditRoute";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(httpLogger);

// liveness: the process is up (no dependencies, always cheap)
app.get("/health", (_req, res) => {
  successResponse(200, res, null, "Server is healthy");
});

// readiness: the process is up AND the database answers
app.get("/health/ready", async (_req, res) => {
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

app.set("trust proxy", 1);
app.use(apiRateLimitConfig);

app.use("/api/auth", authRouter);
app.use("/api/users", rbacAuth, userRouter);
app.use("/api/loans", rbacAuth, loanRouter);
app.use("/api/reports", rbacAuth, reportRouter);
app.use("/api/analytics", rbacAuth, analyticsRouter);
app.use("/api/me", rbacAuth, meRouter);
app.use("/api/admins", rbacAuth, adminsRouter);
app.use("/api/settings", rbacAuth, settingsRouter);
app.use("/api/employees", rbacAuth, employeeRouter);
app.use("/api/analytics", rbacAuth, analyticsAdvancedRouter);
app.use("/api/audit-logs", rbacAuth, auditRouter);

app.use((_req, _res, next) => {
  next(new AppError(404, "Route not found"));
});

app.use(errorHandler);

if (process.env.VERCEL !== "1") {
  app.listen(PORT, async () => {
    await warmPool();
    logger.info(`Server is running on port ${PORT}`);
  });
} else {
  // On Vercel, warm the pool immediately when the lambda initializes
  warmPool().catch((err) => logger.error("Failed to warm DB pool:", err));
}

export default app;
