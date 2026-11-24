import { PORT } from "./config/env";
import { warmPool } from "./config/database";
import { logger } from "./shared/logger";
import { createApp } from "./app";

const app = createApp();

if (process.env.VERCEL !== "1") {
  app.listen(PORT, async () => {
    await warmPool();
    logger.info(`Server is running on port ${PORT}`);
  });
} else {
  // On Vercel, warm the pool immediately when the lambda initializes
  warmPool().catch((err) => logger.error("Failed to warm DB pool:", err));
}

// Vercel reads this from the entry file. vercel.json uses `builds`, which can't be
// combined with a `functions` block, so the time limit lives here. 300s is the
// Hobby maximum with Fluid compute; the export worker stops itself before this.
export const config = { maxDuration: 300 };

export default app;
