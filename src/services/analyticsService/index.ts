import { AppError } from "../../helpers";
import * as Repo from "../../repositories/analyticsRepo";
import { RequestingUser } from "../../types/authTypes";
import type {
  EmployeesQuery,
  ForecastQuery,
  GeographyQuery,
  LimitQuery,
  MaturingQuery,
  PagedQuery,
  RangeQuery,
  ScopeQuery,
  SuperForecastQuery,
  SuperGeographyQuery,
  SuperLeaderboardQuery,
  SuperLimitQuery,
  SuperRangeQuery,
  SuperSplitTrendQuery,
  SuperTrendQuery,
  TrendQuery,
} from "../../schemas/analyticsSchema";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number): number | null =>
  den > 0 ? round1((num / den) * 100) : null;

function requireAdmin(user: RequestingUser): void {
  if (user.role === "USER") {
    throw new AppError(403, "You don't have permission to view this analytics");
  }
}

function requireSuperAdmin(user: RequestingUser): void {
  if (user.role !== "SUPER_ADMIN") {
    throw new AppError(403, "You don't have permission to view this analytics");
  }
}

/**
 * USER        -> own customers only
 * ADMIN       -> own team (optionally one employee)
 * SUPER_ADMIN -> everything, or one team via admin_id (optionally one employee)
 */
export function resolveScope(
  user: RequestingUser,
  q: ScopeQuery = {},
): Repo.Scope {
  switch (user.role) {
    case "USER":
      return { owningAdminId: user.teamId, createdBy: user.id };
    case "ADMIN":
      return { owningAdminId: user.teamId, createdBy: q.employee_id };
    default:
      return { owningAdminId: q.admin_id, createdBy: q.employee_id };
  }
}

const todayIst = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Defaults to the last 30 days (IST). */
function resolveRange(q: { from?: string; to?: string }) {
  const to = q.to ?? todayIst();
  const from = q.from ?? addDays(to, -29);
  return { from, to };
}

const AGING_ORDER = ["CURRENT", "1-7", "8-14", "15-30", "30+"];
const STATUS_ORDER = ["ACTIVE", "OVERDUE", "DEFAULTED", "PAID_OFF", "CLOSED"];

function paginationMetadata(page: number, limit: number, total: number) {
  return {
    current_page: page,
    limit,
    has_next_page: page * limit < total,
  };
}

function fillAging(
  rows: { bucket: string; loans: number; outstanding: number }[],
) {
  const total = rows.reduce((s, r) => s + r.outstanding, 0);
  return AGING_ORDER.map((bucket) => {
    const found = rows.find((r) => r.bucket === bucket);
    const outstanding = found?.outstanding ?? 0;
    return {
      bucket,
      loans: found?.loans ?? 0,
      outstanding,
      share_pct: pct(outstanding, total),
    };
  });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

async function buildOverview(scope: Repo.Scope) {
  const o = await Repo.getOverviewRepo(scope);
  const t = o.totals;
  return {
    as_of: todayIst(),
    customers: {
      total: o.total_customers,
      active_borrowers: t.active_borrowers,
    },
    loans: {
      active: t.active_loans,
      overdue: t.overdue_loans,
      defaulted: t.defaulted_loans,
      paid_off: t.paid_off_loans,
      closed: t.closed_loans,
    },
    money: {
      total_nominal: t.total_nominal,
      total_disbursed: t.total_disbursed,
      total_collected: t.total_collected,
      total_outstanding: t.total_outstanding,
      par_amount: t.par_amount,
      avg_ticket: Math.round(t.avg_ticket),
    },
    rates: {
      // collected vs what should have been collected by today (capped per loan)
      collection_rate_pct: pct(t.on_schedule_collected, t.expected_to_date),
      // outstanding on loans past due / total outstanding
      par_pct: pct(t.par_amount, t.total_outstanding),
    },
    collected: {
      today: o.collected_today,
      this_week: o.collected_week,
      this_month: o.collected_month,
    },
  };
}

export async function getOverview(user: RequestingUser, q: ScopeQuery) {
  return buildOverview(resolveScope(user, q));
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

function summarizeTrend<T extends { target: number; collected: number }>(
  rows: T[],
) {
  const target = rows.reduce((s, r) => s + r.target, 0);
  const collected = rows.reduce((s, r) => s + r.collected, 0);
  return {
    totals: { target, collected, collection_rate_pct: pct(collected, target) },
    series: rows.map((r) => ({
      ...r,
      collection_rate_pct: pct(r.collected, r.target),
    })),
  };
}

export async function getCollectionsTrend(user: RequestingUser, q: TrendQuery) {
  const { from, to } = resolveRange(q);
  const rows = await Repo.getCollectionsTrendRepo(
    resolveScope(user, q),
    from,
    to,
    q.group_by,
  );
  return {
    from,
    to,
    group_by: q.group_by,
    ...summarizeTrend(
      rows.map(({ period, target, collected }) => ({
        period,
        target,
        collected,
      })),
    ),
  };
}

export async function getCollectionsByWeekday(
  user: RequestingUser,
  q: RangeQuery,
) {
  const { from, to } = resolveRange(q);
  const rows = await Repo.getCollectionsByWeekdayRepo(
    resolveScope(user, q),
    from,
    to,
  );
  return {
    from,
    to,
    weekdays: rows.map((r) => ({
      ...r,
      pending: Math.max(r.target - r.collected, 0),
      collection_rate_pct: pct(r.collected, r.target),
    })),
  };
}

export async function getAging(user: RequestingUser, q: ScopeQuery) {
  const rows = await Repo.getAgingRepo(resolveScope(user, q));
  return { buckets: fillAging(rows) };
}

export async function getStatusBreakdown(user: RequestingUser, q: ScopeQuery) {
  requireAdmin(user);
  const rows = await Repo.getStatusBreakdownRepo(resolveScope(user, q));
  return {
    statuses: STATUS_ORDER.map((status) => {
      const f = rows.find((r) => r.status === status);
      return {
        status,
        loans: f?.loans ?? 0,
        nominal: f?.nominal ?? 0,
        collected: f?.collected ?? 0,
        outstanding: f?.outstanding ?? 0,
      };
    }),
  };
}

export async function getDisbursementTrend(user: RequestingUser, q: TrendQuery) {
  requireAdmin(user);
  const { from, to } = resolveRange(q);
  const series = await Repo.getDisbursementTrendRepo(
    resolveScope(user, q),
    from,
    to,
    q.group_by,
  );
  return {
    from,
    to,
    group_by: q.group_by,
    totals: {
      loans: series.reduce((s, r) => s + r.loans, 0),
      nominal: series.reduce((s, r) => s + r.nominal, 0),
      disbursed: series.reduce((s, r) => s + r.disbursed, 0),
    },
    series,
  };
}

function shapeEarnings<
  T extends { fees: number; interest_earned: number; interest_expected: number },
>(rows: T[]) {
  const fees = rows.reduce((s, r) => s + r.fees, 0);
  const interest = rows.reduce((s, r) => s + r.interest_earned, 0);
  const expected = rows.reduce((s, r) => s + r.interest_expected, 0);
  return {
    totals: {
      fees_earned: fees,
      interest_earned: interest,
      interest_expected: expected,
      total_earned: fees + interest,
    },
    series: rows.map((r) => ({
      ...r,
      total_earned: r.fees + r.interest_earned,
    })),
  };
}

export async function getEarningsTrend(user: RequestingUser, q: TrendQuery) {
  requireAdmin(user);
  const { from, to } = resolveRange(q);
  const rows = await Repo.getEarningsTrendRepo(
    resolveScope(user, { admin_id: q.admin_id }),
    from,
    to,
    q.group_by,
  );
  return {
    from,
    to,
    group_by: q.group_by,
    ...shapeEarnings(
      rows.map(({ period, fees, interest_earned, interest_expected }) => ({
        period,
        fees,
        interest_earned,
        interest_expected,
      })),
    ),
  };
}

// ---------------------------------------------------------------------------
// Forecast / maturing
// ---------------------------------------------------------------------------

async function buildForecast(scope: Repo.Scope, weeks: number) {
  const f = await Repo.getForecastRepo(scope, weeks);
  const start = addDays(todayIst(), 1);
  const series = Array.from({ length: weeks }, (_, i) => ({
    week_start: addDays(start, i * 7),
    week_end: addDays(start, i * 7 + 6),
    expected: f.weeks.find((w) => w.week_index === i)?.expected ?? 0,
  }));
  return {
    assumption:
      "Assumes every remaining weekly instalment is paid on time, capped at each loan's outstanding balance.",
    arrears_due_now: f.arrears_due_now,
    total_expected: series.reduce((s, r) => s + r.expected, 0),
    series,
  };
}

export async function getForecast(user: RequestingUser, q: ForecastQuery) {
  return buildForecast(resolveScope(user, q), q.weeks);
}

export async function getMaturing(user: RequestingUser, q: MaturingQuery) {
  const { rows, total } = await Repo.getMaturingLoansRepo(
    resolveScope(user, q),
    q.days,
    q.page,
    q.limit,
  );
  return {
    rows,
    metadata: paginationMetadata(q.page, q.limit, total),
  };
}

// ---------------------------------------------------------------------------
// Behaviour / customers
// ---------------------------------------------------------------------------

export async function getPaymentBehaviour(user: RequestingUser, q: RangeQuery) {
  requireAdmin(user);
  const { from, to } = resolveRange(q);
  const { timing, outcomes } = await Repo.getPaymentBehaviourRepo(
    resolveScope(user, q),
    from,
    to,
  );
  return {
    from,
    to,
    payments: {
      count: timing.payments,
      collected: timing.collected,
      on_time_pct: pct(timing.on_time, timing.payments),
      late_pct: pct(timing.late, timing.payments),
      avg_days_late: round1(timing.avg_days_late),
      max_days_late: timing.max_days_late,
    },
    weekly_instalments: {
      due_weeks: outcomes.weeks,
      paid_pct: pct(outcomes.paid, outcomes.weeks),
      partial_pct: pct(outcomes.partial, outcomes.weeks),
      unpaid_pct: pct(outcomes.unpaid, outcomes.weeks),
      overpaid_pct: pct(outcomes.overpaid, outcomes.weeks),
    },
  };
}

export async function getCustomerRisk(user: RequestingUser, q: PagedQuery) {
  const { rows, total } = await Repo.getCustomerRiskRepo(
    resolveScope(user, q),
    q.page,
    q.limit,
  );
  return {
    rows,
    metadata: paginationMetadata(q.page, q.limit, total),
  };
}

export async function getRepeatBorrowers(user: RequestingUser, q: ScopeQuery) {
  requireAdmin(user);
  const r = await Repo.getRepeatBorrowersRepo(resolveScope(user, q));
  return {
    customers_with_loans: r.customers_with_loans,
    repeat_customers: r.repeat_customers,
    repeat_rate_pct: pct(r.repeat_customers, r.customers_with_loans),
    avg_loans_per_customer: round1(r.avg_loans),
    retention_rate_pct: pct(r.returned_customers, r.completed_customers),
    loans_per_customer: [
      { loans: "1", customers: r.c1 },
      { loans: "2", customers: r.c2 },
      { loans: "3", customers: r.c3 },
      { loans: "4+", customers: r.c4 },
    ],
  };
}

export async function getReferralPerformance(
  user: RequestingUser,
  q: LimitQuery,
) {
  const rows = await Repo.getReferralPerformanceRepo(
    resolveScope(user, q),
    q.limit,
  );
  return {
    referrers: rows.map((r) => ({
      ...r,
      conversion_pct: pct(r.converted, r.referred),
    })),
  };
}

export async function getGeography(user: RequestingUser, q: GeographyQuery) {
  requireAdmin(user);
  const rows = await Repo.getGeographyRepo(resolveScope(user, q), q.level);
  return {
    level: q.level,
    areas: rows.map((r) => ({
      ...r,
      overdue_pct: pct(r.overdue_loans, r.active_loans),
      par_pct: pct(r.par_amount, r.outstanding),
    })),
  };
}

// ---------------------------------------------------------------------------
// Employees (admin level)
// ---------------------------------------------------------------------------

function shapeEmployeeRow(r: Record<string, any>) {
  return {
    employee_id: r.employee_id,
    name: r.name,
    admin_id: r.admin_id,
    admin_name: r.admin_name,
    customers: r.customers,
    loans: r.loans,
    active_loans: r.active_loans,
    overdue_loans: r.overdue_loans,
    outstanding: r.outstanding,
    collected_in_range: r.collected_in_range,
    overdue_rate_pct: pct(r.overdue_loans, r.active_loans + r.overdue_loans),
    collection_rate_pct: pct(r.on_schedule_collected, r.expected_to_date),
    par_pct: pct(r.par_amount, r.outstanding),
  };
}

export async function getEmployeePerformance(
  user: RequestingUser,
  q: EmployeesQuery,
) {
  requireAdmin(user);
  const { from, to } = resolveRange(q);
  const scope = resolveScope(user, q);
  const { rows, total } = await Repo.getEmployeePerformanceRepo(
    { owningAdminId: scope.owningAdminId },
    from,
    to,
    q.page,
    q.limit,
  );
  return {
    from,
    to,
    metadata: paginationMetadata(q.page, q.limit, total),
    employees: rows.map(shapeEmployeeRow),
  };
}

export async function getEmployeeSummary(
  user: RequestingUser,
  employeeId: string,
  q: RangeQuery,
) {
  requireAdmin(user);
  const employee = await Repo.findEmployeeRepo(employeeId);
  if (!employee) throw new AppError(404, "Employee not found");
  if (user.role === "ADMIN" && employee.admin_id !== user.teamId) {
    throw new AppError(403, "You don't have access to this employee");
  }

  const { from, to } = resolveRange(q);
  const scope: Repo.Scope = {
    owningAdminId: employee.admin_id ?? undefined,
    createdBy: employee.id,
  };

  const [overview, trend, aging, risk] = await Promise.all([
    buildOverview(scope),
    Repo.getCollectionsTrendRepo(scope, from, to, "week"),
    Repo.getAgingRepo(scope),
    Repo.getCustomerRiskRepo(scope, 1, 5),
  ]);

  return {
    employee: { id: employee.id, name: employee.name },
    from,
    to,
    overview,
    collections_trend: {
      group_by: "week",
      ...summarizeTrend(
        trend.map(({ period, target, collected }) => ({
          period,
          target,
          collected,
        })),
      ),
    },
    aging: fillAging(aging),
    top_risky_customers: risk.rows,
  };
}

// ---------------------------------------------------------------------------
// Super admin
// ---------------------------------------------------------------------------

export async function getPlatformOverview(user: RequestingUser) {
  requireSuperAdmin(user);
  const [overview, counts, earnings] = await Promise.all([
    buildOverview({}),
    Repo.getPlatformCountsRepo(),
    Repo.getEarningsTrendRepo(
      {},
      "2000-01-01",
      todayIst(),
      "month",
    ),
  ]);
  const e = shapeEarnings(earnings).totals;
  return { ...overview, accounts: counts, earnings: e };
}

export async function getAdminsPerformance(
  user: RequestingUser,
  q: SuperRangeQuery,
) {
  requireSuperAdmin(user);
  const { from, to } = resolveRange(q);
  const rows = await Repo.getAdminsPerformanceRepo(from, to);
  return {
    from,
    to,
    admins: rows.map((r: any) => ({
      admin_id: r.admin_id,
      name: r.name,
      customers: r.customers,
      employees: r.employees,
      loans: r.loans,
      active_loans: r.active_loans,
      overdue_loans: r.overdue_loans,
      defaulted_loans: r.defaulted_loans,
      disbursed_in_range: r.disbursed_in_range,
      collected_in_range: r.collected_in_range,
      fees_in_range: r.fees_in_range,
      outstanding: r.outstanding,
      collection_rate_pct: pct(r.on_schedule_collected, r.expected_to_date),
      par_pct: pct(r.par_amount, r.outstanding),
    })),
  };
}

export async function getAdminsGrowth(
  user: RequestingUser,
  q: SuperTrendQuery,
) {
  requireSuperAdmin(user);
  const { from, to } = resolveRange(q);
  const series = await Repo.getAdminsGrowthRepo(from, to, q.group_by);
  return { from, to, group_by: q.group_by, series };
}

export async function getPlatformCollectionsTrend(
  user: RequestingUser,
  q: SuperSplitTrendQuery,
) {
  requireSuperAdmin(user);
  const { from, to } = resolveRange(q);
  const rows = await Repo.getCollectionsTrendRepo(
    {},
    from,
    to,
    q.group_by,
    q.split_by_admin,
  );
  const shaped = summarizeTrend(rows);
  return { from, to, group_by: q.group_by, split_by_admin: q.split_by_admin, ...shaped };
}

export async function getPlatformEarningsTrend(
  user: RequestingUser,
  q: SuperSplitTrendQuery,
) {
  requireSuperAdmin(user);
  const { from, to } = resolveRange(q);
  const rows = await Repo.getEarningsTrendRepo(
    {},
    from,
    to,
    q.group_by,
    q.split_by_admin,
  );
  return {
    from,
    to,
    group_by: q.group_by,
    split_by_admin: q.split_by_admin,
    ...shapeEarnings(rows),
  };
}

export async function getPlatformAging(user: RequestingUser) {
  requireSuperAdmin(user);
  const [platform, perAdmin] = await Promise.all([
    Repo.getAgingRepo({}),
    Repo.getAgingRepo({}, true),
  ]);
  const adminIds = [
    ...new Set(perAdmin.map((r) => r.admin_id).filter(Boolean)),
  ] as string[];
  return {
    platform: fillAging(platform),
    by_admin: adminIds.map((id) => ({
      admin_id: id,
      buckets: fillAging(perAdmin.filter((r) => r.admin_id === id)),
    })),
  };
}

export async function getRiskConcentration(
  user: RequestingUser,
  q: SuperLimitQuery,
) {
  requireSuperAdmin(user);
  const r = await Repo.getRiskConcentrationRepo(q.limit);
  const total = r.by_admin.reduce((s, a: any) => s + a.outstanding, 0);
  return {
    total_outstanding: total,
    by_admin: r.by_admin.map((a: any) => ({
      ...a,
      share_pct: pct(a.outstanding, total),
      par_pct: pct(a.par_amount, a.outstanding),
    })),
    top_exposures: r.top_exposures.map((e: any) => ({
      ...e,
      share_pct: pct(e.outstanding, total),
    })),
  };
}

export async function getEmployeeLeaderboard(
  user: RequestingUser,
  q: SuperLeaderboardQuery,
) {
  requireSuperAdmin(user);
  const { from, to } = resolveRange(q);
  const { rows, total } = await Repo.getEmployeePerformanceRepo(
    {},
    from,
    to,
    q.page,
    q.limit,
  );
  return {
    from,
    to,
    metadata: paginationMetadata(q.page, q.limit, total),
    employees: rows.map(shapeEmployeeRow),
  };
}

export async function getPlatformGeography(
  user: RequestingUser,
  q: SuperGeographyQuery,
) {
  requireSuperAdmin(user);
  const rows = await Repo.getGeographyRepo({}, q.level);
  return {
    level: q.level,
    areas: rows.map((r) => ({
      ...r,
      overdue_pct: pct(r.overdue_loans, r.active_loans),
      par_pct: pct(r.par_amount, r.outstanding),
    })),
  };
}

export async function getAccountsSummary(user: RequestingUser) {
  requireSuperAdmin(user);
  return Repo.getAccountsSummaryRepo();
}

export async function getPlatformForecast(
  user: RequestingUser,
  q: SuperForecastQuery,
) {
  requireSuperAdmin(user);
  return buildForecast({ owningAdminId: q.admin_id }, q.weeks);
}