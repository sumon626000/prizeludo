import { db } from "../db/client.js";
import { adminAuditLogs } from "../db/schema.js";

interface AuditInput {
  actorId: string;
  action: string;
  ipAddress: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

export async function writeAdminAudit(input: AuditInput): Promise<void> {
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: input.action,
    ipAddress: input.ipAddress,
    targetType: input.targetType,
    targetId: input.targetId,
    details: input.details ?? {},
  });
}
