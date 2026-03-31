import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import { useTelegram } from "../hooks/useTelegram";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import type {
  ChatDialogDto,
  ChatMessageDto,
  ChatProvider,
} from "@shared/types";

export function ChatPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();
  const { showAlert, showConfirm } = useTelegram();
  const [selectedDialogId, setSelectedDialogId] = useState<number | null>(null);

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

  const handleDeleteDialog = (id: number, title: string) => {
    showConfirm(`Удалить диалог "${title}"?`, (confirmed) => {
      if (confirmed) deleteDialogMutation.mutate(id);
    });
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
                  className="btn btn-icon btn-danger"
                  onClick={() => handleDeleteDialog(d.id, d.title)}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, isSending]);

  const handleSend = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

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
  }, [input, isSending, dialogId, queryClient]);

  // Combine server messages with the current user input + streaming response
  const displayMessages = messages ?? [];

  return (
    <div className="page" style={{ paddingBottom: 70 }}>
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        Назад
      </button>

      <div className="chat-messages">
        {displayMessages.map((msg) => (
          <div key={msg.id} className={`chat-bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {pendingUserMessage && (
          <div className="chat-bubble user">
            {pendingUserMessage}
          </div>
        )}
        {isSending && !streamingContent && (
          <div className="chat-bubble assistant" style={{ opacity: 0.6 }}>
            ...
          </div>
        )}
        {streamingContent && (
          <div className="chat-bubble assistant">
            {streamingContent}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && (
        <div className="error-msg" style={{ margin: "8px 0" }}>
          {error}
        </div>
      )}

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
    </div>
  );
}
