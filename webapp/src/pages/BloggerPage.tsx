import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  BloggerChannelDto,
  BloggerPostDto,
  CreateBloggerChannelRequest,
  CreateBloggerPostRequest,
  UpdateBloggerChannelRequest,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

export function BloggerPage() {
  useClosingConfirmation();
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingChannelId, setEditingChannelId] = useState<number | null>(null);
  const [channelTitle, setChannelTitle] = useState("");
  const [channelUsername, setChannelUsername] = useState("");
  const [niche, setNiche] = useState("");
  const queryClient = useQueryClient();

  const { data: channels, isLoading, error } = useQuery({
    queryKey: ["blogger", "channels"],
    queryFn: () => api.get<BloggerChannelDto[]>("/api/blogger/channels"),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateBloggerChannelRequest) =>
      api.post<BloggerChannelDto>("/api/blogger/channels", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blogger", "channels"] });
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: UpdateBloggerChannelRequest & { id: number }) =>
      api.put<BloggerChannelDto>(`/api/blogger/channels/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blogger", "channels"] });
      resetForm();
    },
  });

  const deleteChannelMutation = useMutation({
    mutationFn: (id: number) =>
      api.del<void>(`/api/blogger/channels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blogger", "channels"] });
    },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditingChannelId(null);
    setChannelTitle("");
    setChannelUsername("");
    setNiche("");
  };

  const startEdit = (ch: BloggerChannelDto) => {
    setEditingChannelId(ch.id);
    setChannelTitle(ch.channelTitle);
    setChannelUsername(ch.channelUsername ?? "");
    setNiche(ch.nicheDescription ?? "");
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelTitle.trim()) return;

    if (editingChannelId) {
      updateMutation.mutate({
        id: editingChannelId,
        channelTitle: channelTitle.trim(),
        channelUsername: channelUsername.trim() || null,
        nicheDescription: niche.trim() || null,
      });
    } else {
      createMutation.mutate({
        channelTitle: channelTitle.trim(),
        channelUsername: channelUsername.trim() || undefined,
        nicheDescription: niche.trim() || undefined,
      });
    }
  };

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedChannelId !== null) {
    return <ChannelPosts channelId={selectedChannelId} onBack={() => setSelectedChannelId(null)} />;
  }

  const mutationPending = createMutation.isPending || updateMutation.isPending;
  const mutationError = createMutation.error || updateMutation.error;

  return (
    <div className="page">
      <h1 className="page-title">Блогер</h1>

      {channels && channels.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">✍️</div>
          <div className="empty-state-text">Нет каналов</div>
        </div>
      )}

      {channels && channels.length > 0 && (
        <div className="list">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className="list-item"
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <button
                style={{ cursor: "pointer", border: "none", flex: 1, textAlign: "left", background: "none", padding: 0 }}
                onClick={() => setSelectedChannelId(ch.id)}
              >
                <div className="list-item-content">
                  <div className="list-item-title">{ch.channelTitle}</div>
                  <div className="list-item-hint">
                    {ch.channelUsername ? `@${ch.channelUsername} / ` : ""}{ch.postCount} постов
                  </div>
                </div>
              </button>
              <div className="list-item-actions" style={{ display: "flex", gap: 4 }}>
                <button
                  className="btn btn-icon"
                  onClick={(e) => { e.stopPropagation(); startEdit(ch); }}
                  title="Редактировать"
                >
                  ✏️
                </button>
                <button
                  className="btn btn-icon btn-danger"
                  disabled={deleteChannelMutation.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Удалить канал?")) {
                      deleteChannelMutation.mutate(ch.id);
                    }
                  }}
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
              <label className="form-label">Название канала</label>
              <input className="input" value={channelTitle} onChange={(e) => setChannelTitle(e.target.value)} placeholder="Мой канал" />
            </div>
            <div className="form-group">
              <label className="form-label">Юзернейм (необязательно)</label>
              <input className="input" value={channelUsername} onChange={(e) => setChannelUsername(e.target.value)} placeholder="@username" />
            </div>
            <div className="form-group">
              <label className="form-label">Описание ниши (необязательно)</label>
              <textarea className="input" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="О чём этот канал?" rows={2} />
            </div>
            {mutationError && <div className="error-msg">{(mutationError as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={resetForm}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={mutationPending || !channelTitle.trim()}>
                {editingChannelId ? "Сохранить" : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && <button className="fab" onClick={() => setShowForm(true)}>+</button>}
    </div>
  );
}

function ChannelPosts({ channelId, onBack }: { channelId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");

  const { data: posts, isLoading } = useQuery({
    queryKey: ["blogger", "posts", channelId],
    queryFn: () => api.get<BloggerPostDto[]>(`/api/blogger/channels/${channelId}/posts`),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateBloggerPostRequest) =>
      api.post<BloggerPostDto>("/api/blogger/posts", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blogger", "posts", channelId] });
      setTopic("");
    },
  });

  const deletePostMutation = useMutation({
    mutationFn: (id: number) =>
      api.del<void>(`/api/blogger/posts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blogger", "posts", channelId] });
    },
  });

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>Назад</button>
      <h2 className="page-title">Посты</h2>

      <form
        style={{ marginBottom: 16 }}
        onSubmit={(e) => { e.preventDefault(); if (topic.trim()) createMutation.mutate({ channelId, topic: topic.trim() }); }}
      >
        <div className="form-group">
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Тема поста" />
        </div>
        {createMutation.error && <div className="error-msg">{(createMutation.error as Error).message}</div>}
        <button type="submit" className="btn btn-primary btn-block" disabled={createMutation.isPending || !topic.trim()}>
          {createMutation.isPending ? "Генерация..." : "Сгенерировать пост"}
        </button>
      </form>

      {isLoading && <div className="loading">Загрузка постов...</div>}

      {posts && posts.length === 0 && (
        <div className="empty-state"><div className="empty-state-text">Нет постов</div></div>
      )}

      {posts && posts.length > 0 && (
        <div className="list">
          {posts.map((p) => (
            <div key={p.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="card-title">{p.topic}</div>
                <button
                  className="btn btn-icon btn-danger"
                  disabled={deletePostMutation.isPending}
                  onClick={() => {
                    if (confirm("Удалить пост?")) {
                      deletePostMutation.mutate(p.id);
                    }
                  }}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
              <div className="card-hint" style={{ marginBottom: 6 }}>
                {p.status && <span className="badge">{p.status}</span>}
                {p.status && " \u00b7 "}{p.sourceCount} источников
                {p.generatedAt ? ` \u00b7 ${new Date(p.generatedAt).toLocaleDateString("ru-RU")}` : ""}
              </div>
              {p.generatedText && (
                <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {p.generatedText.length > 300
                    ? p.generatedText.slice(0, 300) + "..."
                    : p.generatedText}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
