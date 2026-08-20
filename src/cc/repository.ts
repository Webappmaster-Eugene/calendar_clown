import { eq, sql } from "drizzle-orm";
import { db } from "../db/drizzle.js";
import { ccTopics } from "../db/schema.js";

export interface CcTopic {
  topicKey: string;
  machine: string;
  project: string;
  threadId: number;
}

export function buildTopicKey(machine: string, cwd: string): string {
  // cwd rather than the project basename: two checkouts of the same repo on one
  // machine are different working contexts and deserve separate topics.
  return `${machine}:${cwd}`.slice(0, 255);
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

/** Called when Telegram reports the stored topic no longer exists. */
export async function forgetTopic(topicKey: string): Promise<void> {
  await db.delete(ccTopics).where(eq(ccTopics.topicKey, topicKey));
}
