import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import { useDragScroll } from "../hooks/useDragScroll";
import type {
  CategoryDto,
  ExpenseReportDto,
  AddExpenseRequest,
  MonthComparisonDto,
  ComparisonDrilldownDto,
  UserTotalDto,
  YearReportMonthDto,
  RecentExpenseDto,
  RecentExpensesResponse,
  AddExpenseResultDto,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

// ─── Constants ─────────────────────────────────────────────────

const RU_MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type ExpenseTab = "report" | "comparison" | "stats" | "year" | "recent";

interface DrilldownExpense {
  id: number;
  subcategory: string | null;
  amount: number;
  firstName: string;
  createdAt: string;
}

interface DrilldownResponse {
  expenses: DrilldownExpense[];
  total: number;
  categoryName: string;
  categoryEmoji: string;
}

// ─── Main Page ─────────────────────────────────────────────────

export function ExpensesPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();

  // Navigation state
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [tab, setTab] = useState<ExpenseTab>("report");
  const [yearForYearTab, setYearForYearTab] = useState(now.getFullYear());

  // Input state
  const [showForm, setShowForm] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [drilldownCategoryId, setDrilldownCategoryId] = useState<number | null>(null);
  const [comparisonDrilldownCategoryId, setComparisonDrilldownCategoryId] = useState<number | null>(null);
  const [recentPage, setRecentPage] = useState(1);
  const tabsRef = useDragScroll<HTMLDivElement>();

  // ─── Queries ──────────────────────────────────────────────

  const { data: report, isLoading: reportLoading, error: reportError } = useQuery({
    queryKey: ["expenses", "report", year, month],
    queryFn: () => api.get<ExpenseReportDto>(`/api/expenses/report?year=${year}&month=${month}`),
  });

  const { data: categories } = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => api.get<CategoryDto[]>("/api/expenses/categories"),
  });

  const { data: yearData, isLoading: yearLoading } = useQuery({
    queryKey: ["expenses", "year", yearForYearTab],
    queryFn: () => api.get<YearReportMonthDto[]>(`/api/expenses/year?year=${yearForYearTab}`),
    enabled: tab === "year",
  });

  const RECENT_LIMIT = 10;
  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ["expenses", "recent", recentPage],
    queryFn: () => api.get<RecentExpensesResponse>(`/api/expenses/recent?limit=${RECENT_LIMIT}&page=${recentPage}`),
    enabled: tab === "recent",
  });

  // ─── Mutations ────────────────────────────────────────────

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const addMutation = useMutation({
    mutationFn: (data: AddExpenseRequest) =>
      api.post<AddExpenseResultDto>("/api/expenses", data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setShowForm(false);
      setAmount("");
      setCategoryId(null);
      if (result?.confirmation) {
        showSuccess(result.confirmation);
      }
    },
  });

  const addTextMutation = useMutation({
    mutationFn: (text: string) =>
      api.post<AddExpenseResultDto & { expenses?: Array<{ emoji: string; name: string; amount: number }> }>("/api/expenses", { text }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setVoiceText("");
      if (result?.confirmation) {
        showSuccess(result.confirmation);
      } else if (result?.expenses && Array.isArray(result.expenses)) {
        const total = result.expenses.reduce((s, e) => s + e.amount, 0);
        showSuccess(`Записано ${result.expenses.length} трат на ${total.toLocaleString("ru-RU")} ₽`);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (categoryId === null || !amount.trim()) return;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    addMutation.mutate({ categoryId, amount: parsed });
  };

  // ─── Month navigation ─────────────────────────────────────

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m);
    setYear(y);
  };

  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  // ─── Drilldown ────────────────────────────────────────────

  if (comparisonDrilldownCategoryId !== null) {
    return (
      <ComparisonDrilldownView
        categoryId={comparisonDrilldownCategoryId}
        year={year}
        month={month}
        onBack={() => setComparisonDrilldownCategoryId(null)}
      />
    );
  }

  if (drilldownCategoryId !== null) {
    return (
      <ExpenseDrilldown
        categoryId={drilldownCategoryId}
        year={year}
        month={month}
        onBack={() => setDrilldownCategoryId(null)}
      />
    );
  }

  if (reportLoading && tab !== "year" && tab !== "recent") return <div className="loading">Загрузка...</div>;
  if (reportError) return <div className="page"><div className="error-msg">{(reportError as Error).message}</div></div>;

  const total = report?.total ?? 0;
  const limit = report?.monthlyLimit ?? 0;
  const progress = limit > 0 ? Math.min((total / limit) * 100, 100) : 0;

  return (
    <div className="page">
      <h1 className="page-title">Расходы</h1>

      {/* Quick input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input
          className="input"
          value={voiceText}
          onChange={(e) => setVoiceText(e.target.value)}
          placeholder="кофе 300 или скажите голосом"
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && voiceText.trim()) {
              addTextMutation.mutate(voiceText.trim());
            }
          }}
        />
        <VoiceButton
          mode="expenses"
          endpoint="/api/voice/expense"
          onResult={(_transcript, data) => {
            setVoiceError(null);
            queryClient.invalidateQueries({ queryKey: ["expenses"] });
            const d = data as Record<string, unknown> | undefined;
            if (d?.confirmation && typeof d.confirmation === "string") {
              setVoiceText(d.confirmation as string);
              setTimeout(() => setVoiceText(""), 3000);
            }
          }}
          onError={(err) => setVoiceError(err)}
        />
      </div>
      {successMsg && <div className="success-msg" style={{ marginBottom: 8, color: "var(--tg-theme-link-color, #2481cc)", fontSize: 13 }}>{successMsg}</div>}
      {voiceError && <div className="error-msg" style={{ marginBottom: 8 }}>{voiceError}</div>}
      {addTextMutation.error && <div className="error-msg">{(addTextMutation.error as Error).message}</div>}
      {addTextMutation.isPending && <div className="card-hint" style={{ marginBottom: 8 }}>Добавление...</div>}

      {/* Tabs */}
      <div className="tabs tabs--scroll" ref={tabsRef}>
        {(["report", "comparison", "stats", "year", "recent"] as const).map((t) => (
          <button
            key={t}
            className={`tab${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "report" ? "Отчёт" : t === "comparison" ? "Сравнение" : t === "stats" ? "Статистика" : t === "year" ? "За год" : "Последние"}
          </button>
        ))}
      </div>

      {/* Month navigator (for report/comparison/stats) */}
      {tab !== "year" && tab !== "recent" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <button className="btn btn-small" onClick={() => goMonth(-1)}>◀</button>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {RU_MONTHS[month - 1]} {year}
          </span>
          <button
            className="btn btn-small"
            onClick={() => goMonth(1)}
            disabled={isCurrentMonth}
          >▶</button>
        </div>
      )}

      {/* Tab content */}
      {tab === "report" && (
        <ReportView
          report={report}
          total={total}
          limit={limit}
          progress={progress}
          month={month}
          year={year}
          onDrilldown={setDrilldownCategoryId}
        />
      )}
      {tab === "comparison" && (
        <ComparisonView
          comparison={report?.comparison ?? []}
          total={total}
          comparisonDay={report?.comparisonDay}
          month={month}
          year={year}
          onDrilldown={setComparisonDrilldownCategoryId}
        />
      )}
      {tab === "stats" && (
        <StatsView byUser={report?.byUser ?? []} total={total} />
      )}
      {tab === "year" && (
        <YearView
          data={yearData ?? []}
          isLoading={yearLoading}
          year={yearForYearTab}
          onYearChange={setYearForYearTab}
          onMonthClick={(m) => { setMonth(m); setYear(yearForYearTab); setTab("report"); }}
          currentYear={now.getFullYear()}
        />
      )}
      {tab === "recent" && (
        <RecentView data={recentData} isLoading={recentLoading} page={recentPage} onPageChange={setRecentPage} />
      )}

      {/* FAB form */}
      {!showForm ? (
        <button className="fab" onClick={() => setShowForm(true)}>+</button>
      ) : (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Категория</label>
              <select
                className="input"
                value={categoryId ?? ""}
                onChange={(e) => setCategoryId(Number(e.target.value) || null)}
              >
                <option value="">Выберите категорию</option>
                {categories?.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.emoji} {cat.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Сумма</label>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            {addMutation.error && <div className="error-msg">{(addMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={addMutation.isPending || categoryId === null || !amount}
              >
                {addMutation.isPending ? "Добавление..." : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

// ─── Report View ─────────────────────────────────────────────

function ReportView({
  report,
  total,
  limit,
  progress,
  month,
  year,
  onDrilldown,
}: {
  report: ExpenseReportDto | undefined;
  total: number;
  limit: number;
  progress: number;
  month: number;
  year: number;
  onDrilldown: (catId: number) => void;
}) {
  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="card-hint">{report?.month ?? "Текущий месяц"}</div>
          <button
            className="btn btn-small"
            onClick={() => window.open(`/api/expenses/excel?month=${month}&year=${year}`, "_blank")}
          >
            Excel
          </button>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700 }}>
          {total.toLocaleString("ru-RU")} / {limit.toLocaleString("ru-RU")}
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="section-title">По категориям</div>
      {report?.byCategory && report.byCategory.length > 0 ? (
        <div className="list">
          {report.byCategory.map((cat) => (
            <div
              key={cat.categoryId}
              className="list-item"
              style={{ cursor: "pointer" }}
              onClick={() => onDrilldown(cat.categoryId)}
            >
              <span className="list-item-emoji">{cat.categoryEmoji}</span>
              <div className="list-item-content">
                <div className="list-item-title">{cat.categoryName}</div>
                <div className="list-item-hint">Детали &rarr;</div>
              </div>
              <div style={{ fontWeight: 600 }}>
                {cat.total.toLocaleString("ru-RU")}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state-text">Нет расходов за этот месяц</div>
        </div>
      )}
    </>
  );
}

// ─── Comparison View ─────────────────────────────────────────

const RU_MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

function ComparisonView({
  comparison,
  total,
  comparisonDay,
  month,
  year,
  onDrilldown,
}: {
  comparison: MonthComparisonDto[];
  total: number;
  comparisonDay?: number;
  month: number;
  year: number;
  onDrilldown: (catId: number) => void;
}) {
  if (comparison.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">Нет данных для сравнения</div>
      </div>
    );
  }

  const totalPrev = comparison.reduce((s, c) => s + c.prevTotal, 0);
  // When partial-month comparison, use comparison currTotals (partial) instead of full-month total
  const totalCurr = comparisonDay ? comparison.reduce((s, c) => s + c.currTotal, 0) : total;
  const totalDiff = totalCurr - totalPrev;

  const prevMonth = month === 1 ? 12 : month - 1;

  return (
    <>
      {/* Partial-month label */}
      {comparisonDay && (
        <div style={{ fontSize: 13, color: "var(--tg-theme-hint-color, #999)", marginBottom: 10, textAlign: "center" }}>
          1–{comparisonDay} {RU_MONTHS_GENITIVE[month - 1]} vs 1–{comparisonDay} {RU_MONTHS_GENITIVE[prevMonth - 1]}
        </div>
      )}

      {/* Summary card */}
      <div className="stat-row">
        <div className="stat-card">
          <div className="card-hint">Пред. месяц</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{totalPrev.toLocaleString("ru-RU")}</div>
        </div>
        <div className="stat-card">
          <div className="card-hint">Текущий</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{totalCurr.toLocaleString("ru-RU")}</div>
        </div>
        <div className="stat-card">
          <div className="card-hint">Разница</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: totalDiff > 0 ? "#e53935" : "#43a047" }}>
            {totalDiff > 0 ? "+" : ""}{totalDiff.toLocaleString("ru-RU")}
          </div>
        </div>
      </div>

      {/* Category rows */}
      <div className="list">
        {comparison
          .filter((c) => c.prevTotal > 0 || c.currTotal > 0)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((c) => {
            const pctChange = c.prevTotal > 0
              ? Math.round(((c.currTotal - c.prevTotal) / c.prevTotal) * 100)
              : c.currTotal > 0 ? 100 : 0;
            const isUp = c.diff > 0;
            const isDown = c.diff < 0;

            return (
              <div
                key={c.categoryId}
                className="list-item"
                style={{ cursor: "pointer" }}
                onClick={() => onDrilldown(c.categoryId)}
              >
                <span className="list-item-emoji">{c.categoryEmoji}</span>
                <div className="list-item-content">
                  <div className="list-item-title">{c.categoryName}</div>
                  <div className="list-item-hint">
                    {c.prevTotal.toLocaleString("ru-RU")} → {c.currTotal.toLocaleString("ru-RU")}
                  </div>
                </div>
                <div style={{
                  fontWeight: 600,
                  color: isUp ? "#e53935" : isDown ? "#43a047" : "inherit",
                  fontSize: 13,
                  textAlign: "right",
                  minWidth: 60,
                }}>
                  {isUp ? "+" : ""}{c.diff.toLocaleString("ru-RU")}
                  {pctChange !== 0 && (
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      {pctChange > 0 ? "+" : ""}{pctChange}%
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </>
  );
}

// ─── Stats View ──────────────────────────────────────────────

function StatsView({
  byUser,
  total,
}: {
  byUser: UserTotalDto[];
  total: number;
}) {
  if (byUser.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">Нет данных по пользователям</div>
      </div>
    );
  }

  return (
    <>
      <div className="section-title">По пользователям</div>
      <div className="list">
        {byUser
          .sort((a, b) => b.total - a.total)
          .map((u) => {
            const pct = total > 0 ? Math.round((u.total / total) * 100) : 0;
            return (
              <div key={u.userId} className="list-item">
                <div className="list-item-content">
                  <div className="list-item-title">{u.firstName}</div>
                  <div className="list-item-hint">{pct}% от общих расходов</div>
                </div>
                <div style={{ fontWeight: 600 }}>
                  {u.total.toLocaleString("ru-RU")}
                </div>
              </div>
            );
          })}
      </div>

      {/* Total */}
      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-hint">Итого</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{total.toLocaleString("ru-RU")}</div>
      </div>
    </>
  );
}

// ─── Year View ───────────────────────────────────────────────

function YearView({
  data,
  isLoading,
  year,
  onYearChange,
  onMonthClick,
  currentYear,
}: {
  data: YearReportMonthDto[];
  isLoading: boolean;
  year: number;
  onYearChange: (y: number) => void;
  onMonthClick: (month: number) => void;
  currentYear: number;
}) {
  const yearTotal = data.reduce((s, d) => s + d.total, 0);
  const now = new Date();

  return (
    <>
      {/* Year navigator */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button className="btn btn-small" onClick={() => onYearChange(year - 1)}>◀</button>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{year}</span>
        <button
          className="btn btn-small"
          onClick={() => onYearChange(year + 1)}
          disabled={year >= currentYear}
        >▶</button>
      </div>

      {isLoading && <div className="loading">Загрузка...</div>}

      {!isLoading && data.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">Нет данных за {year} год</div>
        </div>
      )}

      {!isLoading && data.length > 0 && (
        <>
          <div className="list">
            {RU_MONTHS.map((name, i) => {
              const monthNum = i + 1;
              const entry = data.find((d) => d.month === monthNum);
              const monthTotal = entry?.total ?? 0;
              const isCurrent = year === now.getFullYear() && monthNum === now.getMonth() + 1;

              return (
                <div
                  key={monthNum}
                  className="list-item"
                  style={{
                    cursor: "pointer",
                    background: isCurrent ? "var(--tg-theme-secondary-bg-color, #f0f0f0)" : undefined,
                  }}
                  onClick={() => onMonthClick(monthNum)}
                >
                  <div className="list-item-content">
                    <div className="list-item-title">{name}</div>
                  </div>
                  <div style={{ fontWeight: 600, color: monthTotal > 0 ? "inherit" : "var(--tg-theme-hint-color, #999)" }}>
                    {monthTotal > 0 ? monthTotal.toLocaleString("ru-RU") : "—"}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-hint">Итого за {year}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{yearTotal.toLocaleString("ru-RU")}</div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Recent View ────────────────────────────────────────────

function RecentView({
  data,
  isLoading,
  page,
  onPageChange,
}: {
  data: RecentExpensesResponse | undefined;
  isLoading: boolean;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const limit = data?.limit ?? 10;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const hasMore = page < totalPages;

  if (items.length === 0 && page === 1) {
    return (
      <div className="empty-state">
        <div className="empty-state-text">Нет записей</div>
      </div>
    );
  }

  return (
    <>
      {total > 0 && (
        <div className="card-hint" style={{ textAlign: "center", marginBottom: 8 }}>
          Всего: {total} записей
        </div>
      )}
      <div className="list">
        {items.map((exp) => (
          <div key={exp.id} className="list-item">
            <span className="list-item-emoji">{exp.categoryEmoji}</span>
            <div className="list-item-content">
              <div className="list-item-title">
                {exp.amount.toLocaleString("ru-RU")} ₽
                {exp.subcategory ? ` — ${exp.subcategory}` : ""}
              </div>
              <div className="list-item-hint">
                {exp.firstName} &middot; {new Date(exp.createdAt).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
            {exp.isOwn && (
              <div className="list-item-actions">
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => {
                    if (confirm("Удалить эту запись?")) {
                      deleteMutation.mutate(exp.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Pagination controls */}
      {(page > 1 || hasMore) && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12, paddingBottom: 12 }}>
          {page > 1 && (
            <button className="btn btn-small" onClick={() => onPageChange(page - 1)}>
              Назад
            </button>
          )}
          <span style={{ lineHeight: "32px", fontSize: 13, color: "var(--tg-theme-hint-color, #999)" }}>
            {page} / {totalPages}
          </span>
          {hasMore && (
            <button className="btn btn-small btn-primary" onClick={() => onPageChange(page + 1)}>
              Далее
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ─── Comparison Drilldown ────────────────────────────────────

function ComparisonDrilldownView({
  categoryId,
  year,
  month,
  onBack,
}: {
  categoryId: number;
  year: number;
  month: number;
  onBack: () => void;
}) {
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "comparison-drilldown", categoryId, year, month, page],
    queryFn: () =>
      api.get<ComparisonDrilldownDto>(
        `/api/expenses/comparison-drilldown?categoryId=${categoryId}&year=${year}&month=${month}&page=${page}&limit=${LIMIT}`
      ),
  });

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const hasMorePrev = data ? page * LIMIT < data.prevCount : false;
  const hasMoreCurr = data ? page * LIMIT < data.currCount : false;

  const renderExpenseList = (expenses: ComparisonDrilldownDto["prevExpenses"]) =>
    expenses.map((exp) => (
      <div key={exp.id} className="list-item">
        <div className="list-item-content">
          <div className="list-item-title">
            {exp.amount.toLocaleString("ru-RU")} ₽
            {exp.subcategory ? ` — ${exp.subcategory}` : ""}
          </div>
          <div className="list-item-hint">
            {exp.firstName} &middot; {new Date(exp.createdAt).toLocaleDateString("ru-RU")}
          </div>
        </div>
      </div>
    ));

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        Назад
      </button>

      {data && (
        <h2 className="page-title" style={{ fontSize: 18 }}>
          {data.categoryEmoji} {data.categoryName}
        </h2>
      )}

      {data?.comparisonDay && (
        <div style={{ fontSize: 13, color: "var(--tg-theme-hint-color, #999)", marginBottom: 12 }}>
          Сравнение за 1–{data.comparisonDay} число
        </div>
      )}

      {isLoading && <div className="loading">Загрузка...</div>}

      {data && (
        <>
          {/* Current month */}
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            {RU_MONTHS[month - 1]} {year}
            {data.currExpenses.length > 0 && (
              <span style={{ fontWeight: 400, color: "var(--tg-theme-hint-color, #999)", marginLeft: 8 }}>
                ({data.currCount})
              </span>
            )}
          </h3>
          {data.currExpenses.length > 0 ? (
            <div className="list" style={{ marginBottom: 16 }}>
              {renderExpenseList(data.currExpenses)}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #999)", marginBottom: 16 }}>
              Нет расходов
            </div>
          )}

          {/* Previous month */}
          <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            {RU_MONTHS[prevMonth - 1]} {prevYear}
            {data.prevExpenses.length > 0 && (
              <span style={{ fontWeight: 400, color: "var(--tg-theme-hint-color, #999)", marginLeft: 8 }}>
                ({data.prevCount})
              </span>
            )}
          </h3>
          {data.prevExpenses.length > 0 ? (
            <div className="list" style={{ marginBottom: 16 }}>
              {renderExpenseList(data.prevExpenses)}
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "var(--tg-theme-hint-color, #999)", marginBottom: 16 }}>
              Нет расходов
            </div>
          )}

          {/* Pagination */}
          {(hasMorePrev || hasMoreCurr || page > 1) && (
            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 8 }}>
              <button
                className="btn btn-small"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Назад
              </button>
              <button
                className="btn btn-small"
                disabled={!hasMorePrev && !hasMoreCurr}
                onClick={() => setPage((p) => p + 1)}
              >
                Ещё
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Drilldown ───────────────────────────────────────────────

function ExpenseDrilldown({
  categoryId,
  year,
  month,
  onBack,
}: {
  categoryId: number;
  year: number;
  month: number;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "drilldown", categoryId, year, month, page],
    queryFn: () =>
      api.get<DrilldownResponse>(
        `/api/expenses/drilldown?categoryId=${categoryId}&year=${year}&month=${month}&page=${page}&limit=${LIMIT}`
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });

  const expenses = data?.expenses ?? [];
  const total = data?.total ?? 0;
  const hasMore = page * LIMIT < total;

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        Назад
      </button>

      {data && (
        <h2 className="page-title" style={{ fontSize: 18 }}>
          {data.categoryEmoji} {data.categoryName}
        </h2>
      )}

      {isLoading && <div className="loading">Загрузка...</div>}

      {expenses.length === 0 && !isLoading && (
        <div className="empty-state">
          <div className="empty-state-text">Нет расходов в этой категории</div>
        </div>
      )}

      {expenses.length > 0 && (
        <>
          <div className="list">
            {expenses.map((exp) => (
              <div key={exp.id} className="list-item">
                <div className="list-item-content">
                  <div className="list-item-title">
                    {exp.amount.toLocaleString("ru-RU")} ₽
                    {exp.subcategory ? ` — ${exp.subcategory}` : ""}
                  </div>
                  <div className="list-item-hint">
                    {exp.firstName} &middot; {new Date(exp.createdAt).toLocaleDateString("ru-RU")}
                  </div>
                </div>
                <div className="list-item-actions">
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => deleteMutation.mutate(exp.id)}
                    disabled={deleteMutation.isPending}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
            {page > 1 && (
              <button className="btn btn-small" onClick={() => setPage((p) => p - 1)}>Назад</button>
            )}
            {hasMore && (
              <button className="btn btn-small btn-primary" onClick={() => setPage((p) => p + 1)}>
                Далее
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
