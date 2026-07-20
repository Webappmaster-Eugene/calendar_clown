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

// Subroutes (e.g. "/calendar/new") are handled by callers.
export const ROUTE_TO_MODE: Record<string, string> = Object.fromEntries(
  Object.entries(MODE_ROUTES).map(([mode, route]) => [route, mode]),
);
