import "server-only";
import { getDb, type Tx } from "@/db/client";
import { auditEvent } from "@/db/schema";

export interface AuditInput {
  actorType: "user" | "system" | "respondent";
  actorUserId?: string | null;
  shopId?: string | null;
  action: string;
  subjectType: string;
  subjectId: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/**
 * Append an audit event. Pass the surrounding transaction so the audit row
 * commits or rolls back together with the change it describes.
 * Never include secrets or tokens in `before`/`after`.
 */
export async function recordAudit(input: AuditInput, tx?: Tx): Promise<void> {
  await (tx ?? getDb()).insert(auditEvent).values({
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    shopId: input.shopId ?? null,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    before: input.before ?? null,
    after: input.after ?? null,
    requestId: input.requestId ?? null,
  });
}
