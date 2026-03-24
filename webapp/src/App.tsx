import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TelegramProvider } from "./hooks/useTelegram";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ModeSelectorPage } from "./pages/ModeSelectorPage";
import { CalendarPage } from "./pages/CalendarPage";
import { CreateEventPage } from "./pages/CreateEventPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { GandalfPage } from "./pages/GandalfPage";
import { GoalsPage } from "./pages/GoalsPage";
import { RemindersPage } from "./pages/RemindersPage";
import { WishlistPage } from "./pages/WishlistPage";
import { NotableDatesPage } from "./pages/NotableDatesPage";
import { DigestPage } from "./pages/DigestPage";
import { OsintPage } from "./pages/OsintPage";
import { ChatPage } from "./pages/ChatPage";
import { TranscribePage } from "./pages/TranscribePage";
import { SummarizerPage } from "./pages/SummarizerPage";
import { BloggerPage } from "./pages/BloggerPage";
import { BroadcastPage } from "./pages/BroadcastPage";
import { AdminPage } from "./pages/AdminPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TelegramProvider>
        <BrowserRouter>
          <AppShell>
            <ErrorBoundary>
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
                <Route path="/summarizer" element={<SummarizerPage />} />
                <Route path="/blogger" element={<BloggerPage />} />
                <Route path="/broadcast" element={<BroadcastPage />} />
                <Route path="/admin" element={<AdminPage />} />
              </Routes>
            </ErrorBoundary>
          </AppShell>
        </BrowserRouter>
      </TelegramProvider>
    </QueryClientProvider>
  );
}
