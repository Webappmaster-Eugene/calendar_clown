import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  WishlistDto,
  WishlistItemDto,
  CreateWishlistRequest,
  CreateWishlistItemRequest,
} from "@shared/types";

export function WishlistPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const { data: wishlists, isLoading, error } = useQuery({
    queryKey: ["wishlists"],
    queryFn: () => api.get<WishlistDto[]>("/api/wishlist"),
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

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedId !== null) {
    return <WishlistItems wishlistId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="page">
      <h1 className="page-title">Списки желаний</h1>

      {wishlists && wishlists.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎁</div>
          <div className="empty-state-text">Нет списков желаний</div>
        </div>
      )}

      {wishlists && wishlists.length > 0 && (
        <div className="list">
          {wishlists.map((w) => (
            <button
              key={w.id}
              className="list-item"
              style={{ cursor: "pointer", border: "none", width: "100%", textAlign: "left" }}
              onClick={() => setSelectedId(w.id)}
            >
              <span className="list-item-emoji">{w.emoji || "🎁"}</span>
              <div className="list-item-content">
                <div className="list-item-title">{w.name}</div>
                <div className="list-item-hint">
                  {w.ownerName} &middot; {w.itemCount} элементов
                </div>
              </div>
            </button>
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

      {!showForm && <button className="fab" onClick={() => setShowForm(true)}>+</button>}
    </div>
  );
}

function WishlistItems({ wishlistId, onBack }: { wishlistId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");

  const { data: items, isLoading } = useQuery({
    queryKey: ["wishlist", "items", wishlistId],
    queryFn: () => api.get<WishlistItemDto[]>(`/api/wishlist/${wishlistId}/items`),
  });

  const addMutation = useMutation({
    mutationFn: (data: CreateWishlistItemRequest) =>
      api.post<WishlistItemDto>(`/api/wishlist/${wishlistId}/items`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wishlist", "items", wishlistId] });
      setShowForm(false);
      setTitle("");
      setLink("");
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

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>Назад</button>

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
                  className="btn btn-danger btn-small"
                  onClick={() => deleteMutation.mutate(item.id)}
                >
                  Уд.
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) addMutation.mutate({ wishlistId, title: title.trim(), link: link.trim() || undefined });
          }}>
            <div className="form-group">
              <label className="form-label">Название</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название элемента" />
            </div>
            <div className="form-group">
              <label className="form-label">Ссылка (необязательно)</label>
              <input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
            </div>
            {addMutation.error && <div className="error-msg">{(addMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={addMutation.isPending || !title.trim()}>Добавить</button>
            </div>
          </form>
        </div>
      )}

      {!showForm && <button className="fab" onClick={() => setShowForm(true)}>+</button>}
    </div>
  );
}
