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

const rbacRules: RBACRule[] = [
  // Auth routes
  {
    method: "POST",
    path: "/api/auth/create-employee",
    roles: ["ADMIN"],
  },
  {
    method: "POST",
    path: "/api/auth/logout",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },

  // Admin routes
  { method: "POST", path: "/api/admin/pending", roles: ["SUPER_ADMIN"] },
  {
    method: "POST",
    path: "/api/admin/:adminId/verify",
    roles: ["SUPER_ADMIN"],
  },
  {
    method: "POST",
    path: "/api/admin/:adminId/deactivate",
    roles: ["SUPER_ADMIN"],
  },

  // Loan routes
  {
    method: "GET",
    path: "/api/loans/details/:loanId",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "POST",
    path: "/api/loans/issue",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "POST",
    path: "/api/loans/collect/payment/:loanId",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/loans/list",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "PATCH",
    path: "/api/loans/update/status/:loanId",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/loans/collections/due",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/loans/payments/:loanId",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/loans/today-summary",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },

  // Users/Customers routes
  {
    method: "POST",
    path: "/api/users/create",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/users/weekday",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/users/:id",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "PATCH",
    path: "/api/users/update/:id",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/users/referrals/:userId",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/users/loans/:userId",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/users/list",
    roles: ["USER", "ADMIN", "SUPER_ADMIN"],
  },

  // Reports routes
  {
    method: "GET",
    path: "/api/reports/cash-outstanding",
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/reports/earnings",
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/reports/overdue",
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
];

// Analytics RBAC rules
const ALL = ["SUPER_ADMIN", "ADMIN", "USER"] as const;
const ADMINS = ["SUPER_ADMIN", "ADMIN"] as const;
const SUPER = ["SUPER_ADMIN"] as const;

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

export const analyticsRbacRules: RBACRule[] = [
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

export const profileRbacRules: RBACRule[] = [
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
  const rule = [...rbacRules, ...analyticsRbacRules, ...profileRbacRules].find(
    (rule) => rule.method === method && matchPath(rule.path, path),
  );

  return rule?.roles ?? null;
}
