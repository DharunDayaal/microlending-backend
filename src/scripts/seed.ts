import { faker } from "@faker-js/faker";
import { Pool, PoolClient } from "pg";
import { getPool } from "../config/database";

const pool = getPool();
/**
 * Existing ADMIN in your database.
 */
const ADMIN_ID = "eb4bc22a-eac5-479c-99e6-db854e860648";

/**
 * Seed configuration
 */
const CUSTOMER_COUNT = 11_000;
const EMPLOYEE_COUNT = 10;

const CUSTOMER_BATCH_SIZE = 1_000;
const LOAN_BATCH_SIZE = 1_000;
const TRACK_BATCH_SIZE = 2_000;
const PAYMENT_BATCH_SIZE = 2_000;

/**
 * Percentage of customers that should have loans.
 */
const LOAN_CUSTOMER_PERCENTAGE = 0.85;

/**
 * Percentage of today's customers that should
 * be deliberately created for dashboard testing.
 */
const TODAY_DUE_PERCENTAGE = 0.20;

/**
 * Enums from your PostgreSQL schema.
 */
type Weekday =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

type LoanStatus =
  | "ACTIVE"
  | "OVERDUE"
  | "PAID_OFF";

type PaymentStatus =
  | "PAID"
  | "PARTIAL"
  | "UNPAID";

interface Location {
  district: "Cuddalore" | "Puducherry";
  city: string;
  street: string;
}

interface SeedCustomer {
  id: string;
  preferredPaymentDay: Weekday;
  createdBy: string;
  district: "Cuddalore" | "Puducherry";
  city: string;
}

interface SeedLoan {
  id: string;
  customerId: string;
  weeklyPayableAmount: number;
  totalWeeks: number;
  status: LoanStatus;
  issuedAt: Date;
}

interface SeedTrack {
  id: string;
  loanId: string;
  weekNumber: number;
  targetAmount: number;
  totalCollected: number;
  status: PaymentStatus;
}

interface SeedUser {
  id: string;
}

/* =========================================================
   CONTROLLED LOCATIONS
   ========================================================= */

const LOCATIONS: Location[] = [
  // Cuddalore
  {
    district: "Cuddalore",
    city: "Cuddalore",
    street: "Nethaji Road",
  },
  {
    district: "Cuddalore",
    city: "Cuddalore",
    street: "Lawrence Road",
  },
  {
    district: "Cuddalore",
    city: "Cuddalore",
    street: "Beach Road",
  },
  {
    district: "Cuddalore",
    city: "Cuddalore",
    street: "Semmandalam Main Road",
  },
  {
    district: "Cuddalore",
    city: "Cuddalore",
    street: "Manjakuppam Main Road",
  },
  {
    district: "Cuddalore",
    city: "Cuddalore",
    street: "Imperial Road",
  },
  {
    district: "Cuddalore",
    city: "Panruti",
    street: "Gandhi Road",
  },
  {
    district: "Cuddalore",
    city: "Panruti",
    street: "Cuddalore Main Road",
  },
  {
    district: "Cuddalore",
    city: "Chidambaram",
    street: "East Car Street",
  },
  {
    district: "Cuddalore",
    city: "Chidambaram",
    street: "S.P. Koil Street",
  },
  {
    district: "Cuddalore",
    city: "Virudhachalam",
    street: "Cuddalore Road",
  },
  {
    district: "Cuddalore",
    city: "Neyveli",
    street: "Block 10 Main Road",
  },

  // Puducherry
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "MG Road",
  },
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "Mission Street",
  },
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "Bussy Street",
  },
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "Anna Salai",
  },
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "Kamaraj Salai",
  },
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "Lawspet Main Road",
  },
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "Reddiarpalayam Main Road",
  },
  {
    district: "Puducherry",
    city: "Puducherry",
    street: "Auroville Road",
  },
];

/* =========================================================
   HELPERS
   ========================================================= */

const WEEKDAYS: Weekday[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const CUSTOMER_FIRST_NAMES = [
  "Arun",
  "Praveen",
  "Suresh",
  "Karthik",
  "Vignesh",
  "Dinesh",
  "Manoj",
  "Ramesh",
  "Sathish",
  "Mohan",
  "Bala",
  "Saravanan",
  "Vijay",
  "Ajith",
  "Gokul",
  "Hari",
  "Naveen",
  "Ravi",
  "Sanjay",
  "Muthukumar",
  "Surya",
  "Ashok",
  "Rajesh",
  "Senthil",
  "Murugan",
];

const CUSTOMER_LAST_NAMES = [
  "Kumar",
  "Raj",
  "Babu",
  "Prasad",
  "Murugan",
  "Raja",
  "Mohan",
  "Selvam",
  "Nathan",
  "Shankar",
  "Das",
];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomInt(min: number, max: number): number {
  return faker.number.int({
    min,
    max,
  });
}

function randomAmount(
  min: number,
  max: number,
  step = 5_000
): number {
  const count = Math.floor((max - min) / step);

  return min + randomInt(0, count) * step;
}

function randomLocation(): Location {
  return randomItem(LOCATIONS);
}

function randomCustomerName(): string {
  return `${randomItem(
    CUSTOMER_FIRST_NAMES
  )} ${randomItem(CUSTOMER_LAST_NAMES)}`;
}

/**
 * Guaranteed unique Indian-looking phone number.
 *
 * We don't rely on Faker uniqueness here because
 * customers.phone_number has a UNIQUE constraint.
 */
function customerPhone(index: number): string {
  return `9${String(index).padStart(9, "0")}`;
}

function randomDateBetween(
  minDaysAgo: number,
  maxDaysAgo: number
): Date {
  const daysAgo = randomInt(
    minDaysAgo,
    maxDaysAgo
  );

  const date = new Date();

  date.setDate(date.getDate() - daysAgo);

  return date;
}

function todayWeekday(): Weekday {
  const day = new Date().getDay();

  const map: Weekday[] = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];

  return map[day];
}

function getPaymentStatus(
  collected: number,
  target: number
): PaymentStatus {
  if (collected >= target) {
    return "PAID";
  }

  if (collected > 0) {
    return "PARTIAL";
  }

  return "UNPAID";
}

function generateCollection(
  target: number,
  status: PaymentStatus
): number {
  if (status === "PAID") {
    return target;
  }

  if (status === "PARTIAL") {
    return randomInt(
      Math.floor(target * 0.2),
      target - 1
    );
  }

  return 0;
}

/* =========================================================
   BULK INSERT HELPER
   ========================================================= */

/**
 * Inserts rows in batches.
 *
 * Example:
 *
 * INSERT INTO table (a,b,c)
 * VALUES
 *   ($1,$2,$3),
 *   ($4,$5,$6),
 *   ...
 */
async function bulkInsert(
  client: PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
  batchSize: number,
  casts: Record<number, string> = {}
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  for (
    let start = 0;
    start < rows.length;
    start += batchSize
  ) {
    const batch = rows.slice(
      start,
      start + batchSize
    );

    const values: unknown[] = [];
    const placeholders: string[] = [];

    let parameterIndex = 1;

    for (const row of batch) {
      const rowPlaceholders = row.map(
        (_, columnIndex) => {
          const cast = casts[columnIndex] ?? "";

          const placeholder = `$${parameterIndex}${cast}`;

          parameterIndex++;

          return placeholder;
        }
      );

      placeholders.push(
        `(${rowPlaceholders.join(", ")})`
      );

      values.push(...row);
    }

    const query = `
      INSERT INTO ${table} (
        ${columns.join(", ")}
      )
      VALUES
        ${placeholders.join(", ")}
    `;

    await client.query(query, values);

    console.log(
      `Inserted ${Math.min(
        start + batch.length,
        rows.length
      )}/${rows.length} into ${table}`
    );
  }
}

/* =========================================================
   USERS
   ========================================================= */

async function seedUsers(
  client: PoolClient
): Promise<SeedUser[]> {
  const users: SeedUser[] = [];

  const rows: unknown[][] = [];

  for (let i = 0; i < EMPLOYEE_COUNT; i++) {
    const id = faker.string.uuid();

    rows.push([
      id,
      `Employee ${i + 1}`,
      `8${String(i).padStart(9, "0")}`,
      `employee${i + 1}@seed.local`,

      /**
       * Development-only placeholder.
       *
       * IMPORTANT:
       * Don't use this password hash for production users.
       */
      "$2b$10$seedOnlyDevelopmentPasswordHash",

      "USER",
      true,
      true,

      5,
      25,
      2.5,
      10,

      ADMIN_ID,
    ]);

    users.push({
      id,
    });
  }

  await bulkInsert(
    client,
    "public.users",
    [
      "id",
      "user_name",
      "phone_number",
      "email",
      "password_hash",
      "role",
      "is_verified",
      "is_active",
      "default_upfront_fee_percentage",
      "default_interest_percentage",
      "default_total_months",
      "default_total_weeks",
      "admin_id",
    ],
    rows,
    1_000,
    {
      5: "::public.user_role",
    }
  );

  return users;
}

/* =========================================================
   CUSTOMERS
   ========================================================= */

async function seedCustomers(
  client: PoolClient,
  users: SeedUser[]
): Promise<SeedCustomer[]> {
  const customers: SeedCustomer[] = [];

  const rows: unknown[][] = [];

  const today = todayWeekday();

  for (let i = 0; i < CUSTOMER_COUNT; i++) {
    const id = faker.string.uuid();

    /**
     * First 20% are deliberately assigned today's
     * payment weekday.
     *
     * This makes the dashboard useful immediately
     * after seeding.
     */
    const isTodayCustomer =
      i <
      Math.floor(
        CUSTOMER_COUNT *
          TODAY_DUE_PERCENTAGE
      );

    const preferredPaymentDay =
      isTodayCustomer
        ? today
        : randomItem(WEEKDAYS);

    const location = randomLocation();

    const createdBy =
      users.length > 0
        ? randomItem(users).id
        : ADMIN_ID;

    rows.push([
      id,
      randomCustomerName(),
      customerPhone(i + 1),

      null,

      preferredPaymentDay,

      new Date(),

      createdBy,

      new Date(),

      ADMIN_ID,

      location.street,
      location.city,
      location.district,
    ]);

    customers.push({
      id,
      preferredPaymentDay,
      createdBy,
      district: location.district,
      city: location.city,
    });
  }

  await bulkInsert(
    client,
    "public.customers",
    [
      "id",
      "customer_name",
      "phone_number",
      "referred_by_id",
      "preferred_payment_day",
      "created_at",
      "created_by",
      "updated_at",
      "owning_admin_id",
      "street_name",
      "city",
      "district",
    ],
    rows,
    CUSTOMER_BATCH_SIZE,
    {
      4: "::public.week",
    }
  );

  return customers;
}

/* =========================================================
   REFERRALS
   ========================================================= */

async function seedReferrals(
  client: PoolClient,
  customerIds: string[]
) {
  console.log("Creating referrals...");

  const referralCount = Math.floor(customerIds.length * 0.2);

  if (referralCount === 0) {
    return;
  }

  const referralPairs: Array<[string, string]> = [];

  for (let i = 0; i < referralCount; i++) {
    const customerId = customerIds[i];

    // Pick a different customer as the referrer
    let referrerId =
      customerIds[Math.floor(Math.random() * customerIds.length)];

    while (referrerId === customerId) {
      referrerId =
        customerIds[Math.floor(Math.random() * customerIds.length)];
    }

    referralPairs.push([customerId, referrerId]);
  }

  const BATCH_SIZE = 1000;

  for (let i = 0; i < referralPairs.length; i += BATCH_SIZE) {
    const batch = referralPairs.slice(i, i + BATCH_SIZE);

    const values: string[] = [];
    const params: string[] = [];

    let paramIndex = 1;

    for (const [customerId, referrerId] of batch) {
      values.push(
        `($${paramIndex}::uuid, $${paramIndex + 1}::uuid)`
      );

      params.push(customerId, referrerId);

      paramIndex += 2;
    }

    await client.query(
      `
      UPDATE public.customers AS c
      SET referred_by_id = refs.referrer_id
      FROM (
        VALUES ${values.join(", ")}
      ) AS refs(customer_id, referrer_id)
      WHERE c.id = refs.customer_id
      `,
      params
    );

    console.log(
      `Updated referrals: ${Math.min(
        i + BATCH_SIZE,
        referralPairs.length
      )}/${referralPairs.length}`
    );
  }
}
/* =========================================================
   LOANS
   ========================================================= */

async function seedLoans(
  client: PoolClient,
  customers: SeedCustomer[]
): Promise<SeedLoan[]> {
  const loans: SeedLoan[] = [];

  const rows: unknown[][] = [];

  const today = todayWeekday();

  /**
   * Only ~85% of customers receive loans.
   *
   * Customers whose payment day is today are strongly
   * biased toward getting an active/overdue loan.
   */
  for (const customer of customers) {
    if (
      Math.random() >
      LOAN_CUSTOMER_PERCENTAGE
    ) {
      continue;
    }

    const id = faker.string.uuid();

    const nominalAmount = randomAmount(
      5_000,
      50_000,
      5_000
    );

    const upfrontFeePercentage = randomInt(
      2,
      5
    );

    const upfrontFee = Math.round(
      nominalAmount *
        (upfrontFeePercentage / 100)
    );

    const disbursedAmount =
      nominalAmount - upfrontFee;

    const totalWeeks = randomItem([
      8,
      10,
      12,
    ]);

    const totalMonths =
      totalWeeks / 4;

    const interestPercentage = randomInt(
      10,
      20
    );

    const interestAmount = Math.round(
      disbursedAmount *
        (interestPercentage / 100)
    );

    const totalPayableAmount =
      disbursedAmount + interestAmount;

    const weeklyPayableAmount = Math.ceil(
      totalPayableAmount / totalWeeks
    );

    /**
     * Make today's borrowers mostly ACTIVE/OVERDUE.
     */
    let status: LoanStatus;

    if (
      customer.preferredPaymentDay === today
    ) {
      const roll = Math.random();

      if (roll < 0.70) {
        status = "ACTIVE";
      } else {
        status = "OVERDUE";
      }
    } else {
      const roll = Math.random();

      if (roll < 0.55) {
        status = "ACTIVE";
      } else if (roll < 0.75) {
        status = "OVERDUE";
      } else {
        status = "PAID_OFF";
      }
    }

    /**
     * Keep loan age within the 10-week repayment
     * period so that active loans have a valid
     * repayment track.
     *
     * We use 14-60 days for active/overdue.
     */
    let issuedAt: Date;

    if (
      status === "ACTIVE" ||
      status === "OVERDUE"
    ) {
      issuedAt = randomDateBetween(
        7,
        60
      );
    } else {
      issuedAt = randomDateBetween(
        75,
        180
      );
    }

    rows.push([
      id,
      customer.id,
      nominalAmount,
      upfrontFee,
      disbursedAmount,
      totalPayableAmount,
      weeklyPayableAmount,
      totalMonths,
      totalWeeks,
      status,
      issuedAt,
      ADMIN_ID,
      new Date(),
      ADMIN_ID,
    ]);

    loans.push({
      id,
      customerId: customer.id,
      weeklyPayableAmount,
      totalWeeks,
      status,
      issuedAt,
    });
  }

  await bulkInsert(
    client,
    "public.loans",
    [
      "id",
      "customer_id",
      "nominal_amount",
      "upfront_fee",
      "disbursed_amount",
      "total_payable_amount",
      "weekly_payable_amount",
      "total_months",
      "total_weeks",
      "status",
      "issued_at",
      "issued_by_admin_id",
      "updated_at",
      "owning_admin_id",
    ],
    rows,
    LOAN_BATCH_SIZE,
    {
      9: "::public.loan_status",
    }
  );

  return loans;
}

/* =========================================================
   CALCULATE CURRENT WEEK
   ========================================================= */

function getWeekNumber(
  issuedAt: Date,
  totalWeeks: number
): number {
  const now = new Date();

  const difference =
    now.getTime() -
    issuedAt.getTime();

  const daysElapsed =
    difference /
    (1000 * 60 * 60 * 24);

  const week =
    Math.floor(daysElapsed / 7) + 1;

  return Math.max(
    1,
    Math.min(totalWeeks, week)
  );
}

/* =========================================================
   REPAYMENT TRACKS
   ========================================================= */

async function seedRepaymentTracks(
  client: PoolClient,
  loans: SeedLoan[]
): Promise<SeedTrack[]> {
  const tracks: SeedTrack[] = [];

  const rows: unknown[][] = [];

  for (const loan of loans) {
    /**
     * Generate all tracks.
     *
     * 10,000 customers × ~85% loans × 10 weeks
     * ≈ 85,000 tracks.
     */
    for (
      let weekNumber = 1;
      weekNumber <= loan.totalWeeks;
      weekNumber++
    ) {
      const id = faker.string.uuid();

      let status: PaymentStatus;

      /**
       * For PAID_OFF loans all historical tracks
       * are paid.
       */
      if (loan.status === "PAID_OFF") {
        status = "PAID";
      } else {
        const currentWeek =
          getWeekNumber(
            loan.issuedAt,
            loan.totalWeeks
          );

        /**
         * Tracks before current week:
         * mostly paid, but some overdue/partial.
         */
        if (weekNumber < currentWeek) {
          const roll = Math.random();

          if (roll < 0.75) {
            status = "PAID";
          } else if (roll < 0.90) {
            status = "PARTIAL";
          } else {
            status = "UNPAID";
          }
        }

        /**
         * Current week:
         * intentionally mixed so dashboard has
         * paid/partial/unpaid customers.
         */
        else if (weekNumber === currentWeek) {
          const roll = Math.random();

          if (roll < 0.45) {
            status = "PAID";
          } else if (roll < 0.70) {
            status = "PARTIAL";
          } else {
            status = "UNPAID";
          }
        }

        /**
         * Future tracks are unpaid.
         */
        else {
          status = "UNPAID";
        }
      }

      const totalCollected =
        generateCollection(
          loan.weeklyPayableAmount,
          status
        );

      const isOverdued =
        loan.status === "OVERDUE" &&
        status !== "PAID" &&
        weekNumber <=
          getWeekNumber(
            loan.issuedAt,
            loan.totalWeeks
          );

      rows.push([
        id,
        loan.id,
        weekNumber,
        totalCollected,
        loan.weeklyPayableAmount,
        status,
        isOverdued,
      ]);

      tracks.push({
        id,
        loanId: loan.id,
        weekNumber,
        targetAmount:
          loan.weeklyPayableAmount,
        totalCollected,
        status,
      });
    }
  }

  await bulkInsert(
    client,
    "public.repayment_tracks",
    [
      "id",
      "loan_id",
      "week_number",
      "total_collected",
      "target_amount",
      "status",
      "is_overdued",
    ],
    rows,
    TRACK_BATCH_SIZE,
    {
      5: "::public.payment_status",
    }
  );

  return tracks;
}

/* =========================================================
   PAYMENTS
   ========================================================= */

async function seedPayments(
  client: PoolClient,
  tracks: SeedTrack[]
): Promise<void> {
  const rows: unknown[][] = [];

  for (const track of tracks) {
    if (track.totalCollected <= 0) {
      continue;
    }

    /**
     * Sometimes create multiple payments for a track.
     * This makes payment data more realistic.
     */
    const createMultiplePayments =
      Math.random() < 0.25;

    if (!createMultiplePayments) {
      rows.push([
        faker.string.uuid(),
        track.id,
        track.loanId,
        track.totalCollected,
        randomDateBetween(0, 30),
        ADMIN_ID,
      ]);

      continue;
    }

    const firstAmount = Math.floor(
      track.totalCollected * 0.6
    );

    const secondAmount =
      track.totalCollected -
      firstAmount;

    rows.push([
      faker.string.uuid(),
      track.id,
      track.loanId,
      firstAmount,
      randomDateBetween(1, 30),
      ADMIN_ID,
    ]);

    if (secondAmount > 0) {
      rows.push([
        faker.string.uuid(),
        track.id,
        track.loanId,
        secondAmount,
        randomDateBetween(0, 10),
        ADMIN_ID,
      ]);
    }
  }

  await bulkInsert(
    client,
    "public.payments",
    [
      "id",
      "track_id",
      "loan_id",
      "amount_paid",
      "paid_at",
      "collected_by_admin_id",
    ],
    rows,
    PAYMENT_BATCH_SIZE
  );
}

/* =========================================================
   VALIDATION
   ========================================================= */

async function printSeedSummary(
  client: PoolClient
): Promise<void> {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM public.users
       WHERE admin_id = '${ADMIN_ID}') AS users,

      (SELECT COUNT(*) FROM public.customers
       WHERE owning_admin_id = '${ADMIN_ID}') AS customers,

      (SELECT COUNT(*) FROM public.loans
       WHERE owning_admin_id = '${ADMIN_ID}') AS loans,

      (SELECT COUNT(*)
       FROM public.repayment_tracks rt
       INNER JOIN public.loans l
         ON l.id = rt.loan_id
       WHERE l.owning_admin_id = '${ADMIN_ID}')
       AS repayment_tracks,

      (SELECT COUNT(*)
       FROM public.payments p
       INNER JOIN public.loans l
         ON l.id = p.loan_id
       WHERE l.owning_admin_id = '${ADMIN_ID}')
       AS payments;
  `);

  console.log("");
  console.log("======================================");
  console.log("SEED SUMMARY");
  console.log("======================================");

  console.table(result.rows[0]);

  console.log("======================================");
}

/* =========================================================
   MAIN SEED
   ========================================================= */

async function seed(): Promise<void> {
  const client = await pool.connect();

  const startedAt = Date.now();

  try {
    console.log("");
    console.log("======================================");
    console.log("Starting database seed");
    console.log(`Customers: ${CUSTOMER_COUNT}`);
    console.log(`Admin: ${ADMIN_ID}`);
    console.log("======================================");
    console.log("");

    await client.query("BEGIN");

    /**
     * Verify existing admin.
     */
    const adminResult = await client.query(
      `
      SELECT
        id,
        role,
        is_active
      FROM public.users
      WHERE id = $1
      `,
      [ADMIN_ID]
    );

    if (adminResult.rowCount === 0) {
      throw new Error(
        `Admin ${ADMIN_ID} does not exist`
      );
    }

    if (
      adminResult.rows[0].role !== "ADMIN"
    ) {
      throw new Error(
        `${ADMIN_ID} is not an ADMIN`
      );
    }

    if (!adminResult.rows[0].is_active) {
      throw new Error(
        `${ADMIN_ID} is inactive`
      );
    }

    console.log("Existing admin verified.");

    /**
     * 1. Employees
     */
    console.log("");
    console.log(
      `Creating ${EMPLOYEE_COUNT} employees...`
    );

    const users = await seedUsers(client);

    /**
     * 2. Customers
     */
    console.log("");
    console.log(
      `Creating ${CUSTOMER_COUNT} customers...`
    );

    const customers =
      await seedCustomers(
        client,
        users
      );

    /**
     * 3. Referrals
     */
    console.log("");
    console.log("Creating referrals...");

    await seedReferrals(
      client,
      customers.map((customer) => customer.id)
    );

    /**
     * 4. Loans
     */
    console.log("");
    console.log("Creating loans...");

    const loans = await seedLoans(
      client,
      customers
    );

    /**
     * 5. Repayment tracks
     */
    console.log("");
    console.log(
      "Creating repayment tracks..."
    );

    const tracks =
      await seedRepaymentTracks(
        client,
        loans
      );

    /**
     * 6. Payments
     */
    console.log("");
    console.log("Creating payments...");

    await seedPayments(
      client,
      tracks
    );

    /**
     * Validate.
     */
    await printSeedSummary(client);

    await client.query("COMMIT");

    const elapsed =
      (Date.now() - startedAt) / 1000;

    console.log("");
    console.log(
      `Seed completed successfully in ${elapsed.toFixed(
        2
      )} seconds.`
    );
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("");
    console.error(
      "======================================"
    );
    console.error(
      "SEED FAILED - TRANSACTION ROLLED BACK"
    );
    console.error(
      "======================================"
    );
    console.error(error);

    process.exitCode = 1;
  } finally {
    client.release();

    await pool.end();
  }
}

seed();