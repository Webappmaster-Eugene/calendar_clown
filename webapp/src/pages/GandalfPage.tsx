import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import { useTelegram } from "../hooks/useTelegram";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import type {
  GandalfCategoryDto,
  GandalfEntryDto,
  CreateGandalfEntryRequest,
  UpdateGandalfEntryRequest,
} from "@shared/types";

type GandalfTab = "categories" | "all" | "stats";

interface GandalfStats {
  byCategory: Array<{ categoryId: number; categoryName: string; categoryEmoji: string; totalEntries: number; totalPrice: number | null }>;
  byYear: Array<{ year: number; totalEntries: number; totalPrice: number | null }>;
  byUser: Array<{ userId: number; firstName: string; totalEntries: number; totalPrice: number | null }>;
}

export function GandalfPage() {
  useClosingConfirmation();
  const [tab, setTab] = useState<GandalfTab>("categories");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [showCatForm, setShowCatForm] = useState(false);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [catName, setCatName] = useState("");
  const [catEmoji, setCatEmoji] = useState("");
  const queryClient = useQueryClient();

  const { data: categories, isLoading, error } = useQuery({
    queryKey: ["gandalf", "categories"],
    queryFn: () => api.get<GandalfCategoryDto[]>("/api/gandalf/categories"),
  });

  const createCatMutation = useMutation({
    mutationFn: (data: { name: string; emoji?: string }) =>
      api.post<GandalfCategoryDto>("/api/gandalf/categories", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gandalf"] });
      resetCatForm();
    },
  });

  const updateCatMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; emoji?: string }) =>
      api.put<GandalfCategoryDto>(`/api/gandalf/categories/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gandalf"] });
      resetCatForm();
    },
  });

  const deleteCatMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/gandalf/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gandalf"] });
    },
  });

  const resetCatForm = () => {
    setShowCatForm(false);
    setEditingCatId(null);
    setCatName("");
    setCatEmoji("");
  };

  const startEditCat = (cat: GandalfCategoryDto) => {
    setEditingCatId(cat.id);
    setCatName(cat.name);
    setCatEmoji(cat.emoji ?? "");
    setShowCatForm(true);
  };

  const handleCatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return;
    if (editingCatId) {
      updateCatMutation.mutate({ id: editingCatId, name: catName.trim(), emoji: catEmoji.trim() || undefined });
    } else {
      createCatMutation.mutate({ name: catName.trim(), emoji: catEmoji.trim() || undefined });
    }
  };

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedCategoryId !== null) {
    return (
      <GandalfEntries
        categoryId={selectedCategoryId}
        onBack={() => setSelectedCategoryId(null)}
      />
    );
  }

  const catMutationPending = createCatMutation.isPending || updateCatMutation.isPending;
  const catMutationError = createCatMutation.error || updateCatMutation.error;

  return (
    <div className="page">
      <h1 className="page-title">База знаний</h1>

      <div className="tabs">
        <button className={`tab ${tab === "categories" ? "active" : ""}`} onClick={() => setTab("categories")}>
          Категории
        </button>
        <button className={`tab ${tab === "all" ? "active" : ""}`} onClick={() => setTab("all")}>
          Все записи
        </button>
        <button className={`tab ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")}>
          Статистика
        </button>
      </div>

      {tab === "stats" && <GandalfStatsTab />}

      {tab === "all" && <GandalfAllEntries onSelectCategory={setSelectedCategoryId} />}

      {tab === "categories" && (
        <>
          {categories && categories.length === 0 && !showCatForm ? (
            <div className="empty-state">
              <div className="empty-state-emoji">🧙</div>
              <div className="empty-state-text">Нет категорий</div>
            </div>
          ) : (
            <div className="list">
              {categories?.map((cat) => (
                <div key={cat.id} className="list-item" style={{ display: "flex", alignItems: "center" }}>
                  <button
                    style={{ cursor: "pointer", border: "none", background: "none", flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 8, padding: 0 }}
                    onClick={() => setSelectedCategoryId(cat.id)}
                  >
                    <span className="list-item-emoji">{cat.emoji}</span>
                    <div className="list-item-content">
                      <div className="list-item-title">{cat.name}</div>
                      <div className="list-item-hint">
                        {cat.totalEntries ?? 0} записей
                        {cat.totalPrice != null ? ` / ${cat.totalPrice.toLocaleString("ru-RU")} ₽` : ""}
                      </div>
                    </div>
                  </button>
                  <div className="list-item-actions">
                    <button
                      className="btn btn-icon"
                      onClick={() => startEditCat(cat)}
                      title="Редактировать"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => {
                        if (confirm(`Удалить категорию "${cat.name}"?`)) {
                          deleteCatMutation.mutate(cat.id);
                        }
                      }}
                      disabled={deleteCatMutation.isPending}
                      title="Удалить"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showCatForm && (
            <div className="card" style={{ marginTop: 16 }}>
              <form onSubmit={handleCatSubmit}>
                <div className="form-group">
                  <label className="form-label">Название категории</label>
                  <input className="input" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Название" />
                </div>
                <div className="form-group">
                  <label className="form-label">Эмодзи (необязательно)</label>
                  <input className="input" value={catEmoji} onChange={(e) => setCatEmoji(e.target.value)} placeholder="📁" style={{ width: 80 }} />
                </div>
                {catMutationError && <div className="error-msg">{(catMutationError as Error).message}</div>}
                <div className="form-row">
                  <button type="button" className="btn" onClick={resetCatForm}>Отмена</button>
                  <button type="submit" className="btn btn-primary" disabled={catMutationPending || !catName.trim()}>
                    {editingCatId ? "Сохранить" : "Создать"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {!showCatForm && <button className="fab" onClick={() => setShowCatForm(true)}>+</button>}
        </>
      )}
    </div>
  );
}

function GandalfStatsTab() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ["gandalf", "stats"],
    queryFn: () => api.get<GandalfStats>("/api/gandalf/stats"),
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-msg">{(error as Error).message}</div>;
  if (!stats) return null;

  return (
    <>
      {stats.byCategory.length > 0 && (
        <>
          <h3 style={{ margin: "12px 0 8px" }}>По категориям</h3>
          <div className="list">
            {stats.byCategory.map((s) => (
              <div key={s.categoryId} className="list-item">
                <span className="list-item-emoji">{s.categoryEmoji}</span>
                <div className="list-item-content">
                  <div className="list-item-title">{s.categoryName}</div>
                  <div className="list-item-hint">
                    {s.totalEntries} записей
                    {s.totalPrice != null ? ` / ${s.totalPrice.toLocaleString("ru-RU")} ₽` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {stats.byYear.length > 0 && (
        <>
          <h3 style={{ margin: "12px 0 8px" }}>По годам</h3>
          <div className="list">
            {stats.byYear.map((s) => (
              <div key={s.year} className="list-item">
                <div className="list-item-content">
                  <div className="list-item-title">{s.year}</div>
                  <div className="list-item-hint">
                    {s.totalEntries} записей
                    {s.totalPrice != null ? ` / ${s.totalPrice.toLocaleString("ru-RU")} ₽` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {stats.byUser.length > 0 && (
        <>
          <h3 style={{ margin: "12px 0 8px" }}>По участникам</h3>
          <div className="list">
            {stats.byUser.map((s) => (
              <div key={s.userId} className="list-item">
                <div className="list-item-content">
                  <div className="list-item-title">{s.firstName}</div>
                  <div className="list-item-hint">
                    {s.totalEntries} записей
                    {s.totalPrice != null ? ` / ${s.totalPrice.toLocaleString("ru-RU")} ₽` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {stats.byCategory.length === 0 && stats.byYear.length === 0 && stats.byUser.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">Нет данных для статистики</div>
        </div>
      )}
    </>
  );
}

function GandalfAllEntries({ onSelectCategory }: { onSelectCategory: (id: number) => void }) {
  const [page, setPage] = useState(1);
  const LIMIT = 10;

  const { data, isLoading } = useQuery({
    queryKey: ["gandalf", "entries", "all", page],
    queryFn: () =>
      api.get<{ entries: GandalfEntryDto[]; total: number }>(
        `/api/gandalf/entries?page=${page}`
      ),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const hasMore = page * LIMIT < total;

  if (isLoading && page === 1) return <div className="loading">Загрузка...</div>;

  if (entries.length === 0 && page === 1) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">Нет записей</div>
      </div>
    );
  }

  return (
    <>
      <div className="list">
        {entries.map((entry) => (
          <div key={entry.id} className="list-item">
            <button
              style={{ cursor: "pointer", border: "none", background: "none", padding: 0 }}
              onClick={() => onSelectCategory(entry.categoryId)}
            >
              <span className="list-item-emoji">{entry.categoryEmoji}</span>
            </button>
            <div className="list-item-content">
              <div className="list-item-title">
                {entry.isImportant ? "⭐ " : ""}
                {entry.isUrgent ? "🔥 " : ""}
                {entry.title}
              </div>
              <div className="list-item-hint">
                {entry.categoryName}
                {entry.price != null ? ` / ${entry.price.toLocaleString("ru-RU")} ₽` : ""}
                {entry.nextDate ? ` / ${entry.nextDate}` : ""}
                {entry.visibility === "private" ? " / 🔒" : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
        {page > 1 && (
          <button className="btn btn-small" onClick={() => setPage((p) => p - 1)}>Назад</button>
        )}
        {hasMore && (
          <button className="btn btn-small btn-primary" onClick={() => setPage((p) => p + 1)}>
            {isLoading ? "Загрузка..." : "Далее"}
          </button>
        )}
      </div>
      <div style={{ textAlign: "center", marginTop: 4, fontSize: 12, opacity: 0.6 }}>
        Стр. {page} / {Math.ceil(total / LIMIT) || 1}
      </div>
    </>
  );
}

function GandalfEntries({
  categoryId,
  onBack,
}: {
  categoryId: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const { showConfirm } = useTelegram();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [info, setInfo] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [isImportant, setIsImportant] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);
  const [visibility, setVisibility] = useState<"tribe" | "private">("tribe");
  const [page, setPage] = useState(1);
  const LIMIT = 50;

  const { data: entriesData, isLoading } = useQuery({
    queryKey: ["gandalf", "entries", categoryId, page],
    queryFn: () =>
      api.get<{ entries: GandalfEntryDto[]; total: number }>(
        `/api/gandalf/categories/${categoryId}/entries?limit=${LIMIT}&offset=${(page - 1) * LIMIT}`
      ),
  });
  const entries = entriesData?.entries;
  const total = entriesData?.total ?? 0;
  const hasMore = page * LIMIT < total;

  const addMutation = useMutation({
    mutationFn: (data: CreateGandalfEntryRequest) =>
      api.post<GandalfEntryDto>("/api/gandalf/entries", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gandalf"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: UpdateGandalfEntryRequest & { id: number }) =>
      api.put<GandalfEntryDto>(`/api/gandalf/entries/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gandalf"] });
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (entryId: number) => api.del<void>(`/api/gandalf/entries/${entryId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gandalf"] });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setTitle("");
    setPrice("");
    setInfo("");
    setNextDate("");
    setIsImportant(false);
    setIsUrgent(false);
    setVisibility("tribe");
  };

  const startEdit = (entry: GandalfEntryDto) => {
    setEditingId(entry.id);
    setTitle(entry.title);
    setPrice(entry.price != null ? String(entry.price) : "");
    setInfo(entry.additionalInfo ?? "");
    setNextDate(entry.nextDate ? entry.nextDate.slice(0, 10) : "");
    setIsImportant(entry.isImportant);
    setIsUrgent(entry.isUrgent);
    setVisibility(entry.visibility ?? "tribe");
    setShowForm(true);
  };

  const handleDelete = (entryId: number, entryTitle: string) => {
    showConfirm(`Удалить "${entryTitle}"?`, (confirmed) => {
      if (confirmed) deleteMutation.mutate(entryId);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (editingId) {
      const updates: UpdateGandalfEntryRequest & { id: number } = { id: editingId };
      updates.title = title.trim();
      updates.price = price.trim() ? parseFloat(price) : null;
      updates.additionalInfo = info.trim() || null;
      updates.nextDate = nextDate || null;
      updates.isImportant = isImportant;
      updates.isUrgent = isUrgent;
      updates.visibility = visibility;
      updateMutation.mutate(updates);
    } else {
      const req: CreateGandalfEntryRequest = {
        categoryId,
        title: title.trim(),
      };
      if (price.trim()) req.price = parseFloat(price);
      if (info.trim()) req.additionalInfo = info.trim();
      if (nextDate) req.nextDate = nextDate;
      if (isImportant) req.isImportant = true;
      if (isUrgent) req.isUrgent = true;
      if (visibility !== "tribe") req.visibility = visibility;
      addMutation.mutate(req);
    }
  };

  const mutationPending = addMutation.isPending || updateMutation.isPending;
  const mutationError = addMutation.error || updateMutation.error;

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        К категориям
      </button>

      {isLoading && <div className="loading">Загрузка записей...</div>}

      {entries && entries.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">Нет записей в этой категории</div>
        </div>
      )}

      {entries && entries.length > 0 && (
        <>
          <div className="list">
            {entries.map((entry) => (
              <div key={entry.id} className="list-item">
                <div className="list-item-content">
                  <div className="list-item-title">
                    {entry.isImportant ? "⭐ " : ""}
                    {entry.isUrgent ? "🔥 " : ""}
                    {entry.title}
                  </div>
                  <div className="list-item-hint">
                    {entry.price != null ? `${entry.price.toLocaleString("ru-RU")} ₽ ` : ""}
                    {entry.nextDate ? `📅 ${entry.nextDate} ` : ""}
                    {entry.visibility === "private" ? "🔒 " : ""}
                    {entry.additionalInfo ?? ""}
                  </div>
                </div>
                <div className="list-item-actions">
                  <button
                    className="btn btn-icon"
                    onClick={() => startEdit(entry)}
                    title="Редактировать"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => handleDelete(entry.id, entry.title)}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button className="btn btn-small btn-primary" onClick={() => setPage((p) => p + 1)}>
                Загрузить ещё
              </button>
            </div>
          )}
        </>
      )}

      {!showForm ? (
        <button className="fab" onClick={() => setShowForm(true)}>+</button>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Название</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Название записи"
                  style={{ flex: 1 }}
                />
                <VoiceButton
                  mode="gandalf"
                  onResult={(transcript) => setTitle((prev) => prev ? `${prev} ${transcript}` : transcript)}
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Цена (необязательно)</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Следующая дата (необязательно)</label>
              <input
                className="input"
                type="date"
                value={nextDate}
                onChange={(e) => setNextDate(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Заметки (необязательно)</label>
              <textarea
                className="input"
                value={info}
                onChange={(e) => setInfo(e.target.value)}
                placeholder="Дополнительная информация"
                rows={2}
              />
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} />
                ⭐ Важное
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={isUrgent} onChange={(e) => setIsUrgent(e.target.checked)} />
                🔥 Срочное
              </label>
            </div>
            <div className="form-group">
              <label className="form-label">Видимость</label>
              <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as "tribe" | "private")}>
                <option value="tribe">Трайб</option>
                <option value="private">Личное</option>
              </select>
            </div>
            {mutationError && (
              <div className="error-msg">{(mutationError as Error).message}</div>
            )}
            <div className="form-row">
              <button type="button" className="btn" onClick={resetForm}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={mutationPending || !title.trim()}>
                {mutationPending ? "Сохранение..." : editingId ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
