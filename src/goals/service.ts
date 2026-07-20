export type GoalPeriod = "current" | "month" | "year" | "5years";

/** Returns null for "current". */
export function calculateDeadline(period: GoalPeriod, createdAt: Date): Date | null {
  if (period === "current") return null;

  const deadline = new Date(createdAt);
  if (period === "month") {
    deadline.setMonth(deadline.getMonth() + 1);
  } else if (period === "year") {
    deadline.setFullYear(deadline.getFullYear() + 1);
  } else if (period === "5years") {
    deadline.setFullYear(deadline.getFullYear() + 5);
  }
  return deadline;
}

/** Reminder dates at 1/4, 2/4, 3/4 of the creation→deadline interval; empty if no deadline. */
export function calculateReminderDates(createdAt: Date, deadline: Date | null): Date[] {
  if (!deadline) return [];

  const start = createdAt.getTime();
  const end = deadline.getTime();
  const interval = (end - start) / 4;

  if (interval <= 0) return [];

  return [
    new Date(start + interval),
    new Date(start + interval * 2),
    new Date(start + interval * 3),
  ];
}

export function formatPeriod(period: GoalPeriod): string {
  switch (period) {
    case "current": return "Текущие";
    case "month": return "На месяц";
    case "year": return "На год";
    case "5years": return "На 5 лет";
  }
}

/** Format progress as "2/5 (40%) ▓▓▓▓░░░░░░". */
export function formatProgress(completed: number, total: number): string {
  if (total === 0) return "0/0 (0%)";

  const pct = Math.round((completed / total) * 100);
  const barLen = 10;
  const filled = Math.round((completed / total) * barLen);
  const bar = "▓".repeat(filled) + "░".repeat(barLen - filled);

  return `${completed}/${total} (${pct}%) ${bar}`;
}

export function formatGoalText(text: string, isCompleted: boolean): string {
  return isCompleted ? `~${text}~` : `• ${text}`;
}

/** Format deadline as "⏰ До: 18 марта 2027". Returns empty string if no deadline. */
export function formatDeadline(deadline: Date | null): string {
  if (!deadline) return "";

  const formatted = deadline.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  });
  return `⏰ До: ${formatted}`;
}
