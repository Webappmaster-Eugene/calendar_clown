export const MODE_ROUTES: Record<string, string> = {
  calendar: "/calendar",
  expenses: "/expenses",
  gandalf: "/gandalf",
  goals: "/goals",
  reminders: "/reminders",
  wishlist: "/wishlist",
  notable_dates: "/dates",
  digest: "/digest",
  osint: "/osint",
  neuro: "/neuro",
  transcribe: "/transcribe",
  simplifier: "/simplifier",
  tasks: "/tasks",
  summarizer: "/summarizer",
  blogger: "/blogger",
  broadcast: "/broadcast",
  nutritionist: "/nutritionist",
  admin: "/admin",
};

// Fixed quick-switch bar: the same four modes on every page, so the bottom row is
// a stable landmark instead of a most-recently-used list that reshuffles per page.
export const TAB_BAR_MODES = ["neuro", "expenses", "calendar", "transcribe"] as const;

// Subroutes (e.g. "/calendar/new") are handled by callers.
export const ROUTE_TO_MODE: Record<string, string> = Object.fromEntries(
  Object.entries(MODE_ROUTES).map(([mode, route]) => [route, mode]),
);
