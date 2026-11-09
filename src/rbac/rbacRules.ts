import { UserRole } from "../types/authTypes";

export type RBACRule = {
  method: "POST" | "GET" | "PATCH" | "DELETE";
  path: string;
  roles: UserRole[];
};

export type RBACPublicRule = Omit<RBACRule, "roles">;

export const publicRoutes: RBACPublicRule[] = [
  { method: "POST", path: "/api/auth/register" },
  { method: "POST", path: "/api/auth/login/email" },
  { method: "POST", path: "/api/auth/login/phone" },
  { method: "POST", path: "/api/auth/password/reset" },
  { method: "POST", path: "/api/auth/otp/request" },
  { method: "POST", path: "/api/auth/otp/verify" },
  { method: "POST", path: "/api/auth/refresh" },
] as const;

const ALL = ["SUPER_ADMIN", "ADMIN", "USER"] as const;
const ADMINS = ["SUPER_ADMIN", "ADMIN"] as const;
const SUPER = ["SUPER_ADMIN"] as const;

const rbacRules: RBACRule[] = [
  // Auth routes
  {
    method: "POST",
    path: "/api/auth/logout",
    roles: [...ALL],
  },

  // Admin routes
  { method: "POST", path: "/api/admin/pending", roles: [...SUPER] },
  {
    method: "POST",
    path: "/api/admin/:adminId/verify",
    roles: [...SUPER],
  },
  {
    method: "POST",
    path: "/api/admin/:adminId/deactivate",
    roles: [...SUPER],
  },

  // Loan routes
  {
    method: "GET",
    path: "/api/loans/details/:loanId",
    roles: [...ALL],
  },
  {
    method: "POST",
    path: "/api/loans/issue",
    roles: [...ALL],
  },
  {
    method: "POST",
    path: "/api/loans/collect/payment/:loanId",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/loans/list",
    roles: [...ALL],
  },
  {
    method: "PATCH",
    path: "/api/loans/update/status/:loanId",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/loans/collections/due",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/loans/payments/:loanId",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/loans/today-summary",
    roles: [...ALL],
  },

  // Users/Customers routes
  {
    method: "POST",
    path: "/api/users/create",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/users/weekday",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/users/:id",
    roles: [...ALL],
  },
  {
    method: "PATCH",
    path: "/api/users/update/:id",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/users/referrals/:userId",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/users/loans/:userId",
    roles: [...ALL],
  },
  {
    method: "GET",
    path: "/api/users/list",
    roles: [...ALL],
  },

  // Reports routes
  {
    method: "GET",
    path: "/api/reports/cash-outstanding",
    roles: [...ADMINS],
  },
  {
    method: "GET",
    path: "/api/reports/earnings",
    roles: [...ADMINS],
  },
  {
    method: "GET",
    path: "/api/reports/overdue",
    roles: [...ADMINS],
  },
];

const u = (p: string): RBACRule => ({
  method: "GET",
  path: `/api/analytics/user/${p}`,
  roles: [...ALL],
});
const a = (p: string): RBACRule => ({
  method: "GET",
  path: `/api/analytics/admin/${p}`,
  roles: [...ADMINS],
});
const s = (p: string): RBACRule => ({
  method: "GET",
  path: `/api/analytics/super-admin/${p}`,
  roles: [...SUPER],
});

const analyticsRbacRules: RBACRule[] = [
  u("overview"),
  u("collections/trend"),
  u("collections/by-weekday"),
  u("portfolio/aging"),
  u("customers/risk"),
  u("forecast/next-weeks"),
  u("loans/maturing"),
  u("referrals"),

  a("overview"),
  a("collections/trend"),
  a("collections/by-weekday"),
  a("portfolio/aging"),
  a("portfolio/status"),
  a("disbursements/trend"),
  a("earnings/trend"),
  a("forecast/cashflow"),
  a("loans/maturing"),
  a("payments/behaviour"),
  a("customers/risk"),
  a("customers/repeat"),
  a("referrals/performance"),
  a("geography"),
  a("employees/performance"),
  a("employees/:employeeId/summary"),

  s("overview"),
  s("admins/performance"),
  s("admins/growth"),
  s("collections/trend"),
  s("earnings/trend"),
  s("portfolio/aging"),
  s("risk/concentration"),
  s("employees/leaderboard"),
  s("geography"),
  s("accounts/summary"),
  s("forecast/cashflow"),
];

const profileRbacRules: RBACRule[] = [
  { method: "GET", path: "/api/me", roles: [...ALL] },
  { method: "PATCH", path: "/api/me", roles: [...ALL] },
  { method: "POST", path: "/api/me/phone", roles: [...ALL] },
  { method: "POST", path: "/api/me/password", roles: [...ALL] },
  { method: "GET", path: "/api/me/sessions", roles: [...ALL] },
  { method: "DELETE", path: "/api/me/sessions", roles: [...ALL] },
  { method: "DELETE", path: "/api/me/sessions/:id", roles: [...ALL] },
  { method: "GET", path: "/api/me/stats", roles: [...ALL] }, // scope checked in service
  { method: "PATCH", path: "/api/me/defaults", roles: [...ADMINS] },
  { method: "GET", path: "/api/me/team", roles: [...ADMINS] },

  { method: "GET", path: "/api/admins", roles: [...SUPER] },
  { method: "PATCH", path: "/api/admins/:id/verification", roles: [...SUPER] },
  { method: "PATCH", path: "/api/admins/:id/active", roles: [...SUPER] },

  { method: "GET", path: "/api/settings/limits", roles: [...ALL] },
  { method: "PATCH", path: "/api/settings/limits", roles: [...SUPER] },
];

const employeeRbacRules = [
  { method: "POST", path: "/api/employees", roles: [...ADMINS] },
  { method: "GET", path: "/api/employees", roles: [...ADMINS] },
  { method: "GET", path: "/api/employees/:id", roles: [...ADMINS] },
  {
    method: "PATCH",
    path: "/api/employees/:id/verification",
    roles: [...ADMINS],
  },
  { method: "PATCH", path: "/api/employees/:id/active", roles: [...ADMINS] },
];

const analyticsAdvancedRbacRules = [
  { method: "GET", path: "/api/analytics/user/kpis/compare", roles: [...ALL] },
  { method: "GET", path: "/api/analytics/user/insights", roles: [...ALL] },
  {
    method: "GET",
    path: "/api/analytics/user/collections/calendar",
    roles: [...ALL],
  },

  {
    method: "GET",
    path: "/api/analytics/admin/kpis/compare",
    roles: [...ADMINS],
  },
  { method: "GET", path: "/api/analytics/admin/insights", roles: [...ADMINS] },
  {
    method: "GET",
    path: "/api/analytics/admin/collections/calendar",
    roles: [...ADMINS],
  },
  { method: "GET", path: "/api/analytics/admin/cohorts", roles: [...ADMINS] },
];

export const auditRbacRules = [
  { method: "GET", path: "/api/audit-logs", roles: [...ADMINS] },
  { method: "GET", path: "/api/audit-logs/actions", roles: [...ADMINS] },
  { method: "GET", path: "/api/audit-logs/:id", roles: [...ADMINS] },
];

function matchPath(pattern: string, actual: string): boolean {
  if (pattern === actual) return true;

  const patternSegments = pattern.split("/");
  const actualSegments = actual.split("/");

  if (patternSegments.length !== actualSegments.length) return false;

  return patternSegments.every(
    (segment, idx) =>
      segment.startsWith(":") || segment === actualSegments[idx],
  );
}

export const isPublicRoute = (method: string, path: string): boolean => {
  return publicRoutes.some(
    (route) => route.method === method && matchPath(route.path, path),
  );
};

export function getAllowedRoles(
  method: string,
  path: string,
): UserRole[] | null {
  const rule = [
    ...rbacRules,
    ...analyticsRbacRules,
    ...profileRbacRules,
    ...employeeRbacRules,
    ...analyticsAdvancedRbacRules,
    ...auditRbacRules,
  ].find((rule) => rule.method === method && matchPath(rule.path, path));

  return rule?.roles ?? null;
}
