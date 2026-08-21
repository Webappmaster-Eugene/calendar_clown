// Who may use the bridge, from which machines, and into which group.
//
// Access to the bridge is deliberately separate from access to the bot: reading
// your own expenses and running commands on someone's laptop are not the same
// permission, and conflating them would grant the second by way of the first.
import { createHash, randomBytes } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { ccAccess, ccCollaborators, ccMachineTokens, users } from "../db/schema.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("cc-access");

export interface CcAccessRow {
  userId: number;
  groupId: number | null;
  status: string;
  maxMachines: number;
  maxSessions: number;
}

/** Tokens are compared by digest so the database never holds a usable secret. */
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function toRow(r: typeof ccAccess.$inferSelect): CcAccessRow {
  return {
    userId: r.userId,
    groupId: r.groupId,
    status: r.status,
    maxMachines: r.maxMachines,
    maxSessions: r.maxSessions,
  };
}

export async function getAccessByUser(userId: number): Promise<CcAccessRow | null> {
  const [row] = await db
    .select()
    .from(ccAccess)
    .where(and(eq(ccAccess.userId, userId), isNull(ccAccess.revokedAt)))
    .limit(1);
  return row ? toRow(row) : null;
}

export async function getAccessByGroup(groupId: number): Promise<CcAccessRow | null> {
  const [row] = await db
    .select()
    .from(ccAccess)
    .where(and(eq(ccAccess.groupId, groupId), isNull(ccAccess.revokedAt)))
    .limit(1);
  return row ? toRow(row) : null;
}

export interface ResolvedMachine {
  userId: number;
  tokenId: number;
  access: CcAccessRow;
}

/**
 * Turns a presented machine token into its owner, or null. Revoked tokens,
 * suspended access and unknown digests are indistinguishable to the caller on
 * purpose: a probe should not learn which of the three it hit.
 */
export async function resolveMachineToken(token: string): Promise<ResolvedMachine | null> {
  const digest = hashToken(token);
  const [row] = await db
    .select()
    .from(ccMachineTokens)
    .where(and(eq(ccMachineTokens.tokenHash, digest), isNull(ccMachineTokens.revokedAt)))
    .limit(1);
  if (!row) return null;

  const access = await getAccessByUser(row.userId);
  if (!access || access.status !== "active") return null;

  // Best-effort: a failed bookkeeping write must not deny a valid machine.
  void db
    .update(ccMachineTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(ccMachineTokens.id, row.id))
    .catch(() => {});

  return { userId: row.userId, tokenId: row.id, access };
}

export interface MachineTokenRow {
  id: number;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listMachineTokens(userId: number): Promise<MachineTokenRow[]> {
  const rows = await db
    .select()
    .from(ccMachineTokens)
    .where(and(eq(ccMachineTokens.userId, userId), isNull(ccMachineTokens.revokedAt)));
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt,
  }));
}

/** Returns the plaintext token. It is never recoverable afterwards — only its digest is kept. */
export async function issueMachineToken(userId: number, label: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.insert(ccMachineTokens).values({
    userId,
    tokenHash: hashToken(token),
    label: label.slice(0, 64) || "machine",
  });
  log.info("issued machine token for user %d (%s)", userId, label);
  return token;
}

export async function revokeMachineToken(userId: number, tokenId: number): Promise<boolean> {
  const rows = await db
    .update(ccMachineTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(ccMachineTokens.id, tokenId),
        eq(ccMachineTokens.userId, userId),
        isNull(ccMachineTokens.revokedAt),
      ),
    )
    .returning({ id: ccMachineTokens.id });
  return rows.length > 0;
}

export async function grantAccess(userId: number, grantedBy: number | null): Promise<void> {
  await db
    .insert(ccAccess)
    .values({ userId, createdBy: grantedBy, status: "active" })
    .onConflictDoUpdate({
      target: ccAccess.userId,
      set: { status: "active", revokedAt: null },
    });
}

export async function bindGroup(userId: number, groupId: number): Promise<void> {
  await db.update(ccAccess).set({ groupId }).where(eq(ccAccess.userId, userId));
}

export async function isCollaborator(ownerUserId: number, telegramId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: ccCollaborators.id })
    .from(ccCollaborators)
    .where(
      and(eq(ccCollaborators.ownerUserId, ownerUserId), eq(ccCollaborators.telegramId, telegramId)),
    )
    .limit(1);
  return row !== undefined;
}

export async function addCollaborator(ownerUserId: number, telegramId: number): Promise<void> {
  await db
    .insert(ccCollaborators)
    .values({ ownerUserId, telegramId })
    .onConflictDoNothing();
}

export async function removeCollaborator(ownerUserId: number, telegramId: number): Promise<boolean> {
  const rows = await db
    .delete(ccCollaborators)
    .where(
      and(eq(ccCollaborators.ownerUserId, ownerUserId), eq(ccCollaborators.telegramId, telegramId)),
    )
    .returning({ id: ccCollaborators.id });
  return rows.length > 0;
}

export async function listCollaborators(ownerUserId: number): Promise<number[]> {
  const rows = await db
    .select({ telegramId: ccCollaborators.telegramId })
    .from(ccCollaborators)
    .where(eq(ccCollaborators.ownerUserId, ownerUserId));
  return rows.map((r) => r.telegramId);
}

export async function findUserIdByTelegramId(telegramId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.telegramId, BigInt(telegramId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Migrates the single-tenant setup onto the per-user tables: the owner gets an
 * access row bound to the group from the environment, and the shared
 * CC_MACHINE_TOKEN is registered as one of their machine tokens.
 *
 * Registering the env token rather than special-casing it keeps one code path
 * for authentication — the machines that already work keep working, and there is
 * no second, weaker way in to forget about later.
 */
export async function bootstrapOwnerAccess(): Promise<void> {
  const adminRaw = process.env.ADMIN_TELEGRAM_ID?.trim();
  if (!adminRaw) return;
  const adminTelegramId = Number(adminRaw);
  if (!Number.isFinite(adminTelegramId)) return;

  const userId = await findUserIdByTelegramId(adminTelegramId);
  if (!userId) {
    log.warn("bootstrap admin %d is not in users yet — bridge access not granted", adminTelegramId);
    return;
  }

  await grantAccess(userId, userId);

  const groupRaw = process.env.CC_GROUP_ID?.trim();
  const groupId = groupRaw ? Number(groupRaw) : NaN;
  if (Number.isFinite(groupId)) {
    const existing = await getAccessByGroup(groupId);
    if (!existing || existing.userId === userId) {
      await bindGroup(userId, groupId);
    } else {
      log.warn("CC_GROUP_ID %d is already bound to user %d", groupId, existing.userId);
    }
  }

  const envToken = process.env.CC_MACHINE_TOKEN?.trim();
  if (envToken) {
    const digest = hashToken(envToken);
    const [known] = await db
      .select({ id: ccMachineTokens.id })
      .from(ccMachineTokens)
      .where(eq(ccMachineTokens.tokenHash, digest))
      .limit(1);
    if (!known) {
      await db.insert(ccMachineTokens).values({ userId, tokenHash: digest, label: "env" });
      log.info("registered CC_MACHINE_TOKEN as a machine token for user %d", userId);
    }
  }

  log.info("bridge access bootstrapped for user %d", userId);
}
