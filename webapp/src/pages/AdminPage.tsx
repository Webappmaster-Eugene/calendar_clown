import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AdminUserDto, TribeDto, AdminStatsDto } from "@shared/types";

type AdminTab = "stats" | "users" | "pending" | "tribes";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("stats");

  return (
    <div className="page">
      <h1 className="page-title">Админ-панель</h1>

      <div className="tabs">
        {(["stats", "users", "pending", "tribes"] as const).map((t) => {
          const labels: Record<AdminTab, string> = {
            stats: "Статистика",
            users: "Пользователи",
            pending: "Заявки",
            tribes: "Трайбы",
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
      {tab === "users" && <UsersTab />}
      {tab === "pending" && <PendingTab />}
      {tab === "tribes" && <TribesTab />}
    </div>
  );
}

function StatsTab() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["admin", "stats"],
    queryFn: () => api.get<AdminStatsDto>("/api/admin/stats"),
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
    </>
  );
}

function UsersTab() {
  const queryClient = useQueryClient();

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

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-msg">{(error as Error).message}</div>;

  return (
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
          {!u.tribeName && tribes && tribes.length > 0 && (
            <div style={{ marginTop: 6, width: "100%" }}>
              <select
                className="input"
                style={{ fontSize: 13, padding: "6px 10px" }}
                defaultValue=""
                onChange={(e) => {
                  const tribeId = Number(e.target.value);
                  if (tribeId) assignTribeMutation.mutate({ userId: u.id, tribeId });
                }}
              >
                <option value="">Назначить трайб...</option>
                {tribes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}
    </div>
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
              onClick={() => approveMutation.mutate(u.id)}
              disabled={approveMutation.isPending}
            >
              Одобрить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function TribesTab() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [tribeName, setTribeName] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("350000");

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
            <div key={t.id} className="list-item">
              <div className="list-item-content">
                <div className="list-item-title">{t.name}</div>
                <div className="list-item-hint">
                  {t.memberCount} участников &middot; лимит {t.monthlyLimit.toLocaleString("ru-RU")}
                </div>
              </div>
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
