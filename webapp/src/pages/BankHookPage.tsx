import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { CopyButton } from "../components/ui/CopyButton";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

interface BankHookData {
  url: string;
}

const PACKAGE_NAME = "com.idamob.tinkoff.android";
const PUSH_BODY = '{"title":"[notification_title]","text":"[notification_text]"}';

/**
 * Bank push-notification webhook setup page.
 * Shows the user's personal webhook URL and the phone-side (MacroDroid/Tasker) steps
 * for auto-importing T-Bank card spends. Mirrors the /bankhook bot command.
 */
export function BankHookPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["bankhook"],
    queryFn: () => api.get<BankHookData>("/api/bankhook"),
  });

  const regenerate = useMutation({
    mutationFn: () => api.post<BankHookData>("/api/bankhook/regenerate"),
    onSuccess: (fresh) => {
      queryClient.setQueryData(["bankhook"], fresh);
    },
  });

  const url = data?.url ?? "";

  return (
    <div className="page">
      <h1 className="page-title">Траты из Т-Банка</h1>

      <p style={{ color: "var(--tg-theme-hint-color)", marginTop: 0 }}>
        Пересылайте пуш-уведомления Т-Банка боту — покупки будут записываться в расходы
        автоматически и раскладываться по категориям.
      </p>

      {isLoading && <p>Загрузка…</p>}
      {error && <p style={{ color: "#e53935" }}>Не удалось получить адрес вебхука.</p>}

      {url && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: 10,
              borderRadius: 10,
              border: "1px solid var(--tg-theme-hint-color, #ccc)",
              background: "var(--tg-theme-secondary-bg-color, #f4f4f5)",
              marginBottom: 8,
            }}
          >
            <code
              style={{
                flex: 1,
                fontSize: 12,
                wordBreak: "break-all",
                userSelect: "all",
              }}
            >
              {url}
            </code>
            <CopyButton text={url} size="sm" />
          </div>

          <button
            className="btn"
            onClick={() => {
              if (confirm("Старый адрес перестанет работать. Продолжить?")) {
                regenerate.mutate();
              }
            }}
            disabled={regenerate.isPending}
            style={{ marginBottom: 20 }}
          >
            {regenerate.isPending ? "Обновляю…" : "🔄 Перегенерировать секрет"}
          </button>

          <h3 style={{ marginBottom: 8 }}>Как настроить (Android)</h3>
          <ol style={{ paddingLeft: 20, lineHeight: 1.5 }}>
            <li>Установите <b>MacroDroid</b> (или Tasker).</li>
            <li>Разрешите приложению доступ к уведомлениям.</li>
            <li>
              Триггер: <b>Уведомление получено</b> → приложение «Т‑Банк» (пакет{" "}
              <code>{PACKAGE_NAME}</code>).
            </li>
            <li>
              Действие: <b>HTTP‑запрос (POST)</b> на адрес выше, тело JSON:
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <code style={{ flex: 1, fontSize: 12, wordBreak: "break-all" }}>
                  {PUSH_BODY}
                </code>
                <CopyButton text={PUSH_BODY} size="sm" />
              </div>
            </li>
            <li>Готово — покупки появятся в разделе «Расходы», каждую можно поправить.</li>
          </ol>

          <p style={{ color: "var(--tg-theme-hint-color)", fontSize: 13 }}>
            ⚠️ Работает только на Android. Адрес секретный — не публикуйте его.
          </p>
        </>
      )}
    </div>
  );
}
