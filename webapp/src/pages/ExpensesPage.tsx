import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  CategoryDto,
  ExpenseReportDto,
  AddExpenseRequest,
} from "@shared/types";

export function ExpensesPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (categoryId === null || !amount.trim()) return;
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return;
    addMutation.mutate({ categoryId, amount: parsed });
  };

  if (reportLoading) return <div className="loading">Загрузка...</div>;
  if (reportError) return <div className="page"><div className="error-msg">{(reportError as Error).message}</div></div>;

  const total = report?.total ?? 0;
  const limit = report?.monthlyLimit ?? 0;
  const progress = limit > 0 ? Math.min((total / limit) * 100, 100) : 0;

  return (
    <div className="page">
      <h1 className="page-title">Расходы</h1>

      <div className="card">
        <div className="card-hint">{report?.month ?? "Текущий месяц"}</div>
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
            <div key={cat.categoryId} className="list-item">
              <span className="list-item-emoji">{cat.categoryEmoji}</span>
              <div className="list-item-content">
                <div className="list-item-title">{cat.categoryName}</div>
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
