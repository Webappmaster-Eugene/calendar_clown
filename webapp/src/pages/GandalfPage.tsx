import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  GandalfCategoryDto,
  GandalfEntryDto,
  CreateGandalfEntryRequest,
} from "@shared/types";

export function GandalfPage() {
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const { data: categories, isLoading, error } = useQuery({
    queryKey: ["gandalf", "categories"],
    queryFn: () => api.get<GandalfCategoryDto[]>("/api/gandalf/categories"),
  });

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

  return (
    <div className="page">
      <h1 className="page-title">База знаний</h1>

      {categories && categories.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-emoji">🧙</div>
          <div className="empty-state-text">Нет категорий</div>
        </div>
      ) : (
        <div className="list">
          {categories?.map((cat) => (
            <button
              key={cat.id}
              className="list-item"
              style={{ cursor: "pointer", border: "none", width: "100%", textAlign: "left" }}
              onClick={() => setSelectedCategoryId(cat.id)}
            >
              <span className="list-item-emoji">{cat.emoji}</span>
              <div className="list-item-content">
                <div className="list-item-title">{cat.name}</div>
                <div className="list-item-hint">
                  {cat.totalEntries ?? 0} записей
                  {cat.totalPrice != null ? ` / ${cat.totalPrice.toLocaleString("ru-RU")}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
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
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [info, setInfo] = useState("");

  const { data: entries, isLoading } = useQuery({
    queryKey: ["gandalf", "entries", categoryId],
    queryFn: () =>
      api.get<GandalfEntryDto[]>(`/api/gandalf/categories/${categoryId}/entries`),
  });

  const addMutation = useMutation({
    mutationFn: (data: CreateGandalfEntryRequest) =>
      api.post<GandalfEntryDto>("/api/gandalf/entries", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gandalf"] });
      setShowForm(false);
      setTitle("");
      setPrice("");
      setInfo("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const req: CreateGandalfEntryRequest = {
      categoryId,
      title: title.trim(),
    };
    if (price.trim()) req.price = parseFloat(price);
    if (info.trim()) req.additionalInfo = info.trim();
    addMutation.mutate(req);
  };

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
        <div className="list">
          {entries.map((entry) => (
            <div key={entry.id} className="list-item">
              <div className="list-item-content">
                <div className="list-item-title">
                  {entry.isImportant ? "! " : ""}
                  {entry.title}
                </div>
                <div className="list-item-hint">
                  {entry.price != null ? `${entry.price.toLocaleString("ru-RU")} ` : ""}
                  {entry.additionalInfo ?? ""}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <button className="fab" onClick={() => setShowForm(true)}>+</button>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Название</label>
              <input
                className="input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Название записи"
              />
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
              <label className="form-label">Заметки (необязательно)</label>
              <textarea
                className="input"
                value={info}
                onChange={(e) => setInfo(e.target.value)}
                placeholder="Дополнительная информация"
                rows={2}
              />
            </div>
            {addMutation.error && (
              <div className="error-msg">{(addMutation.error as Error).message}</div>
            )}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={addMutation.isPending || !title.trim()}>
                {addMutation.isPending ? "Добавление..." : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
