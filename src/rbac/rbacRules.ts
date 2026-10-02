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
    roles: ["ADMIN", "SUPER_ADMIN"],
  },
  {
    method: "GET",
    path: "/api/users/loans/:userId",
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
  const rule = rbacRules.find(
    (rule) => rule.method === method && matchPath(rule.path, path),
  );

  return rule?.roles ?? null;
}
