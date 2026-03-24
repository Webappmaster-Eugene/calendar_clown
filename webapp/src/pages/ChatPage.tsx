import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  ChatDialogDto,
  ChatMessageDto,
  SendChatMessageRequest,
  SendChatMessageResponse,
} from "@shared/types";

export function ChatPage() {
  const [selectedDialogId, setSelectedDialogId] = useState<number | null>(null);

  const { data: dialogs, isLoading, error } = useQuery({
    queryKey: ["chat", "dialogs"],
    queryFn: () => api.get<ChatDialogDto[]>("/api/chat/dialogs"),
  });

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
            <button
              key={d.id}
              className="list-item"
              style={{ cursor: "pointer", border: "none", width: "100%", textAlign: "left" }}
              onClick={() => setSelectedDialogId(d.id)}
            >
              <div className="list-item-content">
                <div className="list-item-title">{d.title}</div>
                <div className="list-item-hint">
                  {d.messageCount ?? 0} сообщений &middot; {new Date(d.updatedAt).toLocaleDateString("ru-RU")}
                </div>
              </div>
            </button>
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
