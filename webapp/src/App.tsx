import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TelegramProvider } from "./hooks/useTelegram";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Eager-load the mode selector (first screen, always needed)
import { ModeSelectorPage } from "./pages/ModeSelectorPage";

// Lazy-load all mode pages for code splitting
const CalendarPage = lazy(() => import("./pages/CalendarPage").then((m) => ({ default: m.CalendarPage })));
const CreateEventPage = lazy(() => import("./pages/CreateEventPage").then((m) => ({ default: m.CreateEventPage })));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage").then((m) => ({ default: m.ExpensesPage })));
const GandalfPage = lazy(() => import("./pages/GandalfPage").then((m) => ({ default: m.GandalfPage })));
const GoalsPage = lazy(() => import("./pages/GoalsPage").then((m) => ({ default: m.GoalsPage })));
const RemindersPage = lazy(() => import("./pages/RemindersPage").then((m) => ({ default: m.RemindersPage })));
const WishlistPage = lazy(() => import("./pages/WishlistPage").then((m) => ({ default: m.WishlistPage })));
const NotableDatesPage = lazy(() => import("./pages/NotableDatesPage").then((m) => ({ default: m.NotableDatesPage })));
const DigestPage = lazy(() => import("./pages/DigestPage").then((m) => ({ default: m.DigestPage })));
const OsintPage = lazy(() => import("./pages/OsintPage").then((m) => ({ default: m.OsintPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const TranscribePage = lazy(() => import("./pages/TranscribePage").then((m) => ({ default: m.TranscribePage })));
const SimplifierPage = lazy(() => import("./pages/SimplifierPage").then((m) => ({ default: m.SimplifierPage })));
const SummarizerPage = lazy(() => import("./pages/SummarizerPage").then((m) => ({ default: m.SummarizerPage })));
const BloggerPage = lazy(() => import("./pages/BloggerPage").then((m) => ({ default: m.BloggerPage })));
const BroadcastPage = lazy(() => import("./pages/BroadcastPage").then((m) => ({ default: m.BroadcastPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const TasksPage = lazy(() => import("./pages/TasksPage").then((m) => ({ default: m.TasksPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function PageLoader() {
  return <div className="loading">Загрузка...</div>;
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TelegramProvider>
          <BrowserRouter>
            <AppShell>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<ModeSelectorPage />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/calendar/new" element={<CreateEventPage />} />
                  <Route path="/expenses" element={<ExpensesPage />} />
                  <Route path="/gandalf" element={<GandalfPage />} />
                  <Route path="/goals" element={<GoalsPage />} />
                  <Route path="/reminders" element={<RemindersPage />} />
                  <Route path="/wishlist" element={<WishlistPage />} />
                  <Route path="/dates" element={<NotableDatesPage />} />
                  <Route path="/digest" element={<DigestPage />} />
                  <Route path="/osint" element={<OsintPage />} />
                  <Route path="/neuro" element={<ChatPage />} />
                  <Route path="/transcribe" element={<TranscribePage />} />
                  <Route path="/simplifier" element={<SimplifierPage />} />
                  <Route path="/summarizer" element={<SummarizerPage />} />
                  <Route path="/blogger" element={<BloggerPage />} />
                  <Route path="/broadcast" element={<BroadcastPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/tasks" element={<TasksPage />} />
                </Routes>
              </Suspense>
            </AppShell>
          </BrowserRouter>
        </TelegramProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
