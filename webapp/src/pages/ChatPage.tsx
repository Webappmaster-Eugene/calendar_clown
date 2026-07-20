import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import { useTelegram } from "../hooks/useTelegram";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import { MessageBubble } from "../components/ui/MessageBubble";
import type {
  ChatDialogDto,
  ChatMessageDto,
  ChatProvider,
  UpdateDialogRequest,
  OpenRouterModelDto,
} from "@shared/types";
import { CHAT_DIALOG_MESSAGE_LIMIT } from "@shared/constants";

export function ChatPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();
  const { showAlert, showConfirm } = useTelegram();
  const [selectedDialogId, setSelectedDialogId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  const { data: dialogs, isLoading, error } = useQuery({
    queryKey: ["chat", "dialogs"],
    queryFn: () => api.get<ChatDialogDto[]>("/api/chat/dialogs"),
  });

  const { data: providerData } = useQuery({
    queryKey: ["chat", "provider"],
    queryFn: () => api.get<{ provider: ChatProvider }>("/api/chat/provider"),
  });

  const toggleProviderMutation = useMutation({
    mutationFn: (p: ChatProvider) =>
      api.put<{ provider: ChatProvider }>("/api/chat/provider", { provider: p }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "provider"] });
    },
  });

  const provider = providerData?.provider ?? "free";

  const providerCycle: ChatProvider[] = ["free", "paid", "uncensored"];
  const handleToggleProvider = () => {
    const currentIdx = providerCycle.indexOf(provider);
    const next = providerCycle[(currentIdx + 1) % providerCycle.length];
    toggleProviderMutation.mutate(next);
  };

  const deleteDialogMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/chat/dialogs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "dialogs"] });
    },
  });

  const createDialogMutation = useMutation({
    mutationFn: () => api.post<ChatDialogDto>("/api/chat/dialogs"),
    onSuccess: (dialog) => {
      queryClient.invalidateQueries({ queryKey: ["chat", "dialogs"] });
      setSelectedDialogId(dialog.id);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Не удалось создать диалог";
      showAlert(msg);
    },
  });

  const renameDialogMutation = useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api.put<{ id: number; title: string }>(`/api/chat/dialogs/${id}`, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "dialogs"] });
      setEditingId(null);
      setEditingTitle("");
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Не удалось переименовать диалог";
      showAlert(msg);
    },
  });

  const handleDeleteDialog = (id: number, title: string) => {
    showConfirm(`Удалить диалог "${title}"?`, (confirmed) => {
      if (confirmed) deleteDialogMutation.mutate(id);
    });
  };

  const startEditing = (id: number, title: string) => {
    setEditingId(id);
    setEditingTitle(title);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingTitle("");
  };

  const saveEditing = (id: number) => {
    const title = editingTitle.trim();
    if (!title || renameDialogMutation.isPending) return;
    renameDialogMutation.mutate({ id, title: title.slice(0, 100) });
  };

  if (selectedDialogId !== null) {
    return (
      <ChatDialog
        key={selectedDialogId}
        dialogId={selectedDialogId}
        onBack={() => setSelectedDialogId(null)}
      />
    );
  }

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">AI Чат</h1>

      <button
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          marginBottom: 12,
          borderRadius: 12,
          background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
          border: "none",
          width: "100%",
          cursor: "pointer",
          textAlign: "left",
          color: "inherit",
        }}
        onClick={handleToggleProvider}
        disabled={toggleProviderMutation.isPending}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {{ free: "🆓 Free", paid: "💎 Paid", uncensored: "🔥 Без цензуры" }[provider]}
          </div>
          <div style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #999)", marginTop: 2 }}>
            {{ free: "Бесплатная модель (rate-limited)", paid: "Платная модель (быстрее)", uncensored: "Модель без ограничений контента" }[provider]}
          </div>
        </div>
        <span style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #999)" }}>▶</span>
      </button>

      <button
        className="btn btn-primary btn-block"
        style={{ marginBottom: 16 }}
        onClick={() => createDialogMutation.mutate()}
        disabled={createDialogMutation.isPending}
      >
        {createDialogMutation.isPending ? "Создание..." : "Новый чат"}
      </button>

      {dialogs && dialogs.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-emoji">🧠</div>
          <div className="empty-state-text">Нет диалогов. Начните новый чат.</div>
        </div>
      )}

      {dialogs && dialogs.length > 0 && (
        <div className="list">
          {dialogs.map((d) => (
            <div key={d.id} className="list-item">
              {editingId === d.id ? (
                <>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={editingTitle}
                    maxLength={100}
                    autoFocus
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditing(d.id);
                      if (e.key === "Escape") cancelEditing();
                    }}
                  />
                  <div className="list-item-actions">
                    <button
                      className="btn btn-icon"
                      onClick={() => saveEditing(d.id)}
                      disabled={!editingTitle.trim() || renameDialogMutation.isPending}
                      title="Сохранить"
                    >
                      ✅
                    </button>
                    <button
                      className="btn btn-icon"
                      onClick={cancelEditing}
                      disabled={renameDialogMutation.isPending}
                      title="Отмена"
                    >
                      ❌
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div
                    className="list-item-content"
                    style={{ cursor: createDialogMutation.isPending ? "default" : "pointer", opacity: createDialogMutation.isPending ? 0.6 : 1 }}
                    onClick={() => { if (!createDialogMutation.isPending) setSelectedDialogId(d.id); }}
                  >
                    <div className="list-item-title">{d.title}</div>
                    <div className="list-item-hint">
                      {d.messageCount ?? 0} сообщений &middot; {new Date(d.updatedAt).toLocaleDateString("ru-RU")}
                    </div>
                  </div>
                  <div className="list-item-actions">
                    <button
                      className="btn btn-icon"
                      onClick={() => startEditing(d.id, d.title)}
                      title="Переименовать"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-icon btn-danger"
                      onClick={() => handleDeleteDialog(d.id, d.title)}
                      title="Удалить"
                    >
                      🗑️
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatDialog({ dialogId, onBack }: { dialogId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({
    queryKey: ["chat", "messages", dialogId],
    queryFn: () =>
      api.get<ChatMessageDto[]>(`/api/chat/dialogs/${dialogId}/messages`),
  });

  // The dialog's own settings live in the shared dialogs list (same query key →
  // deduped). Re-read after a settings PUT invalidates it.
  const { data: dialogs } = useQuery({
    queryKey: ["chat", "dialogs"],
    queryFn: () => api.get<ChatDialogDto[]>("/api/chat/dialogs"),
  });
  const dialog = dialogs?.find((d) => d.id === dialogId) ?? null;
  const [showSettings, setShowSettings] = useState(false);

  // Per-dialog message cap: once reached, writing is blocked (start a new chat).
  // dialog.messageCount is the authoritative total; messages.length is a fallback.
  const msgCount = dialog?.messageCount ?? messages?.length ?? 0;
  const atLimit = msgCount >= CHAT_DIALOG_MESSAGE_LIMIT;

  const updateSettings = useMutation({
    mutationFn: (patch: UpdateDialogRequest) =>
      api.put<ChatDialogDto>(`/api/chat/dialogs/${dialogId}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "dialogs"] });
      setShowSettings(false);
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, isSending]);

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending || atLimit) return;

    setInput("");
    setError(null);
    setStreamingContent("");
    setPendingUserMessage(text);
    setIsSending(true);

    try {
      await api.stream(
        "/api/chat/messages/stream",
        {
          content: text,
          dialogId,
        },
        (chunk) => {
          setStreamingContent((prev) => prev + chunk);
        }
      );

      // Wait for messages to be refetched before clearing optimistic state
      // This prevents a visual flash where messages disappear briefly
      await queryClient.invalidateQueries({ queryKey: ["chat", "messages", dialogId] });
      queryClient.invalidateQueries({ queryKey: ["chat", "dialogs"] });
      setStreamingContent("");
      setPendingUserMessage(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка отправки");
      setPendingUserMessage(null);
      // Refresh dialog list and messages on error too
      queryClient.invalidateQueries({ queryKey: ["chat", "dialogs"] });
      queryClient.invalidateQueries({ queryKey: ["chat", "messages", dialogId] });
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, atLimit, dialogId, queryClient]);

  // Combine server messages with the current user input + streaming response
  const displayMessages = messages ?? [];

  return (
    <div className="page" style={{ paddingBottom: 70 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <button className="btn btn-small" onClick={onBack}>Назад</button>
        <button className="btn btn-small" onClick={() => setShowSettings((s) => !s)}>
          ⚙️ {showSettings ? "Скрыть" : "Настройки"}
        </button>
      </div>

      {/* Applied model / settings summary */}
      {dialog && (
        <div className="card-hint" style={{ marginBottom: 8, fontSize: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <span>🤖 {dialog.model ?? "по умолчанию"}</span>
          {dialog.temperature != null && <span>🌡 {dialog.temperature}</span>}
          {dialog.maxTokens != null && <span>✂️ {dialog.maxTokens}т</span>}
          {dialog.systemPrompt && <span title={dialog.systemPrompt}>📝 промпт</span>}
          {dialog.theme && <span>🏷 {dialog.theme}</span>}
        </div>
      )}

      {showSettings && dialog && (
        <DialogSettings
          dialog={dialog}
          onSave={(patch) => updateSettings.mutate(patch)}
          saving={updateSettings.isPending}
          error={updateSettings.error ? (updateSettings.error as Error).message : null}
          onClose={() => setShowSettings(false)}
        />
      )}

      <div className="chat-messages" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {displayMessages.map((msg) => (
          <MessageBubble
            key={msg.id}
            role={msg.role === "user" ? "user" : "assistant"}
            content={msg.content}
            markdown={msg.role !== "user"}
            actions={msg.role !== "user" ? ["copy", "share"] : undefined}
          />
        ))}
        {pendingUserMessage && (
          <MessageBubble role="user" markdown={false} content={pendingUserMessage} />
        )}
        {isSending && !streamingContent && (
          <MessageBubble role="assistant" pending content="" />
        )}
        {streamingContent && (
          <MessageBubble
            role="assistant"
            markdown
            content={streamingContent}
            actions={["copy", "share"]}
          />
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="error-msg" style={{ margin: "8px 0" }}>
          {error}
        </div>
      )}

      {atLimit ? (
        <div className="card" style={{ textAlign: "center" }}>
          <div className="card-title">Достигнут лимит {CHAT_DIALOG_MESSAGE_LIMIT} сообщений</div>
          <div className="card-hint" style={{ marginBottom: 10 }}>
            Чтобы весь диалог помещался в контекст, писать сюда больше нельзя. Создайте новый чат.
          </div>
          <button className="btn btn-primary btn-block" onClick={onBack}>← К списку чатов</button>
        </div>
      ) : (
        <form className="chat-input-row" onSubmit={handleSend}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Введите сообщение..."
          />
          <VoiceButton
            mode="neuro"
            onResult={(transcript) => setInput((prev) => prev ? `${prev} ${transcript}` : transcript)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSending || !input.trim()}
          >
            Отправить
          </button>
        </form>
      )}

      {!atLimit && msgCount >= CHAT_DIALOG_MESSAGE_LIMIT - 6 && (
        <div className="card-hint" style={{ textAlign: "center", marginTop: 6, fontSize: 12 }}>
          Сообщений: {msgCount}/{CHAT_DIALOG_MESSAGE_LIMIT}
        </div>
      )}
    </div>
  );
}

// ─── Dialog settings (title + per-dialog AI overrides) ───────────

function DialogSettings({
  dialog,
  onSave,
  saving,
  error,
  onClose,
}: {
  dialog: ChatDialogDto;
  onSave: (patch: UpdateDialogRequest) => void;
  saving: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(dialog.title);
  const [theme, setTheme] = useState(dialog.theme ?? "");
  const [model, setModel] = useState<string | null>(dialog.model);
  const [systemPrompt, setSystemPrompt] = useState(dialog.systemPrompt ?? "");
  const [temperature, setTemperature] = useState(dialog.temperature != null ? String(dialog.temperature) : "");
  const [maxTokens, setMaxTokens] = useState(dialog.maxTokens != null ? String(dialog.maxTokens) : "");
  const [pickerOpen, setPickerOpen] = useState(false);

  const save = () => {
    const patch: UpdateDialogRequest = {};
    const t = title.trim();
    if (t && t !== dialog.title) patch.title = t;
    const th = theme.trim();
    if (th !== (dialog.theme ?? "")) patch.theme = th || null;
    if (model !== dialog.model) patch.model = model;
    const sp = systemPrompt.trim();
    if (sp !== (dialog.systemPrompt ?? "")) patch.systemPrompt = sp || null;
    const temp = temperature.trim() === "" ? null : Number(temperature);
    if (!(temp != null && Number.isNaN(temp)) && temp !== dialog.temperature) patch.temperature = temp;
    const mt = maxTokens.trim() === "" ? null : parseInt(maxTokens, 10);
    if (!(mt != null && Number.isNaN(mt)) && mt !== dialog.maxTokens) patch.maxTokens = mt;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    onSave(patch);
  };

  return (
    <div className="card" style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Название</label>
        <input className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Тема / описание</label>
        <input className="input" value={theme} maxLength={200} placeholder="напр. Код на Python" onChange={(e) => setTheme(e.target.value)} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Нейросеть</label>
        <button type="button" className="btn btn-block" style={{ textAlign: "left" }} onClick={() => setPickerOpen(true)}>
          🤖 {model ?? "По умолчанию (провайдер)"}
        </button>
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Системный промпт (роль/инструкции)</label>
        <textarea className="input" rows={3} value={systemPrompt} placeholder="Ты — ... (пусто = по умолчанию)" onChange={(e) => setSystemPrompt(e.target.value)} />
      </div>
      <div className="form-row">
        <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
          <label className="form-label">Температура (0–2)</label>
          <input className="input" type="number" step="0.1" min="0" max="2" value={temperature} placeholder="авто" onChange={(e) => setTemperature(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
          <label className="form-label">Макс. токенов</label>
          <input className="input" type="number" min="1" value={maxTokens} placeholder="без лимита" onChange={(e) => setMaxTokens(e.target.value)} />
        </div>
      </div>
      {error && <div className="error-msg">{error}</div>}
      <div className="form-row">
        <button type="button" className="btn" onClick={onClose} disabled={saving}>Отмена</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button>
      </div>
      {pickerOpen && (
        <ModelPicker
          current={model}
          onSelect={(id) => { setModel(id); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

// ─── OpenRouter model picker (searchable bottom sheet) ───────────

function ModelPicker({
  current,
  onSelect,
  onClose,
}: {
  current: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [freeOnly, setFreeOnly] = useState(false);
  const [vendor, setVendor] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: vendors } = useQuery({
    queryKey: ["chat", "models", "vendors"],
    queryFn: () => api.get<string[]>("/api/chat/models/vendors"),
    staleTime: 30 * 60 * 1000,
  });

  const { data: models, isLoading } = useQuery({
    queryKey: ["chat", "models", debouncedQ, freeOnly, vendor],
    queryFn: () => {
      const p = new URLSearchParams({ search: debouncedQ });
      if (freeOnly) p.set("free", "1");
      if (vendor) p.set("vendor", vendor);
      return api.get<OpenRouterModelDto[]>(`/api/chat/models?${p.toString()}`);
    },
    staleTime: 5 * 60 * 1000,
  });

  const perM = (p: number | null) => (p == null ? "" : `$${(p * 1_000_000).toFixed(2)}/1M`);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 200, display: "flex", alignItems: "flex-end" }} onClick={onClose}>
      <div className="card" style={{ width: "100%", maxHeight: "82vh", overflowY: "auto", borderRadius: "16px 16px 0 0" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="card-title">Выбор нейросети</div>
          <button className="btn btn-small" onClick={onClose}>✕</button>
        </div>
        <input className="input" placeholder="Поиск: gpt, claude, gemini, deepseek…" value={q} autoFocus onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className={`btn btn-small${freeOnly ? " btn-primary" : ""}`}
            onClick={() => setFreeOnly((v) => !v)}
          >
            🆓 Бесплатные
          </button>
          <select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} style={{ flex: 1 }}>
            <option value="">Все вендоры</option>
            {vendors?.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <button type="button" className="list-item" style={{ width: "100%", textAlign: "left" }} onClick={() => onSelect(null)}>
          <div className="list-item-content">
            <div className="list-item-title">По умолчанию (глобальный провайдер){current == null ? " ✓" : ""}</div>
            <div className="list-item-hint">Модель из тоггла Free/Paid/Без цензуры</div>
          </div>
        </button>
        {isLoading && <div className="card-hint" style={{ padding: 8 }}>Загрузка каталога…</div>}
        {models?.map((m) => (
          <button key={m.id} type="button" className="list-item" style={{ width: "100%", textAlign: "left", background: m.id === current ? "var(--tg-theme-secondary-bg-color, #eee)" : undefined }} onClick={() => onSelect(m.id)}>
            <div className="list-item-content">
              <div className="list-item-title">{m.name}{m.isFree ? " 🆓" : ""}{m.id === current ? " ✓" : ""}</div>
              <div className="list-item-hint">
                {m.id}{m.contextLength ? ` · ctx ${(m.contextLength / 1000).toFixed(0)}k` : ""}{m.promptPrice != null && !m.isFree ? ` · ${perM(m.promptPrice)}` : ""}
              </div>
            </div>
          </button>
        ))}
        {models && models.length === 0 && !isLoading && <div className="card-hint" style={{ padding: 8 }}>Ничего не найдено</div>}
      </div>
    </div>
  );
}
