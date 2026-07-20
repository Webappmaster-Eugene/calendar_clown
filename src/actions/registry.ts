/**
 * Central Action Registry. All catalog modules register here; every surface
 * (`/do` router, MCP server, text parity) reads actions from this one place.
 */
import type { Action } from "./types.js";
import type { UserMenuContext } from "../shared/auth.js";
import { canAccessMode } from "../shared/auth.js";
import { remindersActions } from "./catalog/reminders.js";
import { tasksActions } from "./catalog/tasks.js";
import { goalsActions } from "./catalog/goals.js";
import { gandalfActions } from "./catalog/gandalf.js";
import { wishlistActions } from "./catalog/wishlist.js";
import { notableDatesActions } from "./catalog/notableDates.js";
import { expensesActions } from "./catalog/expenses.js";
import { calendarActions } from "./catalog/calendar.js";
import { osintActions } from "./catalog/osint.js";
import { simplifierActions } from "./catalog/simplifier.js";
import { bloggerActions } from "./catalog/blogger.js";
import { summarizerActions } from "./catalog/summarizer.js";
import { transcribeActions } from "./catalog/transcribe.js";
import { chatActions } from "./catalog/chat.js";
import { nutritionistActions } from "./catalog/nutritionist.js";
import { digestActions } from "./catalog/digest.js";
import { adminActions } from "./catalog/admin.js";
import { broadcastActions } from "./catalog/broadcast.js";

const ALL_ACTIONS: Action[] = [
  ...remindersActions,
  ...tasksActions,
  ...goalsActions,
  ...gandalfActions,
  ...wishlistActions,
  ...notableDatesActions,
  ...expensesActions,
  ...calendarActions,
  ...osintActions,
  ...simplifierActions,
  ...bloggerActions,
  ...summarizerActions,
  ...transcribeActions,
  ...chatActions,
  ...nutritionistActions,
  ...digestActions,
  ...adminActions,
  ...broadcastActions,
];

const BY_NAME = new Map<string, Action>();
for (const action of ALL_ACTIONS) {
  if (BY_NAME.has(action.name)) {
    throw new Error(`Duplicate action name in registry: ${action.name}`);
  }
  BY_NAME.set(action.name, action);
}

/** Every registered action, regardless of access. */
export function getAllActions(): Action[] {
  return ALL_ACTIONS;
}

/** Look up an action by its stable name. */
export function getAction(name: string): Action | undefined {
  return BY_NAME.get(name);
}

/** Actions visible to a user given their access context (mode allowlist). */
export function getActions(menu: UserMenuContext): Action[] {
  return ALL_ACTIONS.filter((a) => canAccessMode(a.mode, menu));
}
