import { UserRole } from "./authTypes";

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