/**
 * CRUD repository for Summarizer mode: workplaces, work achievements.
 * All queries use raw SQL via query().
 */

import { query } from "../db/connection.js";
import { MAX_WORKPLACES_PER_USER } from "../constants.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface Workplace {
  id: number;
  userId: number;
  title: string;
  company: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  achievementCount?: number;
}

export interface WorkAchievement {
  id: number;
  workplaceId: number;
  text: string;
  inputMethod: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Row types ──────────────────────────────────────────────────────────

interface WorkplaceRow {
  id: number;
  user_id: number;
  title: string;
  company: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface WorkAchievementRow {
  id: number;
  workplace_id: number;
  text: string;
  input_method: string;
  created_at: Date;
  updated_at: Date;
}

// ─── Workplaces ─────────────────────────────────────────────────────────

export async function createWorkplace(
  userId: number,
  title: string,
  company?: string
): Promise<Workplace> {
  const count = await countWorkplacesByUser(userId);
  if (count >= MAX_WORKPLACES_PER_USER) {
    throw new Error(
      `Достигнут лимит: максимум ${MAX_WORKPLACES_PER_USER} активных мест работы`
    );
  }

  const { rows } = await query<WorkplaceRow>(
    `INSERT INTO workplaces (user_id, title, company)
     VALUES ($1, $2, $3) RETURNING *`,
    [userId, title, company ?? null]
  );
  return mapWorkplace(rows[0]);
}

export async function getWorkplacesByUser(userId: number): Promise<Workplace[]> {
  const { rows } = await query<WorkplaceRow & { achievement_count: string }>(
    `SELECT w.*,
       COUNT(wa.id) AS achievement_count
     FROM workplaces w
     LEFT JOIN work_achievements wa ON wa.workplace_id = w.id
     WHERE w.user_id = $1 AND w.is_active = true
     GROUP BY w.id
     ORDER BY w.created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    ...mapWorkplace(r),
    achievementCount: parseInt(r.achievement_count, 10),
  }));
}

export async function getWorkplaceById(
  workplaceId: number,
  userId: number
): Promise<Workplace | null> {
  const { rows } = await query<WorkplaceRow & { achievement_count: string }>(
    `SELECT w.*,
       COUNT(wa.id) AS achievement_count
     FROM workplaces w
     LEFT JOIN work_achievements wa ON wa.workplace_id = w.id
     WHERE w.id = $1 AND w.user_id = $2 AND w.is_active = true
     GROUP BY w.id`,
    [workplaceId, userId]
  );
  if (rows.length === 0) return null;
  return {
    ...mapWorkplace(rows[0]),
    achievementCount: parseInt(rows[0].achievement_count, 10),
  };
}

export async function updateWorkplace(
  workplaceId: number,
  userId: number,
  updates: { title?: string; company?: string }
): Promise<Workplace | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(updates.title);
  }
  if (updates.company !== undefined) {
    sets.push(`company = $${idx++}`);
    params.push(updates.company);
  }

  if (sets.length === 0) return getWorkplaceById(workplaceId, userId);

  sets.push(`updated_at = NOW()`);
  params.push(workplaceId, userId);

  const { rows } = await query<WorkplaceRow>(
    `UPDATE workplaces SET ${sets.join(", ")}
     WHERE id = $${idx++} AND user_id = $${idx} AND is_active = true
     RETURNING *`,
    params
  );
  if (rows.length === 0) return null;
  return mapWorkplace(rows[0]);
}

export async function deleteWorkplace(
  workplaceId: number,
  userId: number
): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE workplaces SET is_active = false, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND is_active = true`,
    [workplaceId, userId]
  );
  return (rowCount ?? 0) > 0;
}

export async function countWorkplacesByUser(userId: number): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM workplaces WHERE user_id = $1 AND is_active = true",
    [userId]
  );
  return parseInt(rows[0].count, 10);
}

// ─── Achievements ───────────────────────────────────────────────────────

export async function createAchievement(
  workplaceId: number,
  text: string,
  inputMethod: string
): Promise<WorkAchievement> {
  const { rows } = await query<WorkAchievementRow>(
    `INSERT INTO work_achievements (workplace_id, text, input_method)
     VALUES ($1, $2, $3) RETURNING *`,
    [workplaceId, text, inputMethod]
  );
  return mapAchievement(rows[0]);
}

export async function getAchievementsByWorkplace(
  workplaceId: number,
  limit: number = 5,
  offset: number = 0
): Promise<WorkAchievement[]> {
  const { rows } = await query<WorkAchievementRow>(
    `SELECT * FROM work_achievements
     WHERE workplace_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [workplaceId, limit, offset]
  );
  return rows.map(mapAchievement);
}

export async function updateAchievement(
  achievementId: number,
  text: string
): Promise<WorkAchievement | null> {
  const { rows } = await query<WorkAchievementRow>(
    `UPDATE work_achievements
     SET text = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [text, achievementId]
  );
  if (rows.length === 0) return null;
  return mapAchievement(rows[0]);
}

export async function deleteAchievement(achievementId: number): Promise<boolean> {
  const { rowCount } = await query(
    "DELETE FROM work_achievements WHERE id = $1",
    [achievementId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getAllAchievementsForSummary(
  workplaceId: number
): Promise<WorkAchievement[]> {
  const { rows } = await query<WorkAchievementRow>(
    `SELECT * FROM work_achievements
     WHERE workplace_id = $1
     ORDER BY created_at`,
    [workplaceId]
  );
  return rows.map(mapAchievement);
}

// ─── Admin functions ────────────────────────────────────────────────────

/** Admin: get all workplaces paginated (all users, with user info). */
export async function getAllWorkplacesPaginated(
  limit: number,
  offset: number
): Promise<Array<Workplace & { firstName: string }>> {
  const { rows } = await query<WorkplaceRow & { first_name: string }>(
    `SELECT w.*, u.first_name
     FROM workplaces w
     JOIN users u ON u.id = w.user_id
     ORDER BY w.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows.map((r) => ({ ...mapWorkplace(r), firstName: r.first_name }));
}

/** Admin: count all workplaces. */
export async function countAllWorkplaces(): Promise<number> {
  const { rows } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM workplaces"
  );
  return parseInt(rows[0].count, 10);
}

/** Admin: bulk delete workplaces by IDs. */
export async function bulkDeleteWorkplaces(ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await query(
    "DELETE FROM workplaces WHERE id = ANY($1)",
    [ids]
  );
  return rowCount ?? 0;
}

/** Admin: delete ALL workplaces. */
export async function deleteAllWorkplaces(): Promise<number> {
  const { rowCount } = await query("DELETE FROM workplaces");
  return rowCount ?? 0;
}

// ─── Mappers ────────────────────────────────────────────────────────────

function mapWorkplace(r: WorkplaceRow): Workplace {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    company: r.company,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapAchievement(r: WorkAchievementRow): WorkAchievement {
  return {
    id: r.id,
    workplaceId: r.workplace_id,
    text: r.text,
    inputMethod: r.input_method,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
