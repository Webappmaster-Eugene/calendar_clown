import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useTelegram } from "../hooks/useTelegram";
import type {
  AdminUserDto,
  TribeDto,
  AdminStatsDto,
  UsageSummaryDto,
  SummaryPeriod,
  EntityMetaDto,
  ActionLogsResponseDto,
  SupportReportDto,
} from "@shared/types";

type AdminTab = "stats" | "summary" | "users" | "pending" | "tribes" | "data" | "logs" | "reports";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("stats");

  return (
    <div className="page">
      <h1 className="page-title">Админ-панель</h1>

      <div className="tabs tabs--scroll" onWheel={(e) => { if (e.deltaY) { e.currentTarget.scrollLeft += e.deltaY; e.preventDefault(); } }}>
        {(["stats", "summary", "users", "pending", "tribes", "data", "logs", "reports"] as const).map((t) => {
          const labels: Record<AdminTab, string> = {
            stats: "Статистика",
            summary: "Саммари",
            users: "Пользователи",
            pending: "Заявки",
            tribes: "Трайбы",
            data: "Данные",
            logs: "Логи",
            reports: "Обращения",
          };
          return (
          <button
            key={t}
            className={`tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {labels[t]}
          </button>
          );
        })}
      </div>

      {tab === "stats" && <StatsTab />}
      {tab === "summary" && <SummaryTab />}
      {tab === "users" && <UsersTab />}
      {tab === "pending" && <PendingTab />}
      {tab === "tribes" && <TribesTab />}
      {tab === "data" && <DataTab />}
      {tab === "logs" && <LogsTab />}
      {tab === "reports" && <SupportReportsTab />}
    </div>
  );
}

function StatsTab() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<AdminStatsDto>("/api/admin/stats"),
  });

  const { data: buildInfo } = useQuery({
    queryKey: ["admin", "build-info"],
    queryFn: () => api.get<{ commitHash: string; buildDate: string }>("/api/admin/build-info"),
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-msg">{(error as Error).message}</div>;
  if (!stats) return null;

  return (
    <>
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-value">{stats.totalUsers}</div>
          <div className="stat-label">Всего</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.approvedUsers}</div>
          <div className="stat-label">Одобрено</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.pendingUsers}</div>
          <div className="stat-label">Ожидают</div>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-value">{stats.totalTribes}</div>
          <div className="stat-label">Трайбы</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalExpenses}</div>
          <div className="stat-label">Расходы</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.totalCalendarEvents}</div>
          <div className="stat-label">События</div>
        </div>
      </div>
      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-value">{stats.totalTranscriptions}</div>
          <div className="stat-label">Транскрипции</div>
        </div>
      </div>
      {buildInfo && (
        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.6, textAlign: "center" }}>
          Сборка: {buildInfo.commitHash.substring(0, 8)} &middot; {new Date(buildInfo.buildDate).toLocaleDateString("ru-RU")}
        </div>
      )}
    </>
  );
}

// ─── Summary Tab ──────────────────────────────────────────────

const PERIODS: { key: SummaryPeriod; label: string }[] = [
  { key: "today", label: "Сегодня" },
  { key: "yesterday", label: "Вчера" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год" },
];

function fmtNum(n: number): string {
  return n.toLocaleString("ru-RU");
}

function SummaryTab() {
  const [period, setPeriod] = useState<SummaryPeriod>("today");
  const [aiText, setAiText] = useState<string | null>(null);

  const { data: summary, isLoading, error } = useQuery({
    queryKey: ["admin", "summary", period],
    queryFn: () => api.get<UsageSummaryDto>(`/api/admin/summary?period=${period}`),
  });

  const aiMutation = useMutation({
    mutationFn: (p: SummaryPeriod) =>
      api.post<{ text: string }>("/api/admin/summary/ai", { period: p }),
    onSuccess: (data) => {
      setAiText(data.text);
    },
  });

  const handlePeriodChange = (p: SummaryPeriod) => {
    setPeriod(p);
    setAiText(null);
  };

  const isEmpty = summary && (
    summary.expenses.count === 0 &&
    summary.calendarEvents.created === 0 &&
    summary.calendarEvents.deleted === 0 &&
    summary.transcriptions.total === 0 &&
    summary.actionLogs.length === 0 &&
    summary.gandalfEntries.count === 0 &&
    summary.chatMessages.count === 0 &&
    summary.digestRuns.count === 0 &&
    summary.wishlistItems.count === 0 &&
    summary.goals.created === 0 &&
    summary.notableDates.count === 0
  );

  return (
    <>
      <div className="period-selector">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            className={`btn btn-small ${period === p.key ? "btn-primary" : ""}`}
            onClick={() => handlePeriodChange(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading && <div className="loading">Загрузка...</div>}
      {error && <div className="error-msg">{(error as Error).message}</div>}

      {isEmpty && (
        <div className="empty-state">
          <div className="empty-state-text">За этот период активности не обнаружено</div>
        </div>
      )}

      {summary && !isEmpty && (
        <>
          {/* AI Summary */}
          <div style={{ marginBottom: 16 }}>
            {aiText ? (
              <div className="card">
                <div className="summary-section-title">AI Саммари</div>
                <div className="summary-ai-text">{aiText}</div>
              </div>
            ) : (
              <button
                className="btn btn-primary btn-block"
                onClick={() => aiMutation.mutate(period)}
                disabled={aiMutation.isPending}
              >
                {aiMutation.isPending ? "Генерация..." : "Сгенерировать AI саммари"}
              </button>
            )}
            {aiMutation.error && (
              <div className="error-msg" style={{ marginTop: 8 }}>
                {(aiMutation.error as Error).message}
              </div>
            )}
          </div>

          {/* Expenses */}
          {summary.expenses.count > 0 && (
            <div className="card summary-section">
              <div className="summary-section-title">Расходы</div>
              <div className="summary-row">
                <span className="summary-row-label">Всего записей</span>
                <span className="summary-row-value">{fmtNum(summary.expenses.count)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Общая сумма</span>
                <span className="summary-row-value">{fmtNum(summary.expenses.totalAmount)} ₽</span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Текст / Голос</span>
                <span className="summary-row-value">{summary.expenses.textCount} / {summary.expenses.voiceCount}</span>
              </div>

              {summary.expenses.categories.length > 0 && (
                <>
                  <div className="summary-subsection-title">Топ категории</div>
                  {summary.expenses.categories.map((cat) => {
                    const pct = summary.expenses.totalAmount > 0
                      ? Math.round((cat.amount / summary.expenses.totalAmount) * 100)
                      : 0;
                    return (
                      <div key={cat.name} className="summary-bar-row">
                        <div className="summary-bar-label">
                          {cat.emoji} {cat.name}
                          <span className="summary-bar-amount">{fmtNum(cat.amount)} ₽</span>
                        </div>
                        <div className="summary-bar">
                          <div className="summary-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {summary.expenses.perUser.length > 0 && (
                <>
                  <div className="summary-subsection-title">По пользователям</div>
                  {summary.expenses.perUser.map((u) => (
                    <div key={u.firstName} className="summary-row">
                      <span className="summary-row-label">{u.firstName}</span>
                      <span className="summary-row-value">{fmtNum(u.amount)} ₽ ({u.count})</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Calendar */}
          {(summary.calendarEvents.created > 0 || summary.calendarEvents.deleted > 0) && (
            <div className="card summary-section">
              <div className="summary-section-title">Календарь</div>
              <div className="summary-row">
                <span className="summary-row-label">Создано / Удалено</span>
                <span className="summary-row-value">{summary.calendarEvents.created} / {summary.calendarEvents.deleted}</span>
              </div>
              <div className="summary-row">
                <span className="summary-row-label">Текст / Голос</span>
                <span className="summary-row-value">{summary.calendarEvents.textCount} / {summary.calendarEvents.voiceCount}</span>
              </div>
              {summary.calendarEvents.perUser.length > 0 && (
                <>
                  <div className="summary-subsection-title">По пользователям</div>
                  {summary.calendarEvents.perUser.map((u) => (
                    <div key={u.firstName} className="summary-row">
                      <span className="summary-row-label">{u.firstName}</span>
                      <span className="summary-row-value">+{u.created} / -{u.deleted}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Transcriptions */}
          {summary.transcriptions.total > 0 && (
            <div className="card summary-section">
              <div className="summary-section-title">Транскрибация</div>
              <div className="summary-row">
                <span className="summary-row-label">Всего</span>
                <span className="summary-row-value">{summary.transcriptions.total}</span>
              </div>
              {summary.transcriptions.errors > 0 && (
                <div className="summary-row">
                  <span className="summary-row-label">Ошибок</span>
                  <span className="summary-row-value" style={{ color: "var(--tg-theme-destructive-text-color, #e53935)" }}>
                    {summary.transcriptions.errors}
                  </span>
                </div>
              )}
              {summary.transcriptions.perUser.length > 0 && (
                <>
                  <div className="summary-subsection-title">По пользователям</div>
                  {summary.transcriptions.perUser.map((u) => (
                    <div key={u.firstName} className="summary-row">
                      <span className="summary-row-label">{u.firstName}</span>
                      <span className="summary-row-value">{u.count}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Other modules — compact */}
          <SummaryCompactModules summary={summary} />

          {/* Action logs */}
          {summary.actionLogs.length > 0 && (
            <div className="card summary-section">
              <div className="summary-section-title">Топ действий</div>
              {summary.actionLogs.slice(0, 10).map((a) => (
                <div key={a.action} className="summary-row">
                  <span className="summary-row-label" style={{ fontSize: 13 }}>{a.action}</span>
                  <span className="summary-row-value">{a.count}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function SummaryCompactModules({ summary }: { summary: UsageSummaryDto }) {
  const modules: Array<{ label: string; emoji: string; value: string }> = [];

  if (summary.gandalfEntries.count > 0) {
    modules.push({ label: "База знаний", emoji: "📚", value: String(summary.gandalfEntries.count) });
  }
  if (summary.chatMessages.count > 0) {
    modules.push({ label: "Нейро-чат", emoji: "💬", value: String(summary.chatMessages.count) });
  }
  if (summary.digestRuns.count > 0) {
    modules.push({ label: "Дайджест", emoji: "📰", value: `${summary.digestRuns.count} (${summary.digestRuns.postsFound} постов)` });
  }
  if (summary.wishlistItems.count > 0) {
    modules.push({ label: "Вишлист", emoji: "🎁", value: String(summary.wishlistItems.count) });
  }
  if (summary.goals.created > 0) {
    modules.push({ label: "Цели", emoji: "🎯", value: `${summary.goals.created} создано, ${summary.goals.completed} выполнено` });
  }
  if (summary.notableDates.count > 0) {
    modules.push({ label: "Памятные даты", emoji: "🗓", value: String(summary.notableDates.count) });
  }

  if (modules.length === 0) return null;

  return (
    <div className="card summary-section">
      <div className="summary-section-title">Другие модули</div>
      {modules.map((m) => (
        <div key={m.label} className="summary-row">
          <span className="summary-row-label">{m.emoji} {m.label}</span>
          <span className="summary-row-value">{m.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Users Tab ────────────────────────────────────────────────

function UsersTab() {
  const queryClient = useQueryClient();
  const { user, showConfirm } = useTelegram();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTelegramId, setNewTelegramId] = useState("");

  const { data: users, isLoading, error } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<AdminUserDto[]>("/api/admin/users"),
  });

  const { data: tribes } = useQuery({
    queryKey: ["admin", "tribes"],
    queryFn: () => api.get<TribeDto[]>("/api/admin/tribes"),
  });

  const assignTribeMutation = useMutation({
    mutationFn: ({ userId, tribeId }: { userId: number; tribeId: number }) =>
      api.put<void>(`/api/admin/users/${userId}/tribe`, { tribeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const removeTribeMutation = useMutation({
    mutationFn: (userId: number) =>
      api.del<void>(`/api/admin/users/${userId}/tribe`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const removeUserMutation = useMutation({
    mutationFn: (userId: number) =>
      api.del<void>(`/api/admin/users/${userId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const addUserMutation = useMutation({
    mutationFn: (telegramId: number) =>
      api.post<void>("/api/admin/users", { telegramId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
      setShowAddForm(false);
      setNewTelegramId("");
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-msg">{(error as Error).message}</div>;

  return (
    <>
      {showAddForm && (
        <div className="card" style={{ marginBottom: 16 }}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const tid = parseInt(newTelegramId, 10);
            if (tid) addUserMutation.mutate(tid);
          }}>
            <div className="form-group">
              <label className="form-label">Telegram ID пользователя</label>
              <input
                className="input"
                type="number"
                value={newTelegramId}
                onChange={(e) => setNewTelegramId(e.target.value)}
                placeholder="123456789"
              />
            </div>
            {addUserMutation.error && <div className="error-msg">{(addUserMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowAddForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={addUserMutation.isPending || !newTelegramId.trim()}>Добавить</button>
            </div>
          </form>
        </div>
      )}

      {!showAddForm && (
        <button
          className="btn btn-primary btn-block"
          style={{ marginBottom: 12 }}
          onClick={() => setShowAddForm(true)}
        >
          + Добавить пользователя
        </button>
      )}

      <div className="list">
        {users?.map((u) => (
          <div key={u.id} className="list-item" style={{ flexWrap: "wrap" }}>
            <div className="list-item-content">
              <div className="list-item-title">
                {u.firstName} {u.lastName ?? ""}
                {u.username ? ` (@${u.username})` : ""}
              </div>
              <div className="list-item-hint">
                {u.role} / {u.status} / {u.mode}
                {u.tribeName ? ` / ${u.tribeName}` : " / без трайба"}
              </div>
            </div>
            <div style={{ marginTop: 6, width: "100%", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {/* Tribe management */}
              {u.tribeName ? (
                <button
                  className="btn btn-small"
                  onClick={() => removeTribeMutation.mutate(u.telegramId)}
                  disabled={removeTribeMutation.isPending}
                >
                  Убрать из трайба
                </button>
              ) : tribes && tribes.length > 0 ? (
                <select
                  className="input"
                  style={{ fontSize: 13, padding: "6px 10px", flex: 1, minWidth: 0 }}
                  defaultValue=""
                  onChange={(e) => {
                    const tribeId = Number(e.target.value);
                    if (tribeId) assignTribeMutation.mutate({ userId: u.telegramId, tribeId });
                  }}
                >
                  <option value="">Назначить трайб...</option>
                  {tribes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              ) : null}

              {/* Change tribe for users already in a tribe */}
              {u.tribeName && tribes && tribes.length > 1 && (
                <select
                  className="input"
                  style={{ fontSize: 13, padding: "6px 10px", flex: 1, minWidth: 0 }}
                  defaultValue=""
                  onChange={(e) => {
                    const tribeId = Number(e.target.value);
                    if (tribeId) assignTribeMutation.mutate({ userId: u.telegramId, tribeId });
                  }}
                >
                  <option value="">Сменить трайб...</option>
                  {tribes.filter((t) => t.name !== u.tribeName).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}

              {u.telegramId !== user?.id && u.telegramId !== 0 && (
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => {
                    const msg = `Удалить пользователя ${u.firstName}?`;
                    showConfirm(msg, (ok) => { if (ok) removeUserMutation.mutate(u.telegramId); });
                  }}
                  disabled={removeUserMutation.isPending}
                  title="Удалить"
                >
                  🗑️
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PendingTab() {
  const queryClient = useQueryClient();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ["admin", "pending"],
    queryFn: () => api.get<AdminUserDto[]>("/api/admin/users/pending"),
  });

  const approveMutation = useMutation({
    mutationFn: (userId: number) =>
      api.put<void>(`/api/admin/users/${userId}/approve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (userId: number) =>
      api.put<void>(`/api/admin/users/${userId}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-msg">{(error as Error).message}</div>;

  if (!users || users.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">Нет заявок на подтверждение</div>
      </div>
    );
  }

  return (
    <div className="list">
      {users.map((u) => (
        <div key={u.id} className="list-item">
          <div className="list-item-content">
            <div className="list-item-title">
              {u.firstName} {u.lastName ?? ""}
              {u.username ? ` (@${u.username})` : ""}
            </div>
            <div className="list-item-hint">ID: {u.telegramId}</div>
          </div>
          <div className="list-item-actions">
            <button
              className="btn btn-primary btn-small"
              onClick={() => approveMutation.mutate(u.telegramId)}
              disabled={approveMutation.isPending}
            >
              Одобрить
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={() => rejectMutation.mutate(u.telegramId)}
              disabled={rejectMutation.isPending}
            >
              Отклонить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TribesTab() {
  const queryClient = useQueryClient();
  const { showConfirm: tribesShowConfirm } = useTelegram();
  const [showForm, setShowForm] = useState(false);
  const [tribeName, setTribeName] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("350000");
  const [editingTribeId, setEditingTribeId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editLimit, setEditLimit] = useState("");

  const { data: tribes, isLoading, error } = useQuery({
    queryKey: ["admin", "tribes"],
    queryFn: () => api.get<TribeDto[]>("/api/admin/tribes"),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; monthlyLimit?: number }) =>
      api.post<TribeDto>("/api/admin/tribes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tribes"] });
      setShowForm(false);
      setTribeName("");
      setMonthlyLimit("350000");
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, name, monthlyLimit: ml }: { id: number; name?: string; monthlyLimit?: number }) =>
      api.put<void>(`/api/admin/tribes/${id}`, { name, monthlyLimit: ml }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tribes"] });
      setEditingTribeId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/admin/tribes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "tribes"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-msg">{(error as Error).message}</div>;

  return (
    <>
      {(!tribes || tribes.length === 0) && !showForm && (
        <div className="empty-state">
          <div className="empty-state-text">Нет трайбов</div>
        </div>
      )}

      {tribes && tribes.length > 0 && (
        <div className="list">
          {tribes.map((t) => (
            <div key={t.id} className="list-item" style={{ flexWrap: "wrap" }}>
              <div className="list-item-content">
                <div className="list-item-title">{t.name}</div>
                <div className="list-item-hint">
                  {t.memberCount} участников · лимит {t.monthlyLimit.toLocaleString("ru-RU")}
                </div>
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-icon"
                  onClick={() => {
                    setEditingTribeId(t.id);
                    setEditName(t.name);
                    setEditLimit(String(t.monthlyLimit));
                  }}
                  title="Редактировать"
                >
                  ✏️
                </button>
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => {
                    const msg = `Удалить трайб "${t.name}"?`;
                    tribesShowConfirm(msg, (ok) => { if (ok) deleteMutation.mutate(t.id); });
                  }}
                  disabled={deleteMutation.isPending}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>

              {editingTribeId === t.id && (
                <div className="card" style={{ marginTop: 8, width: "100%" }}>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    editMutation.mutate({
                      id: t.id,
                      name: editName.trim() || undefined,
                      monthlyLimit: parseInt(editLimit, 10) || undefined,
                    });
                  }}>
                    <div className="form-group">
                      <label className="form-label">Название</label>
                      <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Месячный лимит</label>
                      <input className="input" type="number" value={editLimit} onChange={(e) => setEditLimit(e.target.value)} />
                    </div>
                    {editMutation.error && <div className="error-msg">{(editMutation.error as Error).message}</div>}
                    <div className="form-row">
                      <button type="button" className="btn" onClick={() => setEditingTribeId(null)}>Отмена</button>
                      <button type="submit" className="btn btn-primary" disabled={editMutation.isPending}>Сохранить</button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!tribeName.trim()) return;
            createMutation.mutate({
              name: tribeName.trim(),
              monthlyLimit: parseInt(monthlyLimit, 10) || undefined,
            });
          }}>
            <div className="form-group">
              <label className="form-label">Название трайба</label>
              <input className="input" value={tribeName} onChange={(e) => setTribeName(e.target.value)} placeholder="Название" />
            </div>
            <div className="form-group">
              <label className="form-label">Месячный лимит расходов</label>
              <input className="input" type="number" value={monthlyLimit} onChange={(e) => setMonthlyLimit(e.target.value)} />
            </div>
            {createMutation.error && <div className="error-msg">{(createMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending || !tribeName.trim()}>Создать</button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <button
          className="btn btn-primary btn-block"
          style={{ marginTop: 16 }}
          onClick={() => setShowForm(true)}
        >
          Создать трайб
        </button>
      )}
    </>
  );
}

// ─── Data Tab ─────────────────────────────────────────────────

interface EntityListItem {
  id: number;
  label: string;
  hint: string;
}

function DataTab() {
  const queryClient = useQueryClient();
  const { showConfirm } = useTelegram();
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [drilldownId, setDrilldownId] = useState<number | null>(null);
  const [drilldownLabel, setDrilldownLabel] = useState("");
  const [drilldownPage, setDrilldownPage] = useState(1);
  const LIMIT = 10;

  const { data: entities } = useQuery({
    queryKey: ["admin", "data", "entities"],
    queryFn: () => api.get<EntityMetaDto[]>("/api/admin/data/entities"),
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ["admin", "data", selectedEntity, page],
    queryFn: () =>
      api.get<{ items: EntityListItem[]; total: number }>(
        `/api/admin/data/${selectedEntity}?page=${page}&limit=${LIMIT}`
      ),
    enabled: !!selectedEntity && !drilldownId,
  });

  const { data: drilldownData, isLoading: isDrilldownLoading } = useQuery({
    queryKey: ["admin", "data", "wishlists", drilldownId, "items", drilldownPage],
    queryFn: () =>
      api.get<{ items: EntityListItem[]; total: number }>(
        `/api/admin/data/wishlists/${drilldownId}/items?page=${drilldownPage}&limit=${LIMIT}`
      ),
    enabled: !!drilldownId,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ entity, id }: { entity: string; id: number }) =>
      api.del<void>(`/api/admin/data/${entity}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "data", selectedEntity] });
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: (entity: string) =>
      api.del<{ deletedCount: number }>(`/api/admin/data/${entity}?confirm=yes`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "data"] });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ entity, id, fields }: { entity: string; id: number; fields: Record<string, unknown> }) =>
      api.put<{ updated: boolean }>(`/api/admin/data/${entity}/${id}`, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "data", selectedEntity] });
      setEditingId(null);
      setEditValues({});
    },
  });

  const items = listData?.items ?? [];
  const total = listData?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);
  const currentEntityMeta = entities?.find((e) => e.key === selectedEntity);

  function confirmAction(msg: string, onConfirm: () => void) {
    showConfirm(msg, (ok) => { if (ok) onConfirm(); });
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEntity || editingId === null || !currentEntityMeta?.editFields) return;

    const fields: Record<string, unknown> = {};
    for (const field of currentEntityMeta.editFields) {
      const raw = editValues[field.key];
      if (raw === undefined || raw === "") continue;
      fields[field.key] = field.type === "number" ? parseFloat(raw) : raw;
    }

    if (Object.keys(fields).length === 0) return;
    editMutation.mutate({ entity: selectedEntity, id: editingId, fields });
  }

  return (
    <>
      <div className="form-group" style={{ marginBottom: 16 }}>
        <label className="form-label">Раздел данных</label>
        <select
          className="input"
          value={selectedEntity}
          onChange={(e) => {
            setSelectedEntity(e.target.value);
            setPage(1);
            setEditingId(null);
            setEditValues({});
            setDrilldownId(null);
            setDrilldownLabel("");
            setDrilldownPage(1);
          }}
        >
          <option value="">Выберите раздел...</option>
          {entities?.map((e) => (
            <option key={e.key} value={e.key}>
              {e.emoji} {e.label}
            </option>
          ))}
        </select>
      </div>

      {!selectedEntity && (
        <div className="empty-state">
          <div className="empty-state-text">Выберите раздел для управления данными</div>
        </div>
      )}

      {selectedEntity && drilldownId && (
        <>
          <button
            className="btn btn-small"
            style={{ marginBottom: 12 }}
            onClick={() => { setDrilldownId(null); setDrilldownLabel(""); setDrilldownPage(1); }}
          >
            &larr; Назад к вишлистам
          </button>
          <div style={{ marginBottom: 8, fontSize: 14, fontWeight: 500 }}>{drilldownLabel}</div>

          {isDrilldownLoading && <div className="loading">Загрузка...</div>}

          {!isDrilldownLoading && (!drilldownData?.items || drilldownData.items.length === 0) && (
            <div className="empty-state">
              <div className="empty-state-text">Нет элементов</div>
            </div>
          )}

          {drilldownData && drilldownData.items.length > 0 && (
            <>
              <div style={{ marginBottom: 8, fontSize: 13, opacity: 0.7 }}>
                Всего: {drilldownData.total} · Стр. {drilldownPage}/{Math.ceil(drilldownData.total / LIMIT)}
              </div>
              <div className="list">
                {drilldownData.items.map((item) => (
                  <div key={item.id} className="list-item">
                    <div className="list-item-content">
                      <div className="list-item-title">{item.label}</div>
                      <div className="list-item-hint">{item.hint}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
                {drilldownPage > 1 && (
                  <button className="btn btn-small" onClick={() => setDrilldownPage((p) => p - 1)}>Назад</button>
                )}
                {drilldownPage < Math.ceil(drilldownData.total / LIMIT) && (
                  <button className="btn btn-small btn-primary" onClick={() => setDrilldownPage((p) => p + 1)}>Далее</button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {selectedEntity && !drilldownId && isLoading && <div className="loading">Загрузка...</div>}

      {selectedEntity && !drilldownId && !isLoading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">Нет данных</div>
        </div>
      )}

      {selectedEntity && !drilldownId && items.length > 0 && (
        <>
          <div style={{ marginBottom: 8, fontSize: 13, opacity: 0.7 }}>
            Всего: {total} · Стр. {page}/{totalPages}
          </div>
          <div className="list">
            {items.map((item) => (
              <div key={item.id} className="list-item" style={{ flexWrap: "wrap" }}>
                <div
                  className="list-item-content"
                  style={{ cursor: selectedEntity === "wishlists" ? "pointer" : "default" }}
                  onClick={() => {
                    if (selectedEntity === "wishlists") {
                      setDrilldownId(item.id);
                      setDrilldownLabel(item.label);
                      setDrilldownPage(1);
                    }
                  }}
                >
                  <div className="list-item-title">{item.label}</div>
                  <div className="list-item-hint">{item.hint}</div>
                </div>
                <div className="list-item-actions">
                  {currentEntityMeta?.editable && (
                    <button
                      className="btn btn-icon"
                      onClick={() => {
                        setEditingId(editingId === item.id ? null : item.id);
                        setEditValues({});
                      }}
                      title="Редактировать"
                    >
                      ✏️
                    </button>
                  )}
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => confirmAction(`Удалить "${item.label}"?`, () => deleteMutation.mutate({ entity: selectedEntity, id: item.id }))}
                    disabled={deleteMutation.isPending}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>

                {editingId === item.id && currentEntityMeta?.editFields && (
                  <div className="card" style={{ marginTop: 8, width: "100%" }}>
                    <form onSubmit={handleEditSubmit}>
                      {currentEntityMeta.editFields.map((field) => (
                        <div className="form-group" key={field.key}>
                          <label className="form-label">{field.label}</label>
                          <input
                            className="input"
                            type={field.type}
                            step={field.type === "number" ? "any" : undefined}
                            value={editValues[field.key] ?? ""}
                            onChange={(e) => setEditValues((v) => ({ ...v, [field.key]: e.target.value }))}
                            placeholder={field.label}
                          />
                        </div>
                      ))}
                      {editMutation.error && (
                        <div className="error-msg">{(editMutation.error as Error).message}</div>
                      )}
                      <div className="form-row">
                        <button type="button" className="btn" onClick={() => { setEditingId(null); setEditValues({}); }}>Отмена</button>
                        <button type="submit" className="btn btn-primary" disabled={editMutation.isPending}>
                          {editMutation.isPending ? "Сохранение..." : "Сохранить"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
            {page > 1 && (
              <button className="btn btn-small" onClick={() => setPage((p) => p - 1)}>Назад</button>
            )}
            {page < totalPages && (
              <button className="btn btn-small btn-primary" onClick={() => setPage((p) => p + 1)}>Далее</button>
            )}
          </div>
        </>
      )}

      {selectedEntity && !drilldownId && total > 0 && (
        <button
          className="btn btn-danger btn-block"
          style={{ marginTop: 16 }}
          onClick={() => confirmAction(
            `Удалить ВСЕ записи раздела "${selectedEntity}" (${total} шт.)? Это действие необратимо!`,
            () => deleteAllMutation.mutate(selectedEntity),
          )}
          disabled={deleteAllMutation.isPending}
        >
          {deleteAllMutation.isPending ? "Удаление..." : `Удалить все (${total})`}
        </button>
      )}
    </>
  );
}

// ─── Logs Tab ────────────────────────────────────────────────

function LogsTab() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [searchText, setSearchText] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const LIMIT = 50;

  const { data: actions } = useQuery({
    queryKey: ["admin", "logs", "actions"],
    queryFn: () => api.get<string[]>("/api/admin/logs/actions"),
  });

  const queryParams = new URLSearchParams();
  queryParams.set("limit", String(LIMIT));
  queryParams.set("offset", String((page - 1) * LIMIT));
  if (actionFilter) queryParams.set("action", actionFilter);
  if (searchText) queryParams.set("search", searchText);
  if (dateFrom) queryParams.set("dateFrom", dateFrom);
  if (dateTo) queryParams.set("dateTo", dateTo);

  const { data: logsData, isLoading } = useQuery({
    queryKey: ["admin", "logs", page, actionFilter, searchText, dateFrom, dateTo],
    queryFn: () => api.get<ActionLogsResponseDto>(`/api/admin/logs?${queryParams}`),
    refetchInterval: 10_000,
  });

  const totalPages = logsData ? Math.ceil(logsData.total / LIMIT) : 0;

  const handleSearchSubmit = () => {
    setSearchText(searchInput);
    setPage(1);
  };

  const handleReset = () => {
    setActionFilter("");
    setSearchText("");
    setSearchInput("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  };

  const userLabel = (item: ActionLogsResponseDto["items"][number]) => {
    if (item.firstName) return item.username ? `${item.firstName} (@${item.username})` : item.firstName;
    if (item.username) return `@${item.username}`;
    if (item.telegramId) return `ID: ${item.telegramId}`;
    return "system";
  };

  const actionColor = (action: string): string => {
    if (action === "api_request") return "#2196F3";
    if (action === "bot_update") return "#4CAF50";
    if (action.startsWith("scheduler_")) return "#FF9800";
    if (action.startsWith("admin_")) return "#F44336";
    return "#9E9E9E";
  };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select
            className="input"
            style={{ flex: 1, minWidth: 140 }}
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            <option value="">Все действия</option>
            {actions?.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            className="input"
            style={{ flex: 1, minWidth: 120 }}
            type="text"
            placeholder="Поиск в details..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
          />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 130 }}
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          />
          <span style={{ opacity: 0.5 }}>—</span>
          <input
            className="input"
            style={{ flex: 1, minWidth: 130 }}
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
          <button className="btn btn-small" onClick={handleReset}>Сброс</button>
        </div>
      </div>

      {isLoading && <div className="loading">Загрузка...</div>}

      {logsData && logsData.items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">Логи не найдены</div>
        </div>
      )}

      {logsData && logsData.items.length > 0 && (
        <>
          <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
            Всего: {logsData.total.toLocaleString("ru-RU")} | Стр. {page}/{totalPages}
          </div>
          <div className="list">
            {logsData.items.map((item) => (
              <div
                key={item.id}
                className="list-item"
                style={{ cursor: item.details ? "pointer" : "default", flexDirection: "column", alignItems: "stretch" }}
                onClick={() => item.details && setExpandedId(expandedId === item.id ? null : item.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 6px",
                          borderRadius: 4,
                          color: "#fff",
                          backgroundColor: actionColor(item.action),
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {item.action}
                      </span>
                      <span style={{ fontSize: 12, opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {userLabel(item)}
                      </span>
                    </div>
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.5, whiteSpace: "nowrap", flexShrink: 0 }}>
                    {formatTime(item.createdAt)}
                  </span>
                </div>
                {expandedId === item.id && item.details && (
                  <pre style={{
                    fontSize: 11,
                    marginTop: 6,
                    padding: 8,
                    borderRadius: 6,
                    backgroundColor: "var(--tg-theme-secondary-bg-color, #f0f0f0)",
                    overflow: "auto",
                    maxHeight: 200,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}>
                    {(() => {
                      try { return JSON.stringify(JSON.parse(item.details), null, 2); }
                      catch { return item.details; }
                    })()}
                  </pre>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
            {page > 1 && (
              <button className="btn btn-small" onClick={() => setPage((p) => p - 1)}>Назад</button>
            )}
            {page < totalPages && (
              <button className="btn btn-small btn-primary" onClick={() => setPage((p) => p + 1)}>Далее</button>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ─── Support Reports Tab ─────────────────────────────────────

function SupportReportsTab() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: reports, isLoading, error } = useQuery({
    queryKey: ["admin", "reports", filter],
    queryFn: () =>
      api.get<SupportReportDto[]>(
        `/api/support-reports/admin${filter !== "all" ? `?status=${filter}` : ""}`
      ),
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, response }: { id: number; response: string }) =>
      api.put<{ id: number }>(`/api/support-reports/admin/${id}/respond`, { response }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
      setRespondingId(null);
      setResponseText("");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: number) =>
      api.put<{ id: number }>(`/api/support-reports/admin/${id}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin", "reports"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-msg">{(error as Error).message}</div>;

  return (
    <>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {(["open", "resolved", "all"] as const).map((f) => (
          <button
            key={f}
            className={`tab ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "open" ? "Открытые" : f === "resolved" ? "Закрытые" : "Все"}
          </button>
        ))}
      </div>

      {!reports?.length && (
        <div className="empty-state">
          <div className="empty-state-emoji">📭</div>
          <div className="empty-state-text">Нет обращений</div>
        </div>
      )}

      <div className="list">
        {reports?.map((r) => (
          <div key={r.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <strong>#{r.id} {r.firstName}</strong>
              <span style={{ fontSize: 12, opacity: 0.6 }}>
                {r.platform ?? "?"} | {new Date(r.createdAt).toLocaleDateString("ru")}
              </span>
            </div>

            <div style={{ fontSize: 13, opacity: 0.8 }}>
              {r.category} | {r.status === "open" ? "🟡 Открыт" : "🟢 Решён"}
            </div>

            {r.userMessage && (
              <div style={{ fontSize: 13, marginTop: 4 }}>💬 {r.userMessage}</div>
            )}

            {r.adminResponse && (
              <div style={{ fontSize: 13, marginTop: 4, color: "var(--tg-theme-link-color, #2481cc)" }}>
                📨 {r.adminResponse}
              </div>
            )}

            {/* Expandable diagnostics */}
            <button
              style={{ fontSize: 11, background: "none", border: "none", color: "var(--tg-theme-hint-color, #999)", cursor: "pointer", padding: "4px 0", textAlign: "left" }}
              onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
            >
              {expandedId === r.id ? "▲ Скрыть логи" : "▼ Показать логи"}
            </button>
            {expandedId === r.id && (
              <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", wordBreak: "break-all", opacity: 0.6, margin: "4px 0" }}>
                {r.diagnostics}
              </pre>
            )}

            {/* Actions for open reports */}
            {r.status === "open" && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                {respondingId === r.id ? (
                  <div style={{ flex: 1 }}>
                    <textarea
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Ответ пользователю..."
                      rows={2}
                      style={{ width: "100%", fontSize: 13, padding: 8, borderRadius: 8, border: "1px solid var(--tg-theme-hint-color, #ccc)", background: "var(--tg-theme-secondary-bg-color, #f5f5f5)", color: "var(--tg-theme-text-color, #333)", resize: "vertical" }}
                    />
                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button
                        className="btn btn-small btn-primary"
                        disabled={!responseText.trim() || respondMutation.isPending}
                        onClick={() => respondMutation.mutate({ id: r.id, response: responseText })}
                      >
                        Отправить
                      </button>
                      <button className="btn btn-small" onClick={() => { setRespondingId(null); setResponseText(""); }}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button className="btn btn-small btn-primary" onClick={() => setRespondingId(r.id)}>
                      Ответить
                    </button>
                    <button
                      className="btn btn-small"
                      disabled={resolveMutation.isPending}
                      onClick={() => resolveMutation.mutate(r.id)}
                    >
                      Закрыть
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
