import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { ccTopics } from "../db/schema.js";

export interface CcTopic {
  topicKey: string;
  machine: string;
  project: string;
  threadId: number;
}

export function buildTopicKey(machine: string, cwd: string, session: string): string {
  // cwd rather than the project basename: two checkouts of the same repo on one
  // machine are different working contexts and deserve separate topics.
  // A named session gets its own topic on top of that; the unnamed form keeps
  // the original key so topics created before naming existed stay addressable.
  const base = `${machine}:${cwd}`;
  return (session ? `${base}#${session}` : base).slice(0, 255);
}

export async function findTopicByKey(topicKey: string): Promise<CcTopic | null> {
  const [row] = await db
    .select()
    .from(ccTopics)
    .where(eq(ccTopics.topicKey, topicKey))
    .limit(1);
  return row ? { topicKey: row.topicKey, machine: row.machine, project: row.project, threadId: row.threadId } : null;
}

export async function findTopicByThread(threadId: number): Promise<CcTopic | null> {
  const [row] = await db
    .select()
    .from(ccTopics)
    .where(eq(ccTopics.threadId, threadId))
    .limit(1);
  return row ? { topicKey: row.topicKey, machine: row.machine, project: row.project, threadId: row.threadId } : null;
}

export async function saveTopic(topic: CcTopic): Promise<void> {
  await db
    .insert(ccTopics)
    .values({
      topicKey: topic.topicKey,
      machine: topic.machine,
      project: topic.project,
      threadId: topic.threadId,
    })
    .onConflictDoUpdate({
      target: ccTopics.topicKey,
      set: { threadId: topic.threadId, project: topic.project, lastUsedAt: sql`now()` },
    });
}

export async function touchTopic(threadId: number): Promise<void> {
  await db.update(ccTopics).set({ lastUsedAt: sql`now()` }).where(eq(ccTopics.threadId, threadId));
}

export interface CcTopicRow extends CcTopic {
  lastUsedAt: Date;
  closedAt: Date | null;
}

export async function listTopics(): Promise<CcTopicRow[]> {
  const rows = await db.select().from(ccTopics).orderBy(desc(ccTopics.lastUsedAt));
  return rows.map((r) => ({
    topicKey: r.topicKey,
    machine: r.machine,
    project: r.project,
    threadId: r.threadId,
    lastUsedAt: r.lastUsedAt,
    closedAt: r.closedAt,
  }));
}

/** Open topics whose last session predates the cutoff — candidates for archiving. */
export async function listStaleOpenTopics(cutoff: Date): Promise<CcTopicRow[]> {
  const rows = await db
    .select()
    .from(ccTopics)
    .where(and(isNull(ccTopics.closedAt), lt(ccTopics.lastUsedAt, cutoff)));
  return rows.map((r) => ({
    topicKey: r.topicKey,
    machine: r.machine,
    project: r.project,
    threadId: r.threadId,
    lastUsedAt: r.lastUsedAt,
    closedAt: r.closedAt,
  }));
}

export async function setTopicClosed(threadId: number, closed: boolean): Promise<void> {
  await db
    .update(ccTopics)
    .set({ closedAt: closed ? sql`now()` : null })
    .where(eq(ccTopics.threadId, threadId));
}

/** Whether the stored topic is archived, plus how long it sat idle before now. */
export async function getTopicState(
  threadId: number,
): Promise<{ closed: boolean; idleMs: number } | null> {
  const [row] = await db
    .select({ closedAt: ccTopics.closedAt, lastUsedAt: ccTopics.lastUsedAt })
    .from(ccTopics)
    .where(eq(ccTopics.threadId, threadId))
    .limit(1);
  if (!row) return null;
  return { closed: row.closedAt !== null, idleMs: Date.now() - row.lastUsedAt.getTime() };
}

export async function forgetTopicByThread(threadId: number): Promise<void> {
  await db.delete(ccTopics).where(eq(ccTopics.threadId, threadId));
}

/** Called when Telegram reports the stored topic no longer exists. */
export async function forgetTopic(topicKey: string): Promise<void> {
  await db.delete(ccTopics).where(eq(ccTopics.topicKey, topicKey));
}
