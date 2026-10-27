const autocannon = require("autocannon");

interface LoginResponse {
  success: boolean;
  message: string;
  data: {
    tokens: {
      access_token: string;
      refresh_token: string;
    };
    admin: {
      id: string;
      email: string;
      role: string;
    };
  };
}

const BASE_URL = "https://microlending-backend.vercel.app";
// const BASE_URL = "http://localhost:3001"
const LOGIN_URL = `${BASE_URL}/api/auth/login/email`;
const LOANS_URL = `${BASE_URL}/api/loans/collections/due?preferred_payment_day=MONDAY&page=1&limit=20`;
// const LOANS_URL = `${BASE_URL}/api/auth/login/email`;

const CONNECTIONS = Number(10);
const DURATION_SECONDS = Number(10);
const PIPELINING = Number(1);


async function getAuthToken(): Promise<string> {
  const response = await fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "dharundayaal@gmail.com",
      password: "Dharun@123",
    }),
  });

  if (!response.ok) {
    throw new Error(`Authentication failed with status: ${response.status}`);
  }

  const result = (await response.json()) as LoginResponse;

  if (!result.success || !result.data?.tokens?.access_token) {
    throw new Error(
      `Login failed: ${result.message || "Access token missing"}`,
    );
  }

  return result.data.tokens.access_token;
}

function pct(value: number | undefined): number | null {
  return Number.isFinite(value) ? Number(value!.toFixed(2)) : null;
}

async function main(): Promise<void> {
  if (!Number.isInteger(CONNECTIONS) || CONNECTIONS < 1) {
    throw new Error("CONNECTIONS must be a positive integer.");
  }
  if (!Number.isFinite(DURATION_SECONDS) || DURATION_SECONDS < 1) {
    throw new Error("DURATION_SECONDS must be at least 1.");
  }
  if (!Number.isInteger(PIPELINING) || PIPELINING < 1) {
    throw new Error("PIPELINING must be a positive integer.");
  }

  console.log("Authenticating for the authorized load test...");
  const token = await getAuthToken();

  const startedAt = new Date();
  console.log(`Target: ${LOANS_URL}`);
  console.log(
    `Starting ${DURATION_SECONDS}s test with ${CONNECTIONS} connections and pipelining=${PIPELINING}`,
  );

  const result = await autocannon({
    url: LOANS_URL,
    method: "GET",
    connections: CONNECTIONS,
    duration: DURATION_SECONDS,
    pipelining: PIPELINING,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    // Keep the default request rate unlimited; connections control concurrency.
    // Do not add retries: they can obscure the observed failure rate.
  });

  const finishedAt = new Date();
  const latency = result.latency as typeof result.latency & {
    p50?: number;
    p90?: number;
    p95?: number;
    p99?: number;
    p99_9?: number;
  };

  const report = {
    reportGeneratedAt: new Date().toISOString(),
    test: {
      target: LOANS_URL,
      method: "GET",
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      configuredDurationSeconds: DURATION_SECONDS,
      configuredConnections: CONNECTIONS,
      pipelining: PIPELINING,
      note: "Run only against systems you own or have explicit permission to test. 400 connections can overwhelm a serverless deployment or trigger provider rate limits.",
    },
    summary: {
      requestsTotal: result.requests.total,
      requestsPerSecondAverage: pct(result.requests.average),
      requestsPerSecondMaximum: pct(result.requests.max),
      latencyAverageMs: pct(result.latency.average),
      latencyMinimumMs: pct(result.latency.min),
      latencyMaximumMs: pct(result.latency.max),
      latencyStdDevMs: pct(result.latency.stddev),
      latencyP50Ms: pct(latency.p50 ?? result.latency.p50),
      latencyP90Ms: pct(latency.p90 ?? result.latency.p90),
      latencyP95Ms: pct(latency.p95 ?? result.latency.p95),
      latencyP99Ms: pct(latency.p99 ?? result.latency.p99),
      latencyP999Ms: pct(latency.p99_9 ?? result.latency.p99_9),
      non2xxResponses: result.non2xx,
      errors: result.errors,
      timeouts: result.timeouts,
      socketErrors: result.errors,
      throughputBytesPerSecondAverage: pct(result.throughput.average),
      throughputBytesPerSecondMaximum: pct(result.throughput.max),
      statusCodeCounts: result.statusCodeCounts,
    },
    rawAutocannonResult: result,
  };

  // await writeFile(OUTPUT_FILE, JSON.stringify(report, null, 2), "utf8");

  console.log("\n========== AUTOCANNON STRESS TEST REPORT ==========");
  console.log(`Target:              ${LOANS_URL}`);
  console.log(`Started:             ${startedAt.toISOString()}`);
  console.log(`Finished:            ${finishedAt.toISOString()}`);
  console.log(`Configured duration: ${DURATION_SECONDS}s`);
  console.log(`Connections:         ${CONNECTIONS}`);
  console.log(`Pipelining:          ${PIPELINING}`);
  console.log("---------------------------------------------------");
  console.log(`Total requests:      ${result.requests.total}`);
  console.log(`Avg requests/sec:    ${result.requests.average}`);
  console.log(`Max requests/sec:    ${result.requests.max}`);
  console.log(`Latency min:         ${result.latency.min} ms`);
  console.log(`Latency avg:         ${result.latency.average} ms`);
  console.log(`Latency max:         ${result.latency.max} ms`);
  console.log(`Latency std dev:     ${result.latency.stddev} ms`);
  console.log(`Latency p50:         ${latency.p50 ?? "n/a"} ms`);
  console.log(`Latency p90:         ${latency.p90 ?? "n/a"} ms`);
  console.log(`Latency p95:         ${latency.p95 ?? "n/a"} ms`);
  console.log(`Latency p99:         ${latency.p99 ?? "n/a"} ms`);
  console.log(`Non-2xx responses:   ${result.non2xx}`);
  console.log(`Errors:              ${result.errors}`);
  console.log(`Timeouts:            ${result.timeouts}`);
  console.log(
    `Status code counts:  ${JSON.stringify(result.statusCodeCounts)}`,
  );
  console.log("===================================================");
}

main().catch((error: unknown) => {
  console.error("Load test failed:", error);
});
