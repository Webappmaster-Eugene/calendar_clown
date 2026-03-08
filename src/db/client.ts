import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let poolInitAttempted = false;

function buildConfig(): pg.PoolConfig | null {
  const url = process.env.DATABASE_URL?.trim();
  if (url) return { connectionString: url, max: 10 };

  const host = process.env.POSTGRES_HOST?.trim();
  const port = process.env.POSTGRES_PORT?.trim();
  const user = process.env.POSTGRES_USER?.trim();
  const password = process.env.POSTGRES_PASSWORD?.trim();
  const database = process.env.POSTGRES_DB?.trim();
  if (!host || !user || !database) return null;

  return {
    host,
    port: port ? parseInt(port, 10) : 5432,
    user,
    password: password ?? undefined,
    database,
    max: 10,
  };
}

export function getPool(): pg.Pool | null {
  if (pool !== null) return pool;
  if (poolInitAttempted) return null;

  poolInitAttempted = true;
  const config = buildConfig();
  if (!config) {
    return null;
  }

  try {
    pool = new Pool(config);
    pool.on("error", (err) => {
      console.error("Postgres pool error:", err.message);
    });
    return pool;
  } catch (err) {
    console.warn("Postgres pool init failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

export interface InsertMessageRow {
  telegram_message_id: number;
  chat_id: number;
  user_id: number | null;
  direction: "inbound" | "outbound";
  kind: "text" | "voice";
  content_text?: string | null;
  content_voice_file_id?: string | null;
  content_voice_duration_sec?: number | null;
}

export async function insertMessage(row: InsertMessageRow): Promise<void> {
  const p = getPool();
  if (!p) return;

  try {
    await p.query(
      `INSERT INTO messages (
        telegram_message_id, chat_id, user_id, direction, kind,
        content_text, content_voice_file_id, content_voice_duration_sec
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (chat_id, telegram_message_id) DO NOTHING`,
      [
        row.telegram_message_id,
        row.chat_id,
        row.user_id,
        row.direction,
        row.kind,
        row.content_text ?? null,
        row.content_voice_file_id ?? null,
        row.content_voice_duration_sec ?? null,
      ]
    );
  } catch (err) {
    console.error("insertMessage failed:", err instanceof Error ? err.message : err);
  }
}

export async function updateMessageTranscript(
  chatId: number,
  telegramMessageId: number,
  transcript: string,
  intentType: string
): Promise<void> {
  const p = getPool();
  if (!p) return;

  try {
    await p.query(
      `UPDATE messages
       SET transcript = $1, intent_type = $2, updated_at = now()
       WHERE chat_id = $3 AND telegram_message_id = $4`,
      [transcript, intentType, chatId, telegramMessageId]
    );
  } catch (err) {
    console.error("updateMessageTranscript failed:", err instanceof Error ? err.message : err);
  }
}
