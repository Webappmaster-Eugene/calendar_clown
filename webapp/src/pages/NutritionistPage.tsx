import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  NutritionistHistoryResponse,
  NutritionAnalysisDto,
  NutritionDailySummaryDto,
  NutritionFoodItemDto,
  NutritionProductsListResponse,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import { NutritionistCatalog } from "./NutritionistCatalog";
import { CopyButton } from "../components/ui/CopyButton";
import { ShareButton } from "../components/ui/ShareButton";

const PAGE_SIZE = 10;

type NutritionistTab = "analyze" | "catalog";

export function NutritionistPage() {
  useClosingConfirmation();
  const [tab, setTab] = useState<NutritionistTab>("analyze");

  return (
    <div className="page">
      <h1 className="page-title">Нутрициолог</h1>

      <div className="tabs" style={{ marginBottom: 12 }}>
        <button
          className={`tab ${tab === "analyze" ? "tab-active" : ""}`}
          onClick={() => setTab("analyze")}
          type="button"
        >
          📷 Анализ
        </button>
        <button
          className={`tab ${tab === "catalog" ? "tab-active" : ""}`}
          onClick={() => setTab("catalog")}
          type="button"
        >
          📦 Каталог
        </button>
      </div>

      {tab === "analyze" ? <AnalyzeSection onGoToCatalog={() => setTab("catalog")} /> : <NutritionistCatalog />}
    </div>
  );
}

function AnalyzeSection({ onGoToCatalog }: { onGoToCatalog: () => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [lastResult, setLastResult] = useState<NutritionAnalysisDto | null>(null);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

  // Lightweight catalog count — one extra request but keeps the hint fresh.
  const { data: catalogCount } = useQuery({
    queryKey: ["nutritionistProductsCount"],
    queryFn: () =>
      api.get<NutritionProductsListResponse>("/api/nutritionist/products?limit=1&offset=0"),
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

  const productsTotal = catalogCount?.total ?? 0;

  return (
    <div>
      {/* Catalog hint */}
      {productsTotal > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div className="card-hint" style={{ fontSize: 13 }}>
              📦 {productsTotal} продуктов в каталоге — используются при анализе
            </div>
            <button className="btn btn-small" onClick={onGoToCatalog}>
              Открыть →
            </button>
          </div>
        </div>
      )}

      {/* Photo upload */}
      <div className="card" style={{ marginBottom: 16 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
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
          {analyses.map((a) => {
            const isExpanded = expandedId === a.id;
            return (
              <div key={a.id} className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 4,
                    cursor: a.status === "completed" ? "pointer" : undefined,
                  }}
                  onClick={() => a.status === "completed" && setExpandedId(isExpanded ? null : a.id)}
                >
                  <span className="card-hint" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                    {a.status === "completed" ? "✅" : a.status === "failed" ? "❌" : "⏳"}{" "}
                    {a.dishType}
                    {a.status === "completed" && confidenceBadge(a.confidence)}
                    {a.status === "completed" && (
                      <span style={{ fontSize: 11, opacity: 0.6 }}>{isExpanded ? "▲" : "▼"}</span>
                    )}
                  </span>
                  <span className="card-hint" style={{ whiteSpace: "nowrap", marginLeft: 8 }}>
                    {new Date(a.createdAt).toLocaleString("ru-RU")}
                  </span>
                </div>
                {a.status === "completed" ? (
                  <AnalysisCard analysis={a} compact={!isExpanded} />
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
            );
          })}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="form-row" style={{ marginTop: 12, justifyContent: "center" }}>
          <button
            className="btn btn-small"
            disabled={offset === 0}
            onClick={() => { setOffset((o) => Math.max(0, o - PAGE_SIZE)); setExpandedId(null); }}
          >
            ←
          </button>
          <span className="card-hint" style={{ padding: "0 8px" }}>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} из {total}
          </span>
          <button
            className="btn btn-small"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => { setOffset((o) => o + PAGE_SIZE); setExpandedId(null); }}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}

function confidenceBadge(confidence: "high" | "medium" | "low") {
  const map = {
    high: { label: "высокая", color: "#4CAF50" },
    medium: { label: "средняя", color: "#FF9800" },
    low: { label: "низкая", color: "#e53935" },
  } as const;
  const { label, color } = map[confidence];
  return (
    <span style={{
      display: "inline-block",
      fontSize: 11,
      fontWeight: 500,
      padding: "2px 8px",
      borderRadius: 6,
      background: `${color}20`,
      color,
    }}>
      {label}
    </span>
  );
}

function AnalysisCard({ analysis, compact = false }: { analysis: NutritionAnalysisDto; compact?: boolean }) {
  const items = analysis.items;
  const showItems = compact ? items.slice(0, 3) : items;
  const hasMore = compact && items.length > 3;
  const hasMatched = items.some((i) => i.matchedProductId);

  return (
    <div>
      {showItems.map((item: NutritionFoodItemDto, i: number) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <div style={{ fontWeight: 500, fontSize: 14, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>
              {item.name} ({item.cookingMethod}) — {item.weightG}г
            </span>
            {item.matchedProductId != null && (
              <span
                style={{
                  display: "inline-block",
                  fontSize: 10,
                  fontWeight: 500,
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "#2e7d3220",
                  color: "#2e7d32",
                }}
                title="Совпадение с продуктом из вашего каталога"
              >
                🎯 из каталога
              </span>
            )}
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
      {!compact && (
        <div style={{ marginTop: 6 }}>
          {confidenceBadge(analysis.confidence)}
        </div>
      )}
      {!compact && hasMatched && (
        <div className="card-hint" style={{ marginTop: 4, fontSize: 11 }}>
          🎯 — продукт из вашего каталога
        </div>
      )}
      {!compact && analysis.mealAssessment && (
        <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5, opacity: 0.85 }}>
          💡 {analysis.mealAssessment}
        </div>
      )}
      {!compact && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 10,
            paddingTop: 8,
            borderTop: "1px solid var(--tg-theme-hint-color, #eee)",
          }}
        >
          <CopyButton text={serializeAnalysis(analysis)} size="sm" />
          <ShareButton text={serializeAnalysis(analysis)} size="sm" />
        </div>
      )}
    </div>
  );
}

/**
 * Serialize a nutrition analysis to a copyable plain-text block that mirrors
 * the format used by the Telegram bot (formatAnalysisMessage in
 * src/commands/nutritionistMode.ts), so pasting into Telegram produces the
 * same readable output.
 */
function serializeAnalysis(a: NutritionAnalysisDto): string {
  const lines: string[] = [];
  lines.push("🥗 Анализ еды");
  lines.push("");
  lines.push(`Блюдо: ${a.dishType}`);
  const confLabel =
    a.confidence === "high" ? "высокая" : a.confidence === "medium" ? "средняя" : "низкая";
  lines.push(`Уверенность: ${confLabel}`);
  lines.push("");
  lines.push("📦 Продукты:");
  a.items.forEach((item, i) => {
    const matched = item.matchedProductId ? " 🎯" : "";
    lines.push(
      `${i + 1}. ${item.name}${matched} (${item.cookingMethod}) — ${item.weightG}г`,
    );
    lines.push(
      `   🔥 ${item.calories} ккал | Б ${item.proteinsG}г | Ж ${item.fatsG}г | У ${item.carbsG}г`,
    );
  });
  lines.push("");
  lines.push("━━━━━━━━━━━━━━━━━━━");
  lines.push(`📊 Итого: ${a.total.weightG}г`);
  lines.push(
    `🔥 ${a.total.calories} ккал | Б ${a.total.proteinsG}г | Ж ${a.total.fatsG}г | У ${a.total.carbsG}г`,
  );
  if (a.items.some((i) => i.matchedProductId)) {
    lines.push("");
    lines.push("🎯 — продукт из каталога");
  }
  if (a.mealAssessment) {
    lines.push("");
    lines.push(`💡 ${a.mealAssessment}`);
  }
  return lines.join("\n");
}
