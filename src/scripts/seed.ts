import { faker } from "@faker-js/faker";
import { getPool, closePool } from "../config/database";

const WEEKDAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

const USER_COUNT = 100;
const UPFRONT_FEE_PERCENT = 5;
const INTEREST_PERCENT = 25;

function percentOf(amount: number, percent: number) {
  return Math.round((amount * percent) / 100);
}

async function seedUsers(pool = getPool()) {
  const userIds: string[] = [];
  for (let i = 0; i < USER_COUNT; i++) {
    const referredBy =
      i > 5 && i % 5 === 0
        ? userIds[faker.number.int({ min: 0, max: i - 1 })]
        : null;

    const result = await pool.query(
      `
        INSERT INTO users (user_name, phone_number, referred_by_id, preferred_payment_day)
        VALUES ($1, $2, $3, $4) RETURNING id
      `,
      [ 
        faker.person.fullName(),
        faker.phone
          .number({ style: "national" })
          .replace(/\D/g, "")
          .slice(0, 10),
        referredBy,
        faker.helpers.arrayElement(WEEKDAYS),
      ],
    );
    userIds.push(result.rows[0].id);
  }
  console.log(`Seeded ${userIds.length} users`);
  return userIds;
}

async function issueLoan(pool: ReturnType<typeof getPool>, userId: string) {
  const nominalAmount = faker.helpers.arrayElement([5000, 10000, 15000, 20000]);
  const upfrontFee = percentOf(nominalAmount, UPFRONT_FEE_PERCENT);
  const disbursedAmount = nominalAmount - upfrontFee;
  const totalPayableAmount = nominalAmount + percentOf(nominalAmount, INTEREST_PERCENT);
  const totalWeeks = 10;
  const weeklyPayableAmount = Math.ceil(totalPayableAmount / totalWeeks);
 
  // Backdate issued_at so some loans naturally fall overdue or mid-way through
  const weeksAgo = faker.number.int({ min: 0, max: 14 });
  const issuedAt = new Date();
  issuedAt.setDate(issuedAt.getDate() - weeksAgo * 7);
 
  const result = await pool.query(
    `INSERT INTO loans (user_id, nominal_amount, upfront_fee, disbursed_amount, total_payable_amount, weekly_payable_amount, total_months, total_weeks, issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [userId, nominalAmount, upfrontFee, disbursedAmount, totalPayableAmount, weeklyPayableAmount, 2.5, totalWeeks, issuedAt],
  );
  return { loan: result.rows[0], weeksAgo };
}
 
async function collectPayment(
  pool: ReturnType<typeof getPool>,
  loanId: string,
  weekNumber: number,
  targetAmount: number,
  amountPaid: number,
) {
  const inserted = await pool.query(
    `INSERT INTO repayment_tracks (loan_id, week_number, target_amount, is_overdued)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (loan_id, week_number) DO NOTHING
     RETURNING id, total_collected`,
    [loanId, weekNumber, targetAmount, weekNumber > 10],
  );
  const track = inserted.rows[0]
    ?? (await pool.query(
      `SELECT id, total_collected FROM repayment_tracks WHERE loan_id = $1 AND week_number = $2`,
      [loanId, weekNumber],
    )).rows[0];
 
  const newTotal = track.total_collected + amountPaid;
  const status = newTotal >= targetAmount ? "PAID" : "PARTIAL";
 
  await pool.query(`UPDATE repayment_tracks SET total_collected = $1, status = $2 WHERE id = $3`, [
    newTotal, status, track.id,
  ]);
  await pool.query(
    `INSERT INTO payments (track_id, loan_id, amount_paid) VALUES ($1, $2, $3)`,
    [track.id, loanId, amountPaid],
  );
  return newTotal;
}
 
async function seedLoansAndPayments(pool: ReturnType<typeof getPool>, userIds: string[]) {
  // Give roughly 70% of users a loan, so the "one active loan" constraint
  // and the referral/no-loan cases both show up in your test data.
  const borrowerIds = faker.helpers.arrayElements(userIds, Math.floor(userIds.length * 0.7));
  let loanCount = 0;
  let paymentCount = 0;
 
  for (const userId of borrowerIds) {
    const { loan, weeksAgo } = await issueLoan(pool, userId);
    loanCount++;
 
    // Simulate 0 to weeksAgo weeks of collection, with occasional missed/partial weeks
    let totalCollected = 0;
    for (let week = 1; week <= Math.min(weeksAgo, 13); week++) {
      const roll = Math.random();
      if (roll < 0.15) continue; // missed week entirely — leaves it untracked, per your rule
      const payAmount = roll < 0.35
        ? Math.floor(loan.weekly_payable_amount * 0.5) // partial payment
        : loan.weekly_payable_amount; // full payment
 
      totalCollected += await collectPayment(pool, loan.id, week, loan.weekly_payable_amount, payAmount);
      paymentCount++;
 
      if (totalCollected >= loan.total_payable_amount) {
        await pool.query(`UPDATE loans SET status = 'PAID_OFF' WHERE id = $1`, [loan.id]);
        break;
      }
    }
 
    if (weeksAgo > 10 && totalCollected < loan.total_payable_amount) {
      await pool.query(`UPDATE loans SET status = 'OVERDUE' WHERE id = $1`, [loan.id]);
    }
  }
 
  console.log(`Seeded ${loanCount} loans and ${paymentCount} payments`);
}
 
async function main() {
  const pool = getPool();
  const userIds = await seedUsers(pool);
  await seedLoansAndPayments(pool, userIds);
  await closePool();
  console.log("Done.");
}
 
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
 