import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BroadcastResultDto, BroadcastScope, UserProfile } from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

const SCOPE_HINT: Record<BroadcastScope, string> = {
  tribe: "Сообщение получат все участники вашего трайба.",
  all: "Сообщение получат все одобренные пользователи бота.",
};

export function BroadcastPage() {
  useClosingConfirmation();
  const [text, setText] = useState("");
  const [scope, setScope] = useState<BroadcastScope>("tribe");

  const { data: profile } = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => api.get<UserProfile>("/api/user/me"),
  });
  const canBroadcastAll = profile?.isAdmin === true;

  const broadcastMutation = useMutation({
    mutationFn: (message: string) =>
      api.post<BroadcastResultDto>("/api/broadcast", { text: message, scope }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || broadcastMutation.isPending) return;
    broadcastMutation.mutate(text.trim());
  };

  return (
    <div className="page">
      <h1 className="page-title">Рассылка</h1>

      <form onSubmit={handleSubmit}>
        {canBroadcastAll && (
          <div className="form-group">
            <label className="form-label">Кому</label>
            <div className="tabs">
              <button
                type="button"
                className={`tab ${scope === "tribe" ? "active" : ""}`}
                onClick={() => setScope("tribe")}
              >
                👪 Мой трайб
              </button>
              <button
                type="button"
                className={`tab ${scope === "all" ? "active" : ""}`}
                onClick={() => setScope("all")}
              >
                🌍 Все пользователи
              </button>
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Текст сообщения</label>
          <textarea
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              scope === "all"
                ? "Введите текст рассылки для всех пользователей бота..."
                : "Введите текст рассылки для всех участников трайба..."
            }
            rows={5}
          />
          <div className="card-hint" style={{ marginTop: 6 }}>{SCOPE_HINT[scope]}</div>
        </div>

        {broadcastMutation.error && (
          <div className="error-msg">{(broadcastMutation.error as Error).message}</div>
        )}

        {broadcastMutation.isSuccess && broadcastMutation.data && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">Рассылка завершена</div>
            <div className="card-hint">
              {broadcastMutation.data.scope === "all" ? "Всем пользователям" : "Трайбу"} ·
              {" "}Отправлено: {broadcastMutation.data.sent} из {broadcastMutation.data.total}
              {broadcastMutation.data.failed > 0 && ` · Ошибки: ${broadcastMutation.data.failed}`}
            </div>
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={broadcastMutation.isPending || !text.trim()}
        >
          {broadcastMutation.isPending ? "Отправка..." : "Отправить рассылку"}
        </button>
      </form>
    </div>
  );
}
