import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import type {
  CategoryDto,
  ExpenseReportDto,
  AddExpenseRequest,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

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

export function ExpensesPage() {
  useClosingConfirmation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [voiceText, setVoiceText] = useState("");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [drilldownCategoryId, setDrilldownCategoryId] = useState<number | null>(null);

  const { data: report, isLoading: reportLoading, error: reportError } = useQuery({
    queryKey: ["expenses", "report"],
    queryFn: () => api.get<ExpenseReportDto>("/api/expenses/report"),
  });

  const { data: categories } = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => api.get<CategoryDto[]>("/api/expenses/categories"),
  });

  const addMutation = useMutation({
    mutationFn: (data: AddExpenseRequest) =>
      api.post<void>("/api/expenses", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setShowForm(false);
      setAmount("");
      setCategoryId(null);
    },
  });

  /** Add expense from natural language text (voice or typed) */
  const addTextMutation = useMutation({
    mutationFn: (text: string) =>
      api.post<void>("/api/expenses", { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setVoiceText("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (categoryId === null || !amount.trim()) return;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    addMutation.mutate({ categoryId, amount: parsed });
  };

  if (drilldownCategoryId !== null) {
    return (
      <ExpenseDrilldown
        categoryId={drilldownCategoryId}
        onBack={() => setDrilldownCategoryId(null)}
      />
    );
  }

  if (reportLoading) return <div className="loading">Загрузка...</div>;
  if (reportError) return <div className="page"><div className="error-msg">{(reportError as Error).message}</div></div>;

  const total = report?.total ?? 0;
  const limit = report?.monthlyLimit ?? 0;
  const progress = limit > 0 ? Math.min((total / limit) * 100, 100) : 0;

  return (
    <div className="page">
      <h1 className="page-title">Расходы</h1>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="card-hint">{report?.month ?? "Текущий месяц"}</div>
          <button
            className="btn btn-small"
            onClick={() => {
              window.open("/api/expenses/excel", "_blank");
            }}
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
              onClick={() => setDrilldownCategoryId(cat.categoryId)}
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

      <div className="section-title">Быстрый ввод</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
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
            // data contains { transcript, expense: { category, amount, ... } }
            const d = data as Record<string, unknown> | undefined;
            if (d?.confirmation && typeof d.confirmation === "string") {
              setVoiceText(d.confirmation as string);
              setTimeout(() => setVoiceText(""), 3000);
            }
          }}
          onError={(err) => {
            setVoiceError(err);
          }}
        />
      </div>
      {voiceError && (
        <div className="error-msg" style={{ marginBottom: 8 }}>{voiceError}</div>
      )}
      {addTextMutation.error && (
        <div className="error-msg">{(addTextMutation.error as Error).message}</div>
      )}
      {addTextMutation.isPending && (
        <div className="card-hint" style={{ marginBottom: 8 }}>Добавление...</div>
      )}

      {!showForm ? (
        <button
          className="fab"
          onClick={() => setShowForm(true)}
        >
          +
        </button>
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
                  <option key={cat.id} value={cat.id}>
                    {cat.emoji} {cat.name}
                  </option>
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
            {addMutation.error && (
              <div className="error-msg">{(addMutation.error as Error).message}</div>
            )}
            <div className="form-row">
              <button
                type="button"
                className="btn"
                onClick={() => setShowForm(false)}
              >
                Отмена
              </button>
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

function ExpenseDrilldown({ categoryId, onBack }: { categoryId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "drilldown", categoryId, page],
    queryFn: () =>
      api.get<DrilldownResponse>(
        `/api/expenses/drilldown?categoryId=${categoryId}&page=${page}&limit=${LIMIT}`
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
