const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001/api";

const SAMPLE_USER_ID =
  process.env.SAMPLE_USER_ID || "c7b5e24b-c43f-49f1-9423-9af4cb15b045";
const SAMPLE_LOAN_ID =
  process.env.SAMPLE_LOAN_ID || "06ef14e5-1295-43eb-b49c-5442c2b84636";

interface Check {
  name: string;
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
  expectStatus: number;
}

const checks: Check[] = [
  { name: "List users", method: "GET", path: "/users", expectStatus: 200 },
  {
    name: "Get user by id",
    method: "GET",
    path: `/users/${SAMPLE_USER_ID}`,
    expectStatus: 200,
  },
  {
    name: "Get user by id (404 case)",
    method: "GET",
    path: `/users/00000000-0000-0000-0000-000000000000`,
    expectStatus: 404,
  },
  {
    name: "User loans",
    method: "GET",
    path: `/users/loans/${SAMPLE_USER_ID}`,
    expectStatus: 200,
  },
  {
    name: "User referrals",
    method: "GET",
    path: `/users/referrals/${SAMPLE_USER_ID}`,
    expectStatus: 200,
  },
  {
    name: "Users on weekday",
    method: "GET",
    path: "/users/weekday?week=MONDAY",
    expectStatus: 200,
  },

  { name: "List loans", method: "GET", path: "/loans/list", expectStatus: 200 },
  {
    name: "List loans — no query params (regression check)",
    method: "GET",
    path: "/loans/list",
    expectStatus: 200,
  },
  {
    name: "List loans — filtered",
    method: "GET",
    path: "/loans/list?status=ACTIVE&page=1&limit=5",
    expectStatus: 200,
  },
  {
    name: "Loan detail",
    method: "GET",
    path: `/loans/details/${SAMPLE_LOAN_ID}`,
    expectStatus: 200,
  },
  {
    name: "Loan payments",
    method: "GET",
    path: `/loans/payments/${SAMPLE_LOAN_ID}`,
    expectStatus: 200,
  },
  {
    name: "Collections due",
    method: "GET",
    path: "/loans/collections/due",
    expectStatus: 200,
  },
  {
    name: "Issue loan — invalid body",
    method: "POST",
    path: "/loans/issue",
    body: { user_id: "not-a-uuid", nominal_amount: -5 },
    expectStatus: 400,
  },

  {
    name: "Cash outstanding report",
    method: "GET",
    path: "/reports/cash-outstanding",
    expectStatus: 200,
  },
  {
    name: "Earnings report",
    method: "GET",
    path: "/reports/earnings",
    expectStatus: 200,
  },
  {
    name: "Overdue report",
    method: "GET",
    path: "/reports/overdue",
    expectStatus: 200,
  },
];

async function runCheck(check: Check): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}${check.path}`, {
      method: check.method,
      headers: { "Content-Type": "application/json" },
      body: check.body ? JSON.stringify(check.body) : undefined,
    });

    const passed = res.status === check.expectStatus;
    const label = passed ? "PASS" : "FAIL";
    console.log(
      `[${label}] ${check.name} - expected ${check.expectStatus}, got ${res.status}`,
    );

    if (!passed) {
      const text = await res.text();
      console.log(`              ${text.slice(0, 200)}`);
    }
    return passed;
  } catch (error) {
    console.error(
      `[FAIL] ${check.name} - request threw: ${(error as Error).message}`,
    );
    return false;
  }
}

async function main() {
  if (SAMPLE_USER_ID === "Replace_me" || SAMPLE_LOAN_ID === "Replace_me") {
    console.warn(
      "Set SAMPLE_USER_ID and SAMPLE_LOAN_ID env vars (or edit this file) with real ids from your seeded data.\n",
    );
  }

  let passed = 0;
  for (const check of checks) {
    if (await runCheck(check)) {
      passed++;
    }
  }

  console.log(`\n${passed}/${checks.length} checks passed`);
  process.exit(passed === checks.length ? 0 : 1);
}

main();
