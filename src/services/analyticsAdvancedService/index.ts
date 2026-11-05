import { AppError } from "../../helpers";
import * as Repo from "../../repositories/analyticsRepo";
import * as Adv from "../../repositories/analyticsAdvancedRepo";
import { resolveScope } from "../../services/analyticsService";
import type { RequestingUser } from "../../types/authTypes";
import type {
  CalendarQuery,
  CohortsQuery,
  CompareQuery,
  InsightsQuery,
} from "../../schemas/analyticsAdvancedSchema";

// helpers
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number): number | null =>
  den > 0 ? round1((num / den) * 100) : null;
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const todayIst = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const daysBetween = (a: string, b: string) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );

/** Monday of the week containing `date`. */
function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

const WEEKDAY_NAMES = [
  "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
];

function requireAdmin(user: RequestingUser): void {
  if (user.role === "USER") {
    throw new AppError(403, "You don't have permission to view this analytics");
  }
}

function resolveRange(q: { from?: string; to?: string }) {
  const to = q.to ?? todayIst();
  const from = q.from ?? addDays(to, -29);
  return { from, to };
}

// Period comparison
async function periodTotals(scope: Repo.Scope, from: string, to: string) {
  const [trend, disb, earn, newCustomers] = await Promise.all([
    Repo.getCollectionsTrendRepo(scope, from, to, "month"),
    Repo.getDisbursementTrendRepo(scope, from, to, "month"),
    Repo.getEarningsTrendRepo(scope, from, to, "month"),
    Adv.getNewCustomersRepo(scope, from, to),
  ]);
  const sum = <T>(rows: T[], f: (r: T) => number) =>
    rows.reduce((s, r) => s + f(r), 0);
  const collected = sum(trend, (r) => r.collected);
  const target = sum(trend, (r) => r.target);
  return {
    collected,
    collection_rate_pct: pct(collected, target),
    disbursed: sum(disb, (r) => r.disbursed),
    loans_issued: sum(disb, (r) => r.loans),
    fees: sum(earn, (r) => r.fees),
    interest_earned: sum(earn, (r) => r.interest_earned),
    new_customers: newCustomers,
  };
}

type Unit = "INR" | "%" | "count";

function metric(
  key: string,
  label: string,
  unit: Unit,
  current: number | null,
  previous: number | null,
  higherIsBetter = true,
) {
  const c = current ?? 0;
  const p = previous ?? 0;
  const change = round1(c - p);
  // for rates the change is in percentage points, for amounts a % of previous
  const changePct = unit === "%" ? null : p > 0 ? round1(((c - p) / p) * 100) : null;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const good =
    direction === "flat" ? null : (direction === "up") === higherIsBetter;
  return {
    key,
    label,
    unit,
    current,
    previous,
    change,
    change_pct: changePct,
    direction,
    is_good: good,
  };
}

export async function getKpiCompare(user: RequestingUser, q: CompareQuery) {
  const scope = resolveScope(user, q);
  const { from, to } = resolveRange(q);
  const length = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(length - 1));

  const [cur, prev] = await Promise.all([
    periodTotals(scope, from, to),
    periodTotals(scope, prevFrom, prevTo),
  ]);

  return {
    current: { from, to },
    previous: { from: prevFrom, to: prevTo },
    days: length,
    metrics: [
      metric("collected", "Collected", "INR", cur.collected, prev.collected),
      metric("collection_rate", "Collection rate", "%", cur.collection_rate_pct, prev.collection_rate_pct),
      metric("disbursed", "Disbursed", "INR", cur.disbursed, prev.disbursed),
      metric("loans_issued", "Loans issued", "count", cur.loans_issued, prev.loans_issued),
      metric("interest_earned", "Interest earned", "INR", cur.interest_earned, prev.interest_earned),
      metric("fees", "Upfront fees", "INR", cur.fees, prev.fees),
      metric("new_customers", "New customers", "count", cur.new_customers, prev.new_customers),
    ],
  };
}

// Collection calendar (one month, per day)
export async function getCollectionCalendar(
  user: RequestingUser,
  q: CalendarQuery,
) {
  const today = todayIst();
  const month = q.month ?? today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;

  const rows = await Repo.getCollectionsTrendRepo(
    resolveScope(user, q),
    first,
    last,
    "day",
  );
  const byDate = new Map(rows.map((r) => [r.period, r]));

  const days = [];
  for (let i = 0; i < lastDay; i++) {
    const date = addDays(first, i);
    const r = byDate.get(date);
    const target = r?.target ?? 0;
    const collected = r?.collected ?? 0;
    days.push({
      date,
      weekday: WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()],
      is_future: date > today,
      target,
      collected,
      collection_rate_pct: pct(collected, target),
    });
  }

  const past = days.filter((d) => !d.is_future);
  const withTarget = past.filter((d) => d.target > 0);
  const best = [...past].sort((a, b) => b.collected - a.collected)[0];
  const worst = [...withTarget].sort(
    (a, b) => (a.collection_rate_pct ?? 0) - (b.collection_rate_pct ?? 0),
  )[0];
  const target = days.reduce((s, d) => s + d.target, 0);
  const collected = days.reduce((s, d) => s + d.collected, 0);

  return {
    month,
    // 1 = Monday ... 7 = Sunday; lets the client offset the first row of the grid
    first_weekday: ((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7) + 1,
    days,
    totals: { target, collected, collection_rate_pct: pct(collected, target) },
    best_day: best && best.collected > 0 ? best : null,
    worst_day: worst ?? null,
  };
}

// Cohorts (vintage curves)
export async function getCohorts(user: RequestingUser, q: CohortsQuery) {
  requireAdmin(user);
  const today = todayIst();
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - (q.months - 1), 1));
  const fromDate = start.toISOString().slice(0, 10);

  const { sizes, curve } = await Adv.getCohortsRepo(
    resolveScope(user, q),
    fromDate,
    q.weeks,
  );

  const curveBy = new Map<string, typeof curve>();
  for (const r of curve) {
    const list = curveBy.get(r.cohort) ?? [];
    list.push(r);
    curveBy.set(r.cohort, list);
  }

  return {
    from: fromDate,
    weeks: q.weeks,
    cohorts: sizes.map((s) => ({
      cohort: s.cohort.slice(0, 7),
      loans: s.loans,
      nominal: s.nominal,
      defaulted: s.defaulted,
      default_rate_pct: pct(s.defaulted, s.loans),
      curve: (curveBy.get(s.cohort) ?? []).map((r) => ({
        week: r.week,
        loans_observed: r.loans,
        // share of the full payable amount repaid by this week
        repaid_pct: pct(r.collected, r.payable),
        // repaid vs what the schedule says should be repaid by this week
        on_track_pct: pct(r.collected, r.expected),
      })),
    })),
  };
}

// Insights (rule-based callouts)
type Severity = "critical" | "warning" | "positive" | "info";

interface Insight {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  metric?: { label: string; value: number; unit: Unit };
  action?: { label: string; screen: string; params?: Record<string, unknown> };
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  positive: 2,
  info: 3,
};

const MAX_INSIGHTS = 8;

export async function getInsights(user: RequestingUser, q: InsightsQuery) {
  const scope = resolveScope(user, q);
  const today = todayIst();
  const weekStart = mondayOf(today);
  const elapsed = daysBetween(weekStart, today);
  const prevStart = addDays(weekStart, -7);
  const prevEnd = addDays(prevStart, elapsed);
  const last30From = addDays(today, -29);

  const wantEmployees = user.role !== "USER" && !q.employee_id;

  const [overview, thisWeek, lastWeek, aging, maturing, risk, weekdays, employees] =
    await Promise.all([
      Repo.getOverviewRepo(scope),
      Repo.getCollectionsTrendRepo(scope, weekStart, today, "month"),
      Repo.getCollectionsTrendRepo(scope, prevStart, prevEnd, "month"),
      Repo.getAgingRepo(scope),
      Repo.getMaturingLoansRepo(scope, 7, 1, 100),
      Repo.getCustomerRiskRepo(scope, 1, 10),
      Repo.getCollectionsByWeekdayRepo(scope, last30From, today),
      wantEmployees
        ? Repo.getEmployeePerformanceRepo(
            { owningAdminId: scope.owningAdminId },
            last30From,
            today,
            1,
            50,
          )
        : Promise.resolve({ rows: [], total: 0 }),
    ]);

  const out: Insight[] = [];
  const t = overview.totals;

  // 1. collection pace this week vs target to date and vs last week
  const target = thisWeek.reduce((s, r) => s + r.target, 0);
  const collected = thisWeek.reduce((s, r) => s + r.collected, 0);
  const prevTarget = lastWeek.reduce((s, r) => s + r.target, 0);
  const prevCollected = lastWeek.reduce((s, r) => s + r.collected, 0);
  const rate = pct(collected, target);
  if (rate !== null) {
    const prevRate = pct(prevCollected, prevTarget);
    const delta =
      prevRate === null ? "" : ` (${rate >= prevRate ? "+" : ""}${round1(rate - prevRate)} pts vs last week)`;
    const severity: Severity = rate < 60 ? "critical" : rate < 80 ? "warning" : rate >= 100 ? "positive" : "info";
    out.push({
      id: "collection_pace",
      severity,
      title:
        severity === "positive"
          ? `Ahead of target this week at ${rate}%`
          : `Collections are at ${rate}% of target this week`,
      detail: `${inr(collected)} collected of ${inr(target)} due so far${delta}.`,
      metric: { label: "Collection rate", value: rate, unit: "%" },
      action: { label: "View calendar", screen: "collection_calendar" },
    });
  }

  // 2. overdue loans and amount at risk
  if (t.overdue_loans > 0) {
    const parPct = pct(t.par_amount, t.total_outstanding) ?? 0;
    out.push({
      id: "overdue_loans",
      severity: parPct >= 20 ? "critical" : parPct >= 10 ? "warning" : "info",
      title: `${t.overdue_loans} ${t.overdue_loans === 1 ? "loan is" : "loans are"} overdue`,
      detail: `${inr(t.par_amount)} outstanding on past-due loans (${parPct}% of the book).`,
      metric: { label: "Overdue loans", value: t.overdue_loans, unit: "count" },
      action: { label: "See who is late", screen: "customer_risk" },
    });
  }

  // 3. deep arrears
  const totalOut = aging.reduce((s, r) => s + r.outstanding, 0);
  const deep = aging.filter((r) => r.bucket === "30+").reduce((s, r) => s + r.outstanding, 0);
  const deepPct = pct(deep, totalOut);
  if (deepPct !== null && deepPct >= 10) {
    out.push({
      id: "deep_arrears",
      severity: deepPct >= 25 ? "critical" : "warning",
      title: `${deepPct}% of outstanding is 30+ days late`,
      detail: `${inr(deep)} is more than 30 days past due and is the hardest to recover.`,
      metric: { label: "30+ days share", value: deepPct, unit: "%" },
      action: { label: "Open aging", screen: "portfolio_aging" },
    });
  }

  // 4. loans maturing in the next 7 days
  if (maturing.total > 0) {
    const listed = maturing.rows.reduce((s, r) => s + Number(r.outstanding ?? 0), 0);
    const complete = maturing.rows.length === maturing.total;
    out.push({
      id: "maturing_soon",
      severity: "info",
      title: `${maturing.total} ${maturing.total === 1 ? "loan matures" : "loans mature"} in 7 days`,
      detail: complete
        ? `${inr(listed)} is still to be collected before they close.`
        : "Plan the final collections before they reach maturity.",
      metric: { label: "Maturing loans", value: maturing.total, unit: "count" },
      action: { label: "View loans", screen: "maturing_loans", params: { days: 7 } },
    });
  }

  // 5. customers who keep missing payments
  const missers = risk.rows.filter((r) => Number(r.missed_weeks ?? 0) >= 2);
  if (missers.length > 0) {
    const names = missers.slice(0, 2).map((r) => String(r.customer_name));
    const more = missers.length - names.length;
    out.push({
      id: "missed_payments",
      severity: "warning",
      title: `${missers.length} ${missers.length === 1 ? "customer has" : "customers have"} missed 2+ weeks`,
      detail: `${names.join(", ")}${more > 0 ? ` and ${more} more` : ""} need a visit this week.`,
      metric: { label: "Customers", value: missers.length, unit: "count" },
      action: { label: "Open risk list", screen: "customer_risk" },
    });
  }

  // 6. team: weak and strong employees (admin / super admin, 30 days)
  if (wantEmployees) {
    const ranked = employees.rows
      .map((r) => ({
        id: String(r.employee_id),
        name: String(r.name),
        loans: Number(r.active_loans ?? 0) + Number(r.overdue_loans ?? 0),
        rate: pct(Number(r.on_schedule_collected ?? 0), Number(r.expected_to_date ?? 0)),
      }))
      .filter((e) => e.rate !== null && e.loans >= 3) as {
        id: string; name: string; loans: number; rate: number;
      }[];
    const weak = [...ranked].filter((e) => e.rate < 60).sort((a, b) => a.rate - b.rate)[0];
    const strong = [...ranked].filter((e) => e.rate >= 90).sort((a, b) => b.rate - a.rate)[0];
    if (weak) {
      out.push({
        id: "weak_employee",
        severity: "warning",
        title: `${weak.name} is collecting ${weak.rate}% of schedule`,
        detail: `Across ${weak.loans} live loans over the last 30 days. Worth a check-in.`,
        metric: { label: "Collection rate", value: weak.rate, unit: "%" },
        action: { label: "Open employee", screen: "employee_detail", params: { employee_id: weak.id } },
      });
    }
    if (strong) {
      out.push({
        id: "top_employee",
        severity: "positive",
        title: `${strong.name} leads at ${strong.rate}% of schedule`,
        detail: `Best collection rate in the team over the last 30 days.`,
        metric: { label: "Collection rate", value: strong.rate, unit: "%" },
        action: { label: "Open employee", screen: "employee_detail", params: { employee_id: strong.id } },
      });
    }
  }

  // 7. strongest collection day (last 30 days)
  const bestDay = [...weekdays].filter((d) => d.collected > 0).sort((a, b) => b.collected - a.collected)[0];
  if (bestDay) {
    out.push({
      id: "best_weekday",
      severity: "info",
      title: `${bestDay.weekday.charAt(0)}${bestDay.weekday.slice(1).toLowerCase()} brings in the most`,
      detail: `${inr(bestDay.collected)} collected on ${bestDay.weekday.toLowerCase()}s over the last 30 days.`,
      metric: { label: "Collected", value: bestDay.collected, unit: "INR" },
      action: { label: "See weekdays", screen: "collections_by_weekday" },
    });
  }

  out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return { as_of: today, insights: out.slice(0, MAX_INSIGHTS) };
}