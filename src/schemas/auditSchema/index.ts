import { z } from "zod";
import { AUDIT_ENTITIES, AUDIT_MODULES } from "../../constants/auditActions";

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const listAuditLogsQuerySchema = z
  .object({
    // one action or a comma separated list: LOAN_CREATED,LOAN_STATUS_CHANGED
    action: z
      .string()
      .trim()
      .min(1)
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      )
      .pipe(
        z
          .array(z.string().regex(/^[A-Z_]+$/))
          .min(1)
          .max(20),
      )
      .optional(),
    module: z.enum(AUDIT_MODULES).optional(),
    actor_id: uuid.optional(),
    target_id: uuid.optional(),
    entity_type: z.enum(AUDIT_ENTITIES).optional(),
    entity_id: uuid.optional(),
    admin_id: uuid.optional(), // SUPER_ADMIN only; ignored for ADMIN
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  })
  .refine(
    (v) => {
      if (!v.from || !v.to) return true;
      const a = Date.parse(v.from);
      const b = Date.parse(v.to);
      return (
        !Number.isNaN(a) &&
        !Number.isNaN(b) &&
        a <= b &&
        (b - a) / 86_400_000 <= 366
      );
    },
    { message: "`from` must be on or before `to`, within 366 days" },
  );

export const actionsQuerySchema = z.object({
  module: z.enum(AUDIT_MODULES).optional(),
  admin_id: uuid.optional(), // SUPER_ADMIN only
});

export const auditIdParamSchema = z.uuid();

export type ListAuditLogsQuerySchema = z.infer<typeof listAuditLogsQuerySchema>;
export type ActionsQuerySchema = z.infer<typeof actionsQuerySchema>;
