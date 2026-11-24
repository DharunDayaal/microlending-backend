import { UserRole } from "../../modules/auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        teamId: string;
      }
    }
  }
}