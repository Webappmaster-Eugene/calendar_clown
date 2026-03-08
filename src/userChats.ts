import fs from "fs/promises";
import path from "path";
import type { Context } from "telegraf";

const DEFAULT_PATH = "./data/user_chats.json";

interface UserChatsStore {
  byUsername: Record<string, number>;
  byUserId: Record<string, number>;
}

function getStorePath(): string {
  return process.env.USER_CHATS_PATH ?? DEFAULT_PATH;
}

async function loadStore(): Promise<UserChatsStore> {
  const filePath = getStorePath();
  try {
    const data = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(data) as Partial<UserChatsStore>;
    return {
      byUsername: parsed.byUsername ?? {},
      byUserId: parsed.byUserId ?? {},
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { byUsername: {}, byUserId: {} };
    }
    throw err;
  }
}

async function saveStore(store: UserChatsStore): Promise<void> {
  const filePath = getStorePath();
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Normalize username: strip leading @ and lowercase for consistent lookup.
 */
function normalizeUsername(username: string): string {
  return username.replace(/^@/, "").trim().toLowerCase() || "";
}

/**
 * Get chat_id by Telegram username (without @ or with @).
 * Returns null if user not found or has no stored chat.
 */
export async function getChatIdByUsername(username: string): Promise<number | null> {
  const key = normalizeUsername(username);
  if (!key) return null;
  const store = await loadStore();
  const chatId = store.byUsername[key];
  return chatId != null ? chatId : null;
}

/**
 * Get chat_id by Telegram user_id (string).
 * Returns null if not found.
 */
export async function getChatIdByUserId(userId: string): Promise<number | null> {
  const store = await loadStore();
  const chatId = store.byUserId[userId];
  return chatId != null ? chatId : null;
}

/**
 * Record private chat: from and chat must be present, chat.type === 'private'.
 * Idempotent: overwrites existing entries for the same user.
 */
export async function recordChat(ctx: Context): Promise<void> {
  const from = ctx.from;
  const chat = ctx.chat;
  if (!from || !chat || chat.type !== "private") return;

  const chatId = chat.id;
  const userId = String(from.id);
  const username = from.username ? normalizeUsername(from.username) : null;

  const store = await loadStore();
  store.byUserId[userId] = chatId;
  if (username) {
    store.byUsername[username] = chatId;
  }
  await saveStore(store);
}
