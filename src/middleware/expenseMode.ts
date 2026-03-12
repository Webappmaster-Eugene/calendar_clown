type UserMode = "calendar" | "expenses";

const userModes = new Map<number, UserMode>();

const DEFAULT_MODE: UserMode =
  (process.env.DEFAULT_BOT_MODE as UserMode) === "expenses" ? "expenses" : "calendar";

export function getUserMode(telegramId: number): UserMode {
  return userModes.get(telegramId) ?? DEFAULT_MODE;
}

export function setUserMode(telegramId: number, mode: UserMode): void {
  userModes.set(telegramId, mode);
}

export function isExpenseMode(telegramId: number): boolean {
  return getUserMode(telegramId) === "expenses";
}
