
import { faker } from "@faker-js/faker";
import { getPool, closePool } from "../config/database";
import { randomUUID } from "node:crypto";

const TARGET_ADMIN_ID = "eb4bc22a-eac5-479c-99e6-db854e860648";

const CUSTOMER_COUNT = 11000;
const CUSTOMER_BATCH_SIZE = 500;

const LOAN_BATCH_SIZE = 500;
const TRACK_BATCH_SIZE = 500;
const PAYMENT_BATCH_SIZE = 500;

// All loan histories start on or after August 1, 2026.
const LOAN_HISTORY_START_DATE = new Date(2026, 7, 1);

const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

const LOCATIONS = [
  {
    city: "Cuddalore",
    district: "Cuddalore",
    streetNames: [
      "Lawrence Road",
      "Imperial Road",
      "Manjakuppam",
      "Thirupapuliyur",
      "Nellikuppam Road",
      "Semmandalam",
      "Koothapakkam",
      "Devanampattinam Road",
      "Beach Road",
      "OT Road",
    ],
  },
  {
    city: "Puducherry",
    district: "Puducherry",
    streetNames: [
      "Mission Street",
      "MG Road",
      "Bussy Street",
      "Rangapillai Street",
      "Eswaran Koil Street",
      "Nehru Street",
      "Lal Bahadur Shastri Street",
      "Goubert Avenue",
      "Suffren Street",
      "Law de Lauriston Street",
    ],
  },
] as const;

function percentOf(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100);
}

function calculateTotalWeeks(totalMonths: number): number {
  return Math.round(totalMonths * 4);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function weeksBetween(from: Date, to: Date): number {
  return Math.floor(
    (to.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
}

function minDate(first: Date, second: Date): Date {
  return first.getTime() <= second.getTime() ? first : second;
}

interface AdminDefaults {
  id: string;
  default_upfront_fee_percentage: number;
  default_interest_percentage: number;
  default_total_months: number;
}

async function loadAdminDefaults(
  pool = getPool(),
): Promise<AdminDefaults> {
  const result = await pool.query<AdminDefaults>(
    `
      SELECT
        id,
        default_upfront_fee_percentage,
        default_interest_percentage,
        default_total_months
      FROM users
      WHERE id = $1
    `,
    [TARGET_ADMIN_ID],
  );

  const admin = result.rows[0];

  if (!admin) {
    throw new Error(`No admin found with id ${TARGET_ADMIN_ID}`);
  }

  if (admin.default_upfront_fee_percentage == null) {
    throw new Error(
      `${TARGET_ADMIN_ID} has no upfront fee default. Pass an ADMIN id instead.`,
    );
  }

  if (admin.default_interest_percentage == null) {
    throw new Error(
      `${TARGET_ADMIN_ID} has no interest default. Pass an ADMIN id instead.`,
    );
  }

  return admin;
}

// ---------- wipe existing data for this admin ----------

async function wipeAdminData(
  pool = getPool(),
): Promise<void> {
  await pool.query(
    `
      DELETE FROM payments
      WHERE loan_id IN (
        SELECT id
        FROM loans
        WHERE owning_admin_id = $1
      )
    `,
    [TARGET_ADMIN_ID],
  );

  await pool.query(
    `
      DELETE FROM repayment_tracks
      WHERE loan_id IN (
        SELECT id
        FROM loans
        WHERE owning_admin_id = $1
      )
    `,
    [TARGET_ADMIN_ID],
  );

  await pool.query(
    `DELETE FROM loans WHERE owning_admin_id = $1`,
    [TARGET_ADMIN_ID],
  );

  await pool.query(
    `DELETE FROM customers WHERE owning_admin_id = $1`,
    [TARGET_ADMIN_ID],
  );

  console.log(
    `Wiped loans, customers, payments, and tracks for admin ${TARGET_ADMIN_ID}`,
  );
}

// ---------- customers ----------

interface SeedCustomer {
  id: string;
}

async function seedCustomers(
  pool: ReturnType<typeof getPool>,
): Promise<SeedCustomer[]> {
  const customerIds = Array.from(
    { length: CUSTOMER_COUNT },
    () => randomUUID(),
  );

  for (
    let batchStart = 0;
    batchStart < CUSTOMER_COUNT;
    batchStart += CUSTOMER_BATCH_SIZE
  ) {
    const batchEnd = Math.min(
      batchStart + CUSTOMER_BATCH_SIZE,
      CUSTOMER_COUNT,
    );

    const values: (string | null)[] = [];
    const placeholders: string[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const location = faker.helpers.arrayElement(LOCATIONS);
      const street = faker.helpers.arrayElement(location.streetNames);

      const referredBy =
        i > 0 && faker.number.int({ min: 1, max: 100 }) <= 10
          ? customerIds[
              faker.number.int({ min: 0, max: i - 1 })
            ]
          : null;

      const rowValues: (string | null)[] = [
        customerIds[i],
        faker.person.fullName(),
        `+91${faker.string.numeric(10)}`,
        referredBy,
        faker.helpers.arrayElement(WEEKDAYS),
        street,
        location.city,
        location.district,
        TARGET_ADMIN_ID,
        TARGET_ADMIN_ID,
      ];

      const rowPlaceholders = rowValues.map(
        (_, columnIndex) => `$${values.length + columnIndex + 1}`,
      );

      placeholders.push(`(${rowPlaceholders.join(", ")})`);
      values.push(...rowValues);
    }

    await pool.query(
      `
        INSERT INTO customers (
          id,
          customer_name,
          phone_number,
          referred_by_id,
          preferred_payment_day,
          street_name,
          city,
          district,
          created_by,
          owning_admin_id
        )
        VALUES ${placeholders.join(", ")}
      `,
      values,
    );

    console.log(`Customers inserted: ${batchEnd}/${CUSTOMER_COUNT}`);
  }

  return customerIds.map((id) => ({ id }));
}

// ---------- loan lifecycle simulation ----------

type LoanOutcome =
  | "PAID_ON_TIME"
  | "PAID_LATE"
  | "DEFAULTED"
  | "STILL_OPEN";

interface SimulatedPayment {
  weekNumber: number;
  amountPaid: number;
  paidAt: Date;
}

interface SimulatedLoan {
  issuedAt: Date;
  closedAt: Date | null;
  status: "ACTIVE" | "OVERDUE" | "PAID_OFF" | "DEFAULTED" | "CLOSED";
  totalMonths: number;
  totalWeeks: number;
  nominalAmount: number;
  upfrontFee: number;
  disbursedAmount: number;
  totalPayableAmount: number;
  weeklyPayableAmount: number;
  payments: SimulatedPayment[];
}

function simulateLoan(
  issuedAt: Date,
  admin: AdminDefaults,
  outcome: LoanOutcome,
  now: Date,
): SimulatedLoan {
  const nominalAmount = faker.helpers.arrayElement([
    5000,
    10000,
    15000,
    20000,
    25000,
    30000,
    35000,
    40000,
  ]);

  const totalMonths = faker.helpers.arrayElement([2, 2.5, 3]);
  const totalWeeks = calculateTotalWeeks(totalMonths);

  const upfrontFee = percentOf(
    nominalAmount,
    admin.default_upfront_fee_percentage,
  );

  const disbursedAmount = nominalAmount - upfrontFee;

  const totalPayableAmount =
    nominalAmount +
    percentOf(nominalAmount, admin.default_interest_percentage);

  const weeklyPayableAmount = Math.ceil(
    totalPayableAmount / totalWeeks,
  );

  const elapsedWeeks = Math.max(0, weeksBetween(issuedAt, now));

  const payments: SimulatedPayment[] = [];

  let totalCollected = 0;
  let closedAt: Date | null = null;
  let status: SimulatedLoan["status"] = "ACTIVE";

  // Open loans can have overdue-week payments, but only if those
  // payments actually occurred by the current date.
  const weeksToSimulate =
    outcome === "STILL_OPEN"
      ? elapsedWeeks
      : totalWeeks + (outcome === "PAID_LATE" ? 3 : 0);

  for (let week = 1; week <= weeksToSimulate; week++) {
    // A defaulted customer stops paying partway through the loan.
    if (
      outcome === "DEFAULTED" &&
      week > Math.floor(totalWeeks * 0.4)
    ) {
      break;
    }

    // Keep every simulated payment on or before the current date.
    const paidAt = addDays(
      issuedAt,
      week * 7 - faker.number.int({ min: 0, max: 2 }),
    );

    if (paidAt > now) {
      break;
    }

    const roll = Math.random();

    if (outcome === "STILL_OPEN" && roll < 0.12) {
      // A missed week does not create a repayment track or payment.
      continue;
    }

    const amountPaid =
      roll < 0.15
        ? Math.max(
            1,
            Math.floor(
              weeklyPayableAmount *
                faker.number.float({ min: 0.3, max: 0.8 }),
            ),
          )
        : weeklyPayableAmount;

    payments.push({
      weekNumber: week,
      amountPaid,
      paidAt,
    });

    totalCollected += amountPaid;

    if (totalCollected >= totalPayableAmount) {
      break;
    }
  }

  // A loan is paid off only when actual simulated collections reach
  // its total payable amount.
  if (totalCollected >= totalPayableAmount) {
    status = "PAID_OFF";

    const lastPayment = payments[payments.length - 1];

    closedAt = minDate(
      addDays(
        lastPayment.paidAt,
        faker.number.int({ min: 0, max: 3 }),
      ),
      now,
    );

    if (outcome === "PAID_LATE" || Math.random() < 0.05) {
      status = "CLOSED";
    }
  } else if (
    outcome === "DEFAULTED" &&
    elapsedWeeks > Math.floor(totalWeeks * 0.4)
  ) {
    // Only mark a default if sufficient time has passed for the
    // simulated borrower to have stopped paying.
    status = "DEFAULTED";

    const lastPayment = payments[payments.length - 1];
    const lastActivity = lastPayment?.paidAt ?? issuedAt;

    closedAt = minDate(addDays(lastActivity, 28), now);
  } else {
    // OVERDUE is set only when a payment is actually collected
    // after the loan's scheduled term.
    const hasExtensionPayment = payments.some(
      (payment) => payment.weekNumber > totalWeeks,
    );

    status = hasExtensionPayment ? "OVERDUE" : "ACTIVE";
  }

  return {
    issuedAt,
    closedAt,
    status,
    totalMonths,
    totalWeeks,
    nominalAmount,
    upfrontFee,
    disbursedAmount,
    totalPayableAmount,
    weeklyPayableAmount,
    payments,
  };
}

// ---------- generate customer loan histories ----------

type SeedLoanPlan = {
  id: string;
  customerId: string;
  loan: SimulatedLoan;
};

function buildLoansForCustomer(
  customerId: string,
  admin: AdminDefaults,
  now: Date,
): SeedLoanPlan[] {
  // 10% of customers have never borrowed.
  if (Math.random() < 0.1) {
    return [];
  }

  const loanCount = faker.helpers.weightedArrayElement([
    { value: 1, weight: 45 },
    { value: 2, weight: 35 },
    { value: 3, weight: 20 },
  ]);

  // Random first-loan date between August 1 and now.
  const startTimestamp = LOAN_HISTORY_START_DATE.getTime();
  const nowTimestamp = now.getTime();

  const randomStartTimestamp =
    startTimestamp +
    Math.floor(
      Math.random() * (nowTimestamp - startTimestamp + 1),
    );

  let cursor = new Date(randomStartTimestamp);

  const plans: SeedLoanPlan[] = [];

  for (let i = 0; i < loanCount; i++) {
    const isLastLoan = i === loanCount - 1;

    const outcome: LoanOutcome = isLastLoan
      ? faker.helpers.weightedArrayElement([
          { value: "STILL_OPEN" as const, weight: 55 },
          { value: "PAID_ON_TIME" as const, weight: 25 },
          { value: "PAID_LATE" as const, weight: 15 },
          { value: "DEFAULTED" as const, weight: 5 },
        ])
      : faker.helpers.weightedArrayElement([
          { value: "PAID_ON_TIME" as const, weight: 60 },
          { value: "PAID_LATE" as const, weight: 30 },
          { value: "DEFAULTED" as const, weight: 10 },
        ]);

    if (cursor >= now) {
      break;
    }

    const loan = simulateLoan(cursor, admin, outcome, now);

    plans.push({
      id: randomUUID(),
      customerId,
      loan,
    });

    if (loan.closedAt) {
      cursor = addDays(
        loan.closedAt,
        faker.number.int({ min: 7, max: 60 }),
      );
    } else {
      // Do not issue another loan while the previous loan is open.
      break;
    }
  }

  return plans;
}

// ---------- batch database inserts ----------

type DbValue = string | number | boolean | Date | null;

async function insertRowsInBatches(
  pool: ReturnType<typeof getPool>,
  table: string,
  columns: string[],
  rows: DbValue[][],
  batchSize = 500,
): Promise<void> {
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const values: DbValue[] = [];

    const placeholders = batch.map((row, rowIndex) => {
      if (row.length !== columns.length) {
        throw new Error(`Invalid row length for ${table}`);
      }

      const offset = rowIndex * columns.length;
      values.push(...row);

      return `(${row
        .map((_, columnIndex) => `$${offset + columnIndex + 1}`)
        .join(", ")})`;
    });

    await pool.query(
      `
        INSERT INTO ${table} (${columns.join(", ")})
        VALUES ${placeholders.join(", ")}
      `,
      values,
    );

    console.log(
      `${table}: ${Math.min(start + batch.length, rows.length)}/${rows.length}`,
    );
  }
}

async function seedLoansInBatches(
  pool: ReturnType<typeof getPool>,
  customers: SeedCustomer[],
  admin: AdminDefaults,
  now: Date,
): Promise<void> {
  console.log("Generating loan histories...");

  const plans: SeedLoanPlan[] = [];

  for (let i = 0; i < customers.length; i++) {
    plans.push(
      ...buildLoansForCustomer(customers[i].id, admin, now),
    );

    if (
      (i + 1) % 1000 === 0 ||
      i + 1 === customers.length
    ) {
      console.log(
        `Histories generated: ${i + 1}/${customers.length}`,
      );
    }
  }

  console.log(
    `Generated ${plans.length} loans. Inserting in batches...`,
  );

  // 1. Insert loans before their repayment tracks.
  await insertRowsInBatches(
    pool,
    "loans",
    [
      "id",
      "customer_id",
      "issued_by_admin_id",
      "owning_admin_id",
      "nominal_amount",
      "upfront_fee",
      "disbursed_amount",
      "total_payable_amount",
      "weekly_payable_amount",
      "total_months",
      "total_weeks",
      "status",
      "issued_at",
      "closed_at",
    ],
    plans.map(({ id, customerId, loan }) => [
      id,
      customerId,
      TARGET_ADMIN_ID,
      TARGET_ADMIN_ID,
      loan.nominalAmount,
      loan.upfrontFee,
      loan.disbursedAmount,
      loan.totalPayableAmount,
      loan.weeklyPayableAmount,
      loan.totalMonths,
      loan.totalWeeks,
      loan.status,
      loan.issuedAt,
      loan.closedAt,
    ]),
    LOAN_BATCH_SIZE,
  );

  // 2. Create tracks only for weeks that have a payment.
  const tracks: DbValue[][] = [];
  const payments: DbValue[][] = [];

  for (const { id: loanId, loan } of plans) {
    for (const payment of loan.payments) {
      const trackId = randomUUID();

      tracks.push([
        trackId,
        loanId,
        payment.weekNumber,
        payment.amountPaid,
        loan.weeklyPayableAmount,
        payment.amountPaid >= loan.weeklyPayableAmount
          ? "PAID"
          : "PARTIAL",
        payment.weekNumber > loan.totalWeeks,
      ]);

      payments.push([
        trackId,
        loanId,
        payment.amountPaid,
        TARGET_ADMIN_ID,
        payment.paidAt,
      ]);
    }
  }

  console.log(
    `Generated ${tracks.length} repayment tracks and ${payments.length} payments.`,
  );

  // 3. Tracks must exist before payments reference them.
  await insertRowsInBatches(
    pool,
    "repayment_tracks",
    [
      "id",
      "loan_id",
      "week_number",
      "total_collected",
      "target_amount",
      "status",
      "is_overdued",
    ],
    tracks,
    TRACK_BATCH_SIZE,
  );

  // 4. Insert payments.
  await insertRowsInBatches(
    pool,
    "payments",
    [
      "track_id",
      "loan_id",
      "amount_paid",
      "collected_by_admin_id",
      "paid_at",
    ],
    payments,
    PAYMENT_BATCH_SIZE,
  );

  console.log(
    `Loan seeding complete: ${plans.length} loans, ` +
      `${tracks.length} tracks, ${payments.length} payments.`,
  );
}

// ---------- main ----------

async function main(): Promise<void> {
  const pool = getPool();

  try {
    const now = new Date();

    if (now < LOAN_HISTORY_START_DATE) {
      throw new Error(
        "The current date is before August 1, 2026. Update LOAN_HISTORY_START_DATE.",
      );
    }

    const admin = await loadAdminDefaults(pool);

    // WARNING: this deletes existing data for TARGET_ADMIN_ID.
    await wipeAdminData(pool);

    console.log("Starting customer seeding...");

    const customers = await seedCustomers(pool);

    console.log(
      `Customer seeding complete: ${customers.length} customers.`,
    );

    await seedLoansInBatches(
      pool,
      customers,
      admin,
      now,
    );

    console.log("All seed data inserted successfully.");
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  console.error("Seeding failed:", error);
  process.exitCode = 1;
});
