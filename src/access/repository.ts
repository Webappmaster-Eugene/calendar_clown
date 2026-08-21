import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { accessRequests } from "../db/schema.js";
import { isDatabaseAvailable } from "../db/connection.js";
import { createLogger } from "../utils/logger.js";
import type { AccessRequestDto, AccessRequestStatus } from "../shared/types.js";

const log = createLogger("access-requests");

function toDto(row: typeof accessRequests.$inferSelect): AccessRequestDto {
  return {
    id: row.id,
    telegramId: Number(row.telegramId),
    username: row.username,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status as AccessRequestStatus,
    decidedBy: row.decidedBy != null ? Number(row.decidedBy) : null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface RecordAccessRequestInput {
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
}

/**
 * Opens a new pending request. One row per attempt — see the schema comment.
 * Best-effort like closeAccessRequest: the applicant's `users` row is already
 * written by the time this runs, and a throw here would surface as "ошибка,
 * попробуйте позже" while the row exists — the retry would then hit "вы уже
 * зарегистрированы" and the admin would never be notified.
 */
export async function recordAccessRequest(input: RecordAccessRequestInput): Promise<void> {
  try {
    await db.insert(accessRequests).values({
      telegramId: BigInt(input.telegramId),
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
      status: "pending",
    });
  } catch (err) {
    log.error(
      "Failed to record access request for %d: %s",
      input.telegramId,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Closes the applicant's open request. Best-effort by design: the decision itself
 * (approve/reject) has already been applied to `users`, so a bookkeeping failure
 * must never turn into a failed decision — it is logged and swallowed.
 */
export async function closeAccessRequest(
  telegramId: number,
  status: Exclude<AccessRequestStatus, "pending">,
  decidedByTelegramId: number | null,
): Promise<void> {
  if (!isDatabaseAvailable()) return;
  try {
    await db
      .update(accessRequests)
      .set({
        status,
        decidedBy: decidedByTelegramId != null ? BigInt(decidedByTelegramId) : null,
        decidedAt: new Date(),
      })
      .where(and(eq(accessRequests.telegramId, BigInt(telegramId)), eq(accessRequests.status, "pending")));
  } catch (err) {
    log.error("Failed to close access request for %d: %s", telegramId, err instanceof Error ? err.message : err);
  }
}

export async function listAccessRequests(
  status: AccessRequestStatus | "all",
  limit = 100,
): Promise<AccessRequestDto[]> {
  const rows = await db
    .select()
    .from(accessRequests)
    .where(status === "all" ? sql`true` : eq(accessRequests.status, status))
    // Newest first, with still-open requests on top so they cannot scroll away.
    .orderBy(sql`case when ${accessRequests.status} = 'pending' then 0 else 1 end`, desc(accessRequests.createdAt))
    .limit(limit);

  return rows.map(toDto);
}
