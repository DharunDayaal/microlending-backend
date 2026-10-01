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
import { warmPool } from "./config/database";
import { rbacAuth } from "./middleware/rbacAuth";
import { apiRateLimitConfig } from "./middleware/rateLimiter";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(httpLogger);

app.use("/health", (_req, res) => {
  successResponse(200, res, null, "Server is healthy");
});

app.set("trust proxy", 1);
app.use(apiRateLimitConfig);

app.use("/api/auth", authRouter);
app.use("/api/users", rbacAuth, userRouter);
app.use("/api/loans", rbacAuth, loanRouter);
app.use("/api/reports", rbacAuth, reportRouter);

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
