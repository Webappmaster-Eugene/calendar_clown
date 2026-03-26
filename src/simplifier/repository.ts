/**
 * Repository for thought_simplifications table.
 * Raw SQL via query() — follows the pattern of transcribe/repository.ts.
 */
import { query } from "../db/connection.js";

// ─── Types ──────────────────────────────────────────────────────

export interface Simplification {
  id: number;
  userId: number;
  inputType: string;
  originalText: string;
  simplifiedText: string | null;
  modelUsed: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  simplifiedAt: Date | null;
}

interface SimplificationRow {
  id: number;
  user_id: number;
  input_type: string;
  original_text: string;
  simplified_text: string | null;
  model_used: string | null;
  status: string;
  error_message: string | null;
  created_at: Date;
  simplified_at: Date | null;
}

function mapRow(row: SimplificationRow): Simplification {
  return {
    id: row.id,
    userId: row.user_id,
    inputType: row.input_type,
    originalText: row.original_text,
    simplifiedText: row.simplified_text,
    modelUsed: row.model_used,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    simplifiedAt: row.simplified_at,
  };
}

// ─── CRUD ───────────────────────────────────────────────────────

/** Insert a new simplification record (status: pending). */
export async function createSimplification(
  userId: number,
  inputType: string,
  originalText: string,
): Promise<Simplification> {
  const { rows } = await query<SimplificationRow>(
    `INSERT INTO thought_simplifications (user_id, input_type, original_text, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING *`,
    [userId, inputType, originalText],
  );
  return mapRow(rows[0]);
}

/** Mark simplification as completed with the result text. */
export async function markSimplificationCompleted(
  id: number,
  simplifiedText: string,
  modelUsed: string,
): Promise<void> {
  await query(
    `UPDATE thought_simplifications
     SET status = 'completed', simplified_text = $2, model_used = $3, simplified_at = NOW()
     WHERE id = $1`,
    [id, simplifiedText, modelUsed],
  );
}

/** Mark simplification as failed with an error message. */
export async function markSimplificationFailed(
  id: number,
  errorMessage: string,
): Promise<void> {
  await query(
    `UPDATE thought_simplifications
     SET status = 'failed', error_message = $2
     WHERE id = $1`,
    [id, errorMessage],
  );
}

/** Get paginated simplifications for a user (newest first). */
export async function getSimplificationsPaginated(
  userId: number,
  limit: number,
  offset: number,
): Promise<Simplification[]> {
  const { rows } = await query<SimplificationRow>(
    `SELECT * FROM thought_simplifications
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return rows.map(mapRow);
}

/** Count all simplifications for a user. */
export async function countSimplifications(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM thought_simplifications WHERE user_id = $1",
    [userId],
  );
  return parseInt(rows[0].count, 10);
}

/** Get a single simplification by ID (with ownership check). */
export async function getSimplificationById(
  id: number,
  userId: number,
): Promise<Simplification | null> {
  const { rows } = await query<SimplificationRow>(
    "SELECT * FROM thought_simplifications WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

/** Delete a simplification (with ownership check). Returns true if deleted. */
export async function deleteSimplification(
  id: number,
  userId: number,
): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM thought_simplifications WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return (rowCount ?? 0) > 0;
}
