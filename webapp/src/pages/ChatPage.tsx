import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import { useTelegram } from "../hooks/useTelegram";
import type {
  ChatDialogDto,
  ChatMessageDto,
  ChatProvider,
  SendChatMessageRequest,
  SendChatMessageResponse,
} from "@shared/types";

export function ChatPage() {
  const queryClient = useQueryClient();
  const { webApp } = useTelegram();
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
  const isFree = provider === "free";

  const handleToggleProvider = () => {
    const next = isFree ? "paid" : "free";
    toggleProviderMutation.mutate(next);
  };

  const deleteDialogMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/chat/dialogs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat", "dialogs"] });
    },
  });

  const handleDeleteDialog = (id: number, title: string) => {
    if (webApp) {
      webApp.showConfirm(`Удалить диалог "${title}"?`, (confirmed: boolean) => {
        if (confirmed) deleteDialogMutation.mutate(id);
      });
    } else {
      if (confirm(`Удалить диалог "${title}"?`)) deleteDialogMutation.mutate(id);
    }
  };

  if (selectedDialogId !== null) {
    return (
      <ChatDialog
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          marginBottom: 12,
          borderRadius: 12,
          background: "var(--tg-theme-secondary-bg-color, #f5f5f5)",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {isFree ? "🆓 Free" : "💎 Paid"}
          </div>
          <div style={{ fontSize: 12, color: "var(--tg-theme-hint-color, #999)", marginTop: 2 }}>
            {isFree ? "Бесплатная модель (rate-limited)" : "Платная модель (быстрее)"}
          </div>
        </div>
        <button
          className={`toggle ${!isFree ? "active" : ""}`}
          onClick={handleToggleProvider}
          disabled={toggleProviderMutation.isPending}
        />
      </div>

      <button
        className="btn btn-primary btn-block"
        style={{ marginBottom: 16 }}
        onClick={() => setSelectedDialogId(-1)}
      >
        Новый чат
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
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedDialogId(d.id)}
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isNewChat = dialogId === -1;
  const [activeDialogId, setActiveDialogId] = useState<number | null>(
    isNewChat ? null : dialogId
  );

  const { data: messages } = useQuery({
    queryKey: ["chat", "messages", activeDialogId],
    queryFn: () =>
      api.get<ChatMessageDto[]>(`/api/chat/dialogs/${activeDialogId}/messages`),
    enabled: activeDialogId !== null,
  });

  const sendMutation = useMutation({
    mutationFn: (data: SendChatMessageRequest) =>
      api.post<SendChatMessageResponse>("/api/chat/messages", data),
    onSuccess: (result) => {
      if (activeDialogId === null) {
        setActiveDialogId(result.dialogId);
      }
      queryClient.invalidateQueries({ queryKey: ["chat"] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendMutation.isPending]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendMutation.isPending) return;
    const req: SendChatMessageRequest = { content: input.trim() };
    if (activeDialogId !== null) {
      req.dialogId = activeDialogId;
    }
    sendMutation.mutate(req);
    setInput("");
  };

  return (
    <div className="page" style={{ paddingBottom: 70 }}>
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        Назад
      </button>

      <div className="chat-messages">
        {messages?.map((msg) => (
          <div key={msg.id} className={`chat-bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {sendMutation.isPending && (
          <div className="chat-bubble assistant">Думаю...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {sendMutation.error && (
        <div className="error-msg" style={{ margin: "8px 0" }}>
          {(sendMutation.error as Error).message}
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
          disabled={sendMutation.isPending || !input.trim()}
        >
          Отправить
        </button>
      </form>
    </div>
  );
}
