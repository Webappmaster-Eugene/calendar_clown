import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AdminUserDto, TribeDto, AdminStatsDto } from "@shared/types";

type AdminTab = "stats" | "users" | "pending" | "tribes" | "data";

export function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("stats");

  return (
    <div className="page">
      <h1 className="page-title">Админ-панель</h1>

      <div className="tabs">
        {(["stats", "users", "pending", "tribes", "data"] as const).map((t) => {
          const labels: Record<AdminTab, string> = {
            stats: "Статистика",
            users: "Пользователи",
            pending: "Заявки",
            tribes: "Трайбы",
            data: "Данные",
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
      {tab === "data" && <DataTab />}
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

function UsersTab() {
  const queryClient = useQueryClient();
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
                  onClick={() => removeTribeMutation.mutate(u.id)}
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
                    if (tribeId) assignTribeMutation.mutate({ userId: u.id, tribeId });
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
                    if (tribeId) assignTribeMutation.mutate({ userId: u.id, tribeId });
                  }}
                >
                  <option value="">Сменить трайб...</option>
                  {tribes.filter((t) => t.name !== u.tribeName).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}

              <button
                className="btn btn-icon btn-danger"
                onClick={() => {
                  if (confirm(`Удалить пользователя ${u.firstName}?`)) {
                    removeUserMutation.mutate(u.id);
                  }
                }}
                disabled={removeUserMutation.isPending}
                title="Удалить"
              >
                🗑️
              </button>
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
              onClick={() => approveMutation.mutate(u.id)}
              disabled={approveMutation.isPending}
            >
              Одобрить
            </button>
            <button
              className="btn btn-danger btn-small"
              onClick={() => rejectMutation.mutate(u.id)}
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
                    if (confirm(`Удалить трайб "${t.name}"?`)) {
                      deleteMutation.mutate(t.id);
                    }
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

interface EntityMeta {
  key: string;
  emoji: string;
  label: string;
}

interface EntityListItem {
  id: number;
  label: string;
  hint: string;
}

function DataTab() {
  const queryClient = useQueryClient();
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [page, setPage] = useState(1);
  const LIMIT = 10;

  const { data: entities } = useQuery({
    queryKey: ["admin", "data", "entities"],
    queryFn: () => api.get<EntityMeta[]>("/api/admin/data/entities"),
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ["admin", "data", selectedEntity, page],
    queryFn: () =>
      api.get<{ items: EntityListItem[]; total: number }>(
        `/api/admin/data/${selectedEntity}?page=${page}&limit=${LIMIT}`
      ),
    enabled: !!selectedEntity,
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

  const items = listData?.items ?? [];
  const total = listData?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

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

      {selectedEntity && isLoading && <div className="loading">Загрузка...</div>}

      {selectedEntity && !isLoading && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">Нет данных</div>
        </div>
      )}

      {selectedEntity && items.length > 0 && (
        <>
          <div style={{ marginBottom: 8, fontSize: 13, opacity: 0.7 }}>
            Всего: {total} · Стр. {page}/{totalPages}
          </div>
          <div className="list">
            {items.map((item) => (
              <div key={item.id} className="list-item">
                <div className="list-item-content">
                  <div className="list-item-title">{item.label}</div>
                  <div className="list-item-hint">{item.hint}</div>
                </div>
                <div className="list-item-actions">
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => deleteMutation.mutate({ entity: selectedEntity, id: item.id })}
                    disabled={deleteMutation.isPending}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
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

      {selectedEntity && total > 0 && (
        <button
          className="btn btn-danger btn-block"
          style={{ marginTop: 16 }}
          onClick={() => {
            if (confirm(`Удалить ВСЕ записи раздела "${selectedEntity}" (${total} шт.)? Это действие необратимо!`)) {
              deleteAllMutation.mutate(selectedEntity);
            }
          }}
          disabled={deleteAllMutation.isPending}
        >
          {deleteAllMutation.isPending ? "Удаление..." : `Удалить все (${total})`}
        </button>
      )}
    </>
  );
}
