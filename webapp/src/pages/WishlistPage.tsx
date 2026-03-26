import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  WishlistDto,
  WishlistItemDto,
  WishlistsListResponse,
  CreateWishlistRequest,
  CreateWishlistItemRequest,
  UpdateWishlistItemRequest,
} from "@shared/types";

type WishlistTab = "own" | "tribe";

export function WishlistPage() {
  const [tab, setTab] = useState<WishlistTab>("own");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const { data: wishlistData, isLoading, error } = useQuery({
    queryKey: ["wishlists"],
    queryFn: () => api.get<WishlistsListResponse>("/api/wishlist"),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateWishlistRequest) =>
      api.post<WishlistDto>("/api/wishlist", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlists"] });
      setShowForm(false);
      setName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/wishlist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlists"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedId !== null) {
    return <WishlistItems wishlistId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  const wishlists = tab === "own"
    ? (wishlistData?.own ?? [])
    : (wishlistData?.tribe ?? []);

  return (
    <div className="page">
      <h1 className="page-title">Списки желаний</h1>

      <div className="tabs">
        <button
          className={`tab ${tab === "own" ? "active" : ""}`}
          onClick={() => setTab("own")}
        >
          Мои списки
        </button>
        <button
          className={`tab ${tab === "tribe" ? "active" : ""}`}
          onClick={() => setTab("tribe")}
        >
          Семейные
        </button>
      </div>

      {wishlists.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎁</div>
          <div className="empty-state-text">
            {tab === "own" ? "Нет ваших списков желаний" : "Нет семейных списков"}
          </div>
        </div>
      )}

      {wishlists.length > 0 && (
        <div className="list">
          {wishlists.map((w) => (
            <div key={w.id} className="list-item" style={{ display: "flex", alignItems: "center" }}>
              <button
                style={{ cursor: "pointer", border: "none", background: "none", flex: 1, textAlign: "left", display: "flex", alignItems: "center", gap: 8, padding: 0 }}
                onClick={() => setSelectedId(w.id)}
              >
                <span className="list-item-emoji">{w.emoji || "🎁"}</span>
                <div className="list-item-content">
                  <div className="list-item-title">{w.name}</div>
                  <div className="list-item-hint">
                    {w.ownerName} · {w.itemCount} элементов
                  </div>
                </div>
              </button>
              {w.isOwn && (
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => deleteMutation.mutate(w.id)}
                  disabled={deleteMutation.isPending}
                  title="Удалить"
                >
                  🗑️
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) createMutation.mutate({ name: name.trim() }); }}>
            <div className="form-group">
              <label className="form-label">Название списка</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Мой список желаний" />
            </div>
            {createMutation.error && <div className="error-msg">{(createMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending || !name.trim()}>Создать</button>
            </div>
          </form>
        </div>
      )}

      {!showForm && tab === "own" && <button className="fab" onClick={() => setShowForm(true)}>+</button>}
    </div>
  );
}

function WishlistItems({ wishlistId, onBack }: { wishlistId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ["wishlist", "items", wishlistId],
    queryFn: () =>
      api.get<{ items: WishlistItemDto[]; total: number; wishlistName: string }>(
        `/api/wishlist/${wishlistId}/items`
      ),
  });
  const items = itemsData?.items;
  const wishlistName = itemsData?.wishlistName;

  const addMutation = useMutation({
    mutationFn: (data: CreateWishlistItemRequest) =>
      api.post<WishlistItemDto>(`/api/wishlist/${wishlistId}/items`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist", "items", wishlistId] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ itemId, ...data }: UpdateWishlistItemRequest & { itemId: number }) =>
      api.put<WishlistItemDto>(`/api/wishlist/items/${itemId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist", "items", wishlistId] });
      resetForm();
    },
  });

  const reserveMutation = useMutation({
    mutationFn: (itemId: number) =>
      api.put<WishlistItemDto>(`/api/wishlist/items/${itemId}/reserve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist", "items", wishlistId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: number) =>
      api.del<void>(`/api/wishlist/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist", "items", wishlistId] });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingItemId(null);
    setTitle("");
    setLink("");
  };

  const startEdit = (item: WishlistItemDto) => {
    setEditingItemId(item.id);
    setTitle(item.title);
    setLink(item.link ?? "");
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    if (editingItemId) {
      updateMutation.mutate({
        itemId: editingItemId,
        title: title.trim(),
        link: link.trim() || null,
      });
    } else {
      addMutation.mutate({
        wishlistId,
        title: title.trim(),
        link: link.trim() || undefined,
      });
    }
  };

  const mutationPending = addMutation.isPending || updateMutation.isPending;
  const mutationError = addMutation.error || updateMutation.error;

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>Назад</button>
      {wishlistName && <h2 className="page-title" style={{ fontSize: 18, marginBottom: 12 }}>{wishlistName}</h2>}

      {isLoading && <div className="loading">Загрузка элементов...</div>}

      {items && items.length === 0 && (
        <div className="empty-state"><div className="empty-state-text">Нет элементов</div></div>
      )}

      {items && items.length > 0 && (
        <div className="list">
          {items.map((item) => (
            <div key={item.id} className="list-item">
              <div className="list-item-content">
                <div className="list-item-title">{item.title}</div>
                <div className="list-item-hint">
                  {item.isReserved ? `Забронировал ${item.reservedByName}` : "Свободно"}
                  {item.link ? " / есть ссылка" : ""}
                </div>
              </div>
              <div className="list-item-actions">
                {(item.canUnreserve || !item.isReserved) && (
                  <button
                    className={`btn btn-small ${item.isReserved ? "" : "btn-primary"}`}
                    onClick={() => reserveMutation.mutate(item.id)}
                  >
                    {item.isReserved ? "Снять" : "Бронь"}
                  </button>
                )}
                <button
                  className="btn btn-icon"
                  onClick={() => startEdit(item)}
                  title="Редактировать"
                >
                  ✏️
                </button>
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => deleteMutation.mutate(item.id)}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Название</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название элемента" />
            </div>
            <div className="form-group">
              <label className="form-label">Ссылка (необязательно)</label>
              <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
            </div>
            {mutationError && <div className="error-msg">{(mutationError as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={resetForm}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={mutationPending || !title.trim()}>
                {editingItemId ? "Сохранить" : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && <button className="fab" onClick={() => setShowForm(true)}>+</button>}
    </div>
  );
}
