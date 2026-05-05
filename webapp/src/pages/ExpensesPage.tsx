import { useEffect, useState } from "react";
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
  MonthlyLimitDto,
  SetMonthlyLimitRequest,
  ExpenseDto,
  UpdateExpenseRequest,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import { useTelegram } from "../hooks/useTelegram";

/** Format Date as YYYY-MM-DD for `<input type="date">`. */
function toIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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
  const [date, setDate] = useState<string>(toIsoDay(now));
  const [voiceText, setVoiceText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
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
      setDate(toIsoDay(new Date()));
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
    const today = toIsoDay(new Date());
    const payload: AddExpenseRequest = { categoryId, amount: parsed };
    if (date && date !== today) payload.date = date;
    addMutation.mutate(payload);
  };

  // Allow backdating up to 5 years; cap at tomorrow (Telegram clients can present
  // tomorrow as "today" depending on TZ — server validates the real range).
  const maxDate = toIsoDay(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const minDate = toIsoDay(new Date(now.getFullYear() - 5, 0, 1));

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
          onError={(err, data) => {
            setVoiceError(err);
            // When recognition succeeded but expense extraction failed, the API
            // returns the raw transcript so the user can edit it manually instead
            // of re-recording.
            const d = data as { transcript?: unknown } | null | undefined;
            if (d && typeof d.transcript === "string" && d.transcript.trim()) {
              setVoiceText(d.transcript);
            }
          }}
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
            <div className="form-group">
              <label className="form-label">Дата</label>
              <input
                className="input"
                type="date"
                value={date}
                min={minDate}
                max={maxDate}
                onChange={(e) => setDate(e.target.value)}
              />
              <div className="card-hint" style={{ marginTop: 4, fontSize: 12 }}>
                По умолчанию — сегодня. Можно выбрать прошлый день для записи задним числом.
              </div>
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

// ─── Download helpers ────────────────────────────────────────

/** Read a Blob as a base64 `data:` URL (in-process, doesn't leak to OS). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

/** Programmatic <a download> click. Caller controls the href (blob: or data:). */
function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ─── Report View ─────────────────────────────────────────────

function ReportView({
  report,
  total,
  limit,
  progress,
  month,
  year,
}: {
  report: ExpenseReportDto | undefined;
  total: number;
  limit: number;
  progress: number;
  month: number;
  year: number;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);
  const [excelSuccess, setExcelSuccess] = useState<string | null>(null);
  const [editLimitOpen, setEditLimitOpen] = useState(false);
  const { platform } = useTelegram();

  const toggleCategory = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // When the user changes month/year, drop expanded state — different data, fresh view.
  useEffect(() => {
    setExpanded(new Set());
    setExcelError(null);
    setExcelSuccess(null);
  }, [year, month]);

  /**
   * Deliver Excel through the bot DM. `<a download>` clicks inside Telegram WebView
   * (especially WKWebView on iOS/macOS) frequently produce no UI feedback at all —
   * the user reports "ничего не происходит". Sending the document via Bot API to the
   * user's chat with the bot is the only delivery path that works reliably across
   * platforms (mobile, desktop, web). For desktop platforms we still offer a direct
   * download as a quick path; for everything else we go straight through the bot.
   */
  const sendExcelViaBot = async (period: "month" | "year") => {
    if (excelLoading) return;
    setExcelLoading(true);
    setExcelError(null);
    setExcelSuccess(null);
    try {
      const payload = period === "year" ? { year, period } : { year, month, period };
      await api.post<{ filename: string }>("/api/expenses/excel/send", payload);
      setExcelSuccess("📥 Файл отправлен в чат с ботом");
      setTimeout(() => setExcelSuccess(null), 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось отправить файл";
      setExcelError(msg);
    } finally {
      setExcelLoading(false);
    }
  };

  /**
   * Direct download path for desktop Telegram and the web build, where
   * `<a download>` works reliably. Apple WebViews go through `data:` URLs to
   * avoid blob-URL leakage to the OS opener.
   */
  const downloadExcelDirect = async (period: "month" | "year") => {
    if (excelLoading) return;
    setExcelLoading(true);
    setExcelError(null);
    setExcelSuccess(null);
    try {
      const url =
        period === "year"
          ? `/api/expenses/excel?period=year&year=${year}`
          : `/api/expenses/excel?month=${month}&year=${year}`;
      const blob = await api.getBlob(url);
      const filename =
        period === "year"
          ? `Расходы_${year}_год.xlsx`
          : `Расходы_${RU_MONTHS[month - 1]}_${year}.xlsx`;
      const isApple = platform === "ios" || platform === "macos";
      if (isApple) {
        const dataUrl = await blobToDataUrl(blob);
        triggerDownload(dataUrl, filename);
      } else {
        const objectUrl = URL.createObjectURL(blob);
        triggerDownload(objectUrl, filename);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Не удалось сформировать отчёт";
      setExcelError(msg);
    } finally {
      setExcelLoading(false);
    }
  };

  // Bot delivery is the default — `<a download>` is unreliable in Telegram WebViews
  // (WKWebView on iOS/macOS especially). Only tdesktop and the web build get the
  // direct path because they're real browsers/Chromium-based shells.
  const isDesktopOrWeb =
    platform === "tdesktop" || platform === "web" || platform === "weba" || platform === "webk";
  const handleExcelClick = (period: "month" | "year") =>
    isDesktopOrWeb ? downloadExcelDirect(period) : sendExcelViaBot(period);

  return (
    <>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="card-hint">{report?.month ?? "Текущий месяц"}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn btn-small"
              onClick={() => handleExcelClick("month")}
              disabled={excelLoading}
            >
              {excelLoading ? "…" : "Excel"}
            </button>
            <button
              className="btn btn-small"
              onClick={() => handleExcelClick("year")}
              disabled={excelLoading}
              title={`Excel за весь ${year}`}
            >
              {excelLoading ? "…" : "Excel год"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 28, fontWeight: 700 }}>
          <span>{total.toLocaleString("ru-RU")} / {limit.toLocaleString("ru-RU")}</span>
          <button
            className="btn btn-small"
            onClick={() => setEditLimitOpen(true)}
            title="Изменить лимит"
            style={{ fontSize: 14, padding: "2px 8px" }}
          >
            ✏️
          </button>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        {excelSuccess && (
          <div className="card-hint" style={{ marginTop: 8, color: "var(--tg-theme-link-color, #2481cc)" }}>{excelSuccess}</div>
        )}
        {excelError && (
          <div className="error-msg" style={{ marginTop: 8 }}>{excelError}</div>
        )}
      </div>

      {editLimitOpen && (
        <LimitEditDialog
          year={year}
          month={month}
          currentLimit={limit}
          onClose={() => setEditLimitOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["expenses"] });
            setEditLimitOpen(false);
          }}
        />
      )}

      <div className="section-title">По категориям</div>
      {report?.byCategory && report.byCategory.length > 0 ? (
        <div className="list">
          {report.byCategory.map((cat) => (
            <CategoryAccordion
              key={cat.categoryId}
              categoryId={cat.categoryId}
              categoryEmoji={cat.categoryEmoji}
              categoryName={cat.categoryName}
              total={cat.total}
              year={year}
              month={month}
              isExpanded={expanded.has(cat.categoryId)}
              onToggle={() => toggleCategory(cat.categoryId)}
            />
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

// ─── Category Accordion (inline drilldown) ───────────────────

function CategoryAccordion({
  categoryId,
  categoryEmoji,
  categoryName,
  total,
  year,
  month,
  isExpanded,
  onToggle,
}: {
  categoryId: number;
  categoryEmoji: string;
  categoryName: string;
  total: number;
  year: number;
  month: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  // Reset pagination when the user collapses the row.
  useEffect(() => {
    if (!isExpanded) setPage(1);
  }, [isExpanded]);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "drilldown", categoryId, year, month, page],
    queryFn: () =>
      api.get<DrilldownResponse>(
        `/api/expenses/drilldown?categoryId=${categoryId}&year=${year}&month=${month}&page=${page}&limit=${LIMIT}`
      ),
    enabled: isExpanded,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
  });

  const { data: categories } = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => api.get<CategoryDto[]>("/api/expenses/categories"),
  });

  const [editingId, setEditingId] = useState<number | null>(null);

  const expenses = data?.expenses ?? [];
  const totalCount = data?.total ?? 0;
  const hasMore = page * LIMIT < totalCount;

  return (
    <div className="expense-cat">
      <div className="expense-cat-header" onClick={onToggle}>
        <span className="list-item-emoji">{categoryEmoji}</span>
        <div className="list-item-content">
          <div className="list-item-title">{categoryName}</div>
          <div className="list-item-hint">
            {isExpanded ? "Скрыть детали ▲" : "Детали ▼"}
          </div>
        </div>
        <div style={{ fontWeight: 600 }}>
          {total.toLocaleString("ru-RU")}
        </div>
      </div>

      {isExpanded && (
        <div className="expense-cat-body">
          {isLoading && <div className="expense-row-empty">Загрузка…</div>}
          {!isLoading && expenses.length === 0 && (
            <div className="expense-row-empty">Операций нет</div>
          )}
          {expenses.map((exp) =>
            editingId === exp.id ? (
              <EditExpenseRow
                key={exp.id}
                expense={{
                  id: exp.id,
                  amount: exp.amount,
                  subcategory: exp.subcategory,
                  createdAt: exp.createdAt,
                  // The drilldown response is filtered by categoryId so we know it.
                  categoryId,
                }}
                categories={categories ?? []}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  queryClient.invalidateQueries({ queryKey: ["expenses"] });
                }}
              />
            ) : (
              <div key={exp.id} className="expense-row">
                <div className="expense-row-content">
                  <div className="expense-row-title">
                    {exp.amount.toLocaleString("ru-RU")} ₽
                    {exp.subcategory ? ` — ${exp.subcategory}` : ""}
                  </div>
                  <div className="expense-row-meta">
                    {exp.firstName} &middot; {new Date(exp.createdAt).toLocaleDateString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <div className="expense-row-actions">
                  <button
                    className="btn btn-icon"
                    onClick={() => setEditingId(exp.id)}
                    disabled={deleteMutation.isPending}
                    title="Редактировать"
                  >
                    ✏️
                  </button>
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
              </div>
            )
          )}
          {(page > 1 || hasMore) && (
            <div className="expense-row-pagination">
              {page > 1 && (
                <button className="btn btn-small" onClick={() => setPage((p) => p - 1)}>
                  Назад
                </button>
              )}
              {hasMore && (
                <button className="btn btn-small btn-primary" onClick={() => setPage((p) => p + 1)}>
                  Показать ещё
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Edit Expense Row (inline form) ──────────────────────────

function EditExpenseRow({
  expense,
  categories,
  onCancel,
  onSaved,
}: {
  expense: { id: number; amount: number; subcategory: string | null; createdAt: string; categoryId: number };
  categories: CategoryDto[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(expense.amount));
  const [categoryId, setCategoryId] = useState(expense.categoryId);
  const [subcategory, setSubcategory] = useState(expense.subcategory ?? "");
  const [date, setDate] = useState(toIsoDay(new Date(expense.createdAt)));

  const editMutation = useMutation({
    mutationFn: (body: UpdateExpenseRequest) =>
      api.put<ExpenseDto>(`/api/expenses/${expense.id}`, body),
    onSuccess: onSaved,
  });

  const submit = () => {
    const parsedAmount = parseFloat(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    if (!categoryId) return;
    const body: UpdateExpenseRequest = {};
    if (parsedAmount !== expense.amount) body.amount = parsedAmount;
    if (categoryId !== expense.categoryId) body.categoryId = categoryId;
    const trimmedSub = subcategory.trim();
    const origSub = expense.subcategory ?? "";
    if (trimmedSub !== origSub) body.subcategory = trimmedSub || null;
    if (date !== toIsoDay(new Date(expense.createdAt))) body.date = date;
    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }
    editMutation.mutate(body);
  };

  const today = toIsoDay(new Date());
  const maxDate = toIsoDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const minDate = toIsoDay(new Date(new Date().getFullYear() - 5, 0, 1));

  return (
    <div className="expense-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Категория</label>
        <select
          className="input"
          value={categoryId}
          onChange={(e) => setCategoryId(Number(e.target.value))}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
          ))}
        </select>
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Сумма</label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Описание</label>
        <input
          className="input"
          value={subcategory}
          onChange={(e) => setSubcategory(e.target.value)}
          placeholder="опционально"
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Дата</label>
        <input
          className="input"
          type="date"
          value={date}
          min={minDate}
          max={maxDate}
          onChange={(e) => setDate(e.target.value)}
        />
        {date !== today && (
          <div className="card-hint" style={{ marginTop: 4, fontSize: 12 }}>
            Запись будет перенесена на выбранную дату.
          </div>
        )}
      </div>
      {editMutation.error && (
        <div className="error-msg">{(editMutation.error as Error).message}</div>
      )}
      <div className="form-row">
        <button type="button" className="btn" onClick={onCancel} disabled={editMutation.isPending}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={editMutation.isPending}
        >
          {editMutation.isPending ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

// ─── Limit Edit Dialog ───────────────────────────────────────

function LimitEditDialog({
  year,
  month,
  currentLimit,
  onClose,
  onSaved,
}: {
  year: number;
  month: number;
  currentLimit: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState(String(currentLimit));
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (body: SetMonthlyLimitRequest) =>
      api.put<MonthlyLimitDto>("/api/expenses/limit", body),
    onSuccess: onSaved,
    onError: (err) => setError((err as Error).message),
  });

  const submit = (applyToFuture: boolean) => {
    setError(null);
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Введите положительное число.");
      return;
    }
    if (parsed > 100_000_000) {
      setError("Слишком большая сумма.");
      return;
    }
    saveMutation.mutate({ year, month, amount: parsed, applyToFuture });
  };

  return (
    <>
      <div
        // Backdrop: blocks clicks below and dismisses on tap-outside.
        onClick={() => { if (!saveMutation.isPending) onClose(); }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.35)",
          zIndex: 99,
        }}
      />
      <div
        className="card"
        // Stop propagation so clicks inside the dialog don't bubble to the backdrop.
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 100,
          width: "min(90vw, 360px)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
      >
      <div className="card-hint" style={{ marginBottom: 8 }}>
        Лимит на {RU_MONTHS[month - 1]} {year}
      </div>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="350000"
        autoFocus
      />
      {error && <div className="error-msg" style={{ marginTop: 8 }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
        <button
          className="btn btn-primary"
          onClick={() => submit(false)}
          disabled={saveMutation.isPending}
        >
          Только этот месяц
        </button>
        <button
          className="btn btn-primary"
          onClick={() => submit(true)}
          disabled={saveMutation.isPending}
        >
          С этого месяца и далее
        </button>
        <button className="btn" onClick={onClose} disabled={saveMutation.isPending}>
          Отмена
        </button>
      </div>
      </div>
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

