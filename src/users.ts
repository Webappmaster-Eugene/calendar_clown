/**
 * Simple per-file user registry.
 * Stores Telegram user IDs that have interacted with the bot.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";

const USERS_FILE = "./data/users.json";

let cachedIds: Set<string> | null = null;

async function loadIds(): Promise<Set<string>> {
  if (cachedIds) return cachedIds;
  try {
    const raw = await readFile(USERS_FILE, "utf8");
    const arr = JSON.parse(raw);
    cachedIds = new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    cachedIds = new Set();
  }
  return cachedIds;
}

async function persist(ids: Set<string>): Promise<void> {
  await mkdir(dirname(USERS_FILE), { recursive: true });
  await writeFile(USERS_FILE, JSON.stringify([...ids]), "utf8");
}

/** Track a user ID (no-op if already tracked). */
export async function trackUser(userId: string): Promise<void> {
  const ids = await loadIds();
  if (ids.has(userId)) return;
  ids.add(userId);
  await persist(ids);
}

/** Get all tracked user IDs. */
export async function getAllUserIds(): Promise<string[]> {
  const ids = await loadIds();
  return [...ids];
}
