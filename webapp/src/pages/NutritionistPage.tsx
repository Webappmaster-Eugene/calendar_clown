import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  NutritionistHistoryResponse,
  NutritionAnalysisDto,
  NutritionDailySummaryDto,
  NutritionFoodItemDto,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

const PAGE_SIZE = 10;

export function NutritionistPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [lastResult, setLastResult] = useState<NutritionAnalysisDto | null>(null);
  const [offset, setOffset] = useState(0);

  const { data: historyData, isLoading } = useQuery({
    queryKey: ["nutritionist", offset],
    queryFn: () => api.get<NutritionistHistoryResponse>(
      `/api/nutritionist?limit=${PAGE_SIZE}&offset=${offset}`
    ),
  });

  const { data: dailySummary } = useQuery({
    queryKey: ["nutritionist-daily"],
    queryFn: () => api.get<NutritionDailySummaryDto>("/api/nutritionist/daily"),
  });

  const analyses = historyData?.analyses ?? [];
  const total = historyData?.total ?? 0;

  const analyzeMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("image", file);
      if (caption.trim()) formData.append("caption", caption.trim());
      return api.upload<NutritionAnalysisDto>("/api/nutritionist/analyze", formData);
    },
    onSuccess: (data) => {
      setLastResult(data);
      setCaption("");
      setOffset(0);
      queryClient.invalidateQueries({ queryKey: ["nutritionist"] });
      queryClient.invalidateQueries({ queryKey: ["nutritionist-daily"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/nutritionist/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nutritionist"] });
      queryClient.invalidateQueries({ queryKey: ["nutritionist-daily"] });
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      analyzeMutation.mutate(file);
    }
    // Reset input so the same file can be re-selected
    e.target.value = "";
  }

  if (isLoading) return <div className="loading">Загрузка...</div>;

  return (
    <div className="page">
      <h1 className="page-title">Нутрициолог</h1>

      {/* Photo upload */}
      <div className="card" style={{ marginBottom: 16 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Подпись (необязательно, напр. «борщ»)"
          style={{
            width: "100%",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--tg-theme-hint-color, #ccc)",
            background: "var(--tg-theme-bg-color, #fff)",
            color: "var(--tg-theme-text-color, #000)",
            fontSize: 14,
            boxSizing: "border-box",
            marginBottom: 8,
          }}
        />
        <button
          className="btn"
          style={{ width: "100%" }}
          onClick={() => fileInputRef.current?.click()}
          disabled={analyzeMutation.isPending}
        >
          {analyzeMutation.isPending ? "Анализирую..." : "📸 Сфотографировать / Выбрать фото"}
        </button>

        {analyzeMutation.isError && (
          <div className="error-msg" style={{ marginTop: 8 }}>
            {(analyzeMutation.error as Error).message}
          </div>
        )}
      </div>

      {/* Daily summary */}
      {dailySummary && dailySummary.mealsCount > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Сегодня</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <div className="card-hint">Приёмов</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{dailySummary.mealsCount}</div>
            </div>
            <div>
              <div className="card-hint">Калории</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{dailySummary.total.calories} ккал</div>
            </div>
            <div>
              <div className="card-hint">Белки</div>
              <div style={{ fontWeight: 500 }}>{dailySummary.total.proteinsG}г</div>
            </div>
            <div>
              <div className="card-hint">Жиры</div>
              <div style={{ fontWeight: 500 }}>{dailySummary.total.fatsG}г</div>
            </div>
            <div>
              <div className="card-hint">Углеводы</div>
              <div style={{ fontWeight: 500 }}>{dailySummary.total.carbsG}г</div>
            </div>
          </div>
        </div>
      )}

      {/* Last result */}
      {lastResult && lastResult.status === "completed" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Результат анализа</div>
          <AnalysisCard analysis={lastResult} />
        </div>
      )}

      {lastResult && lastResult.status === "failed" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="error-msg">{lastResult.errorMessage ?? "Ошибка при анализе"}</div>
        </div>
      )}

      {/* History */}
      {analyses.length === 0 && !isLoading && (
        <div className="empty-state">
          <div className="empty-state-emoji">🥗</div>
          <div className="empty-state-text">Нет анализов. Отправьте фото еды!</div>
        </div>
      )}

      {analyses.length > 0 && (
        <div className="list">
          {analyses.map((a) => (
            <div key={a.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span className="card-hint">
                  {a.status === "completed" ? "✅" : a.status === "failed" ? "❌" : "⏳"}{" "}
                  {a.dishType}
                </span>
                <span className="card-hint">
                  {new Date(a.createdAt).toLocaleString("ru-RU")}
                </span>
              </div>
              {a.status === "completed" ? (
                <AnalysisCard analysis={a} compact />
              ) : a.status === "failed" ? (
                <div className="error-msg">{a.errorMessage ?? "Ошибка"}</div>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => deleteMutation.mutate(a.id)}
                  disabled={deleteMutation.isPending}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="form-row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button
            className="btn btn-small"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ←
          </button>
          <span className="card-hint" style={{ padding: "0 8px" }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} из {total}
          </span>
          <button
            className="btn btn-small"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

function AnalysisCard({ analysis, compact = false }: { analysis: NutritionAnalysisDto; compact?: boolean }) {
  const items = analysis.items;
  const showItems = compact ? items.slice(0, 3) : items;
  const hasMore = compact && items.length > 3;

  return (
    <div>
      {showItems.map((item: NutritionFoodItemDto, i: number) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <div style={{ fontWeight: 500, fontSize: 14 }}>
            {item.name} ({item.cookingMethod}) — {item.weightG}г
          </div>
          <div className="card-hint" style={{ fontSize: 13 }}>
            🔥 {item.calories} ккал | Б {item.proteinsG}г | Ж {item.fatsG}г | У {item.carbsG}г
          </div>
        </div>
      ))}
      {hasMore && (
        <div className="card-hint" style={{ fontStyle: "italic" }}>
          ... и ещё {items.length - 3} продуктов
        </div>
      )}
      <div style={{
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px solid var(--tg-theme-hint-color, #eee)",
        fontWeight: 600,
        fontSize: 14,
      }}>
        Итого: {analysis.total.weightG}г — {analysis.total.calories} ккал |
        Б {analysis.total.proteinsG}г | Ж {analysis.total.fatsG}г | У {analysis.total.carbsG}г
      </div>
      {!compact && analysis.mealAssessment && (
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, opacity: 0.85 }}>
          💡 {analysis.mealAssessment}
        </div>
      )}
    </div>
  );
}
