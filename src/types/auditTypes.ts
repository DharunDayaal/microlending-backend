import type {
  AuditAction,
  AuditEntity,
  AuditModule,
} from "../constants/auditActions";

/** What every module passes to recordAudit(). */
export interface AuditEntry {
  action: AuditAction;
  /** who did it; null for system jobs or a failed login */
  actor_id: string | null;
  /** the user account affected, when there is one */
  target_id?: string | null;
  /** the record that changed (loan, customer, payment...). Users are filled in for you. */
  entity_type?: AuditEntity;
  entity_id?: string | null;
  /** team the change belongs to. Pass it for loans/customers/payments.
   *  Left empty it is derived from the target or actor user. */
  owning_admin_id?: string | null;
  /** only the fields that changed (see changedValues) */
  old_value?: unknown;
  new_value?: unknown;
  /** ip, user_agent, request_id, reason... never secrets */
  meta?: Record<string, unknown>;
}

export interface AuditLogRow {
  id: string;
  created_at: string;
  action: string;
  module: AuditModule | null;
  entity_type: string | null;
  entity_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  target_id: string | null;
  target_name: string | null;
  owning_admin_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

export interface AuditLogItem extends Omit<
  AuditLogRow,
  "actor_id" | "actor_name" | "actor_role" | "target_id" | "target_name"
> {
  actor: { id: string | null; name: string | null; role: string | null } | null;
  target: { id: string; name: string | null } | null;
  /** keys whose value differs between old_value and new_value */
  changed_fields: string[];
}

export interface AuditListFilters {
  owningAdminId?: string;
  actions?: string[];
  module?: string;
  actorId?: string;
  targetId?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
  limit: number;
}
