import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import type { BroadcastResultDto } from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

export function BroadcastPage() {
  useClosingConfirmation();
  const [text, setText] = useState("");

  const broadcastMutation = useMutation({
    mutationFn: (message: string) =>
      api.post<BroadcastResultDto>("/api/broadcast", { text: message }),
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
        <div className="form-group">
          <label className="form-label">Текст сообщения</label>
          <textarea
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Введите текст рассылки для всех участников трайба..."
            rows={5}
          />
        </div>

        {broadcastMutation.error && (
          <div className="error-msg">{(broadcastMutation.error as Error).message}</div>
        )}

        {broadcastMutation.isSuccess && broadcastMutation.data && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-title">Рассылка завершена</div>
            <div className="card-hint">
              Отправлено: {broadcastMutation.data.sent} / Ошибки: {broadcastMutation.data.failed}
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
