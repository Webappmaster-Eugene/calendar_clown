import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { VoiceButton } from "../components/VoiceButton";
import type {
  GoalSetDto,
  GoalDto,
  CreateGoalSetRequest,
  CreateGoalRequest,
  GoalPeriod,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

const PERIOD_LABELS: Record<GoalPeriod, string> = {
  current: "Текущий",
  month: "Месяц",
  year: "Год",
  "5years": "5 лет",
};

export function GoalsPage() {
  useClosingConfirmation();
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [period, setPeriod] = useState<GoalPeriod>("current");
  const queryClient = useQueryClient();

  const { data: sets, isLoading, error } = useQuery({
    queryKey: ["goals"],
    queryFn: () => api.get<GoalSetDto[]>("/api/goals"),
  });

  const createSetMutation = useMutation({
    mutationFn: (data: CreateGoalSetRequest) =>
      api.post<GoalSetDto>("/api/goals", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setShowForm(false);
      setName("");
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedSetId !== null) {
    return (
      <GoalsList
        goalSetId={selectedSetId}
        onBack={() => setSelectedSetId(null)}
      />
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Цели</h1>

      {sets && sets.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">🎯</div>
          <div className="empty-state-text">Нет наборов целей</div>
        </div>
      )}

      {sets && sets.length > 0 && (
        <div className="list">
          {sets.map((s) => (
            <div key={s.id} className="list-item">
              <span className="list-item-emoji">{s.emoji || "🎯"}</span>
              <div
                className="list-item-content"
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedSetId(s.id)}
              >
                <div className="list-item-title">{s.name}</div>
                <div className="list-item-hint">
                  {s.completedCount}/{s.totalCount} выполнено &middot; {PERIOD_LABELS[s.period] ?? s.period}
                  {s.deadline ? ` · до ${new Date(s.deadline).toLocaleDateString("ru-RU")}` : ""}
                </div>
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => {
                    if (confirm(`Удалить набор "${s.name}" и все его цели?`)) {
                      deleteSetMutation.mutate(s.id);
                    }
                  }}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="card" style={{ marginTop: 16 }}>
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) createSetMutation.mutate({ name: name.trim(), period }); }}>
            <div className="form-group">
              <label className="form-label">Название</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название набора целей" />
            </div>
            <div className="form-group">
              <label className="form-label">Период</label>
              <select className="input" value={period} onChange={(e) => setPeriod(e.target.value as GoalPeriod)}>
                <option value="current">Текущий</option>
                <option value="month">Месяц</option>
                <option value="year">Год</option>
                <option value="5years">5 лет</option>
              </select>
            </div>
            {createSetMutation.error && <div className="error-msg">{(createSetMutation.error as Error).message}</div>}
            <div className="form-row">
              <button type="button" className="btn" onClick={() => setShowForm(false)}>Отмена</button>
              <button type="submit" className="btn btn-primary" disabled={createSetMutation.isPending || !name.trim()}>
                {createSetMutation.isPending ? "Создание..." : "Создать"}
              </button>
            </div>
          </form>
        </div>
      )}

      {!showForm && (
        <button className="fab" onClick={() => setShowForm(true)}>+</button>
      )}
    </div>
  );
}

function GoalsList({ goalSetId, onBack }: { goalSetId: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const { data: goalSetData, isLoading } = useQuery({
    queryKey: ["goals", "list", goalSetId],
    queryFn: () => api.get<{ goalSet: GoalSetDto; goals: GoalDto[] }>(`/api/goals/${goalSetId}`),
  });

  const goalSet = goalSetData?.goalSet;
  const goals = goalSetData?.goals;

  const addMutation = useMutation({
    mutationFn: (data: CreateGoalRequest) =>
      api.post<GoalDto>(`/api/goals/${goalSetId}/goals`, { text: data.text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setText("");
    },
  });

  const updateGoalMutation = useMutation({
    mutationFn: ({ goalId, text: newText }: { goalId: number; text: string }) =>
      api.put<GoalDto>(`/api/goals/goals/${goalId}`, { text: newText }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setEditingGoalId(null);
      setEditText("");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (goalId: number) =>
      api.put<GoalDto>(`/api/goals/goals/${goalId}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  const deleteGoalMutation = useMutation({
    mutationFn: (goalId: number) =>
      api.del<void>(`/api/goals/goals/${goalId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  const startEditGoal = (goal: GoalDto) => {
    setEditingGoalId(goal.id);
    setEditText(goal.text);
  };

  const cancelEditGoal = () => {
    setEditingGoalId(null);
    setEditText("");
  };

  const handleEditSubmit = (goalId: number) => {
    if (!editText.trim()) return;
    updateGoalMutation.mutate({ goalId, text: editText.trim() });
  };

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        К наборам
      </button>

      {goalSet && (
        <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.7 }}>
          {goalSet.completedCount}/{goalSet.totalCount} выполнено
          {goalSet.deadline ? ` · до ${new Date(goalSet.deadline).toLocaleDateString("ru-RU")}` : ""}
        </div>
      )}

      {isLoading && <div className="loading">Загрузка целей...</div>}

      {goals && goals.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-text">Нет целей. Добавьте первую ниже.</div>
        </div>
      )}

      {goals && goals.length > 0 && (
        <div className="list">
          {goals.map((goal) => (
            <div key={goal.id} className="list-item">
              <button
                className={`toggle ${goal.isCompleted ? "active" : ""}`}
                onClick={() => toggleMutation.mutate(goal.id)}
              />
              <div className="list-item-content">
                {editingGoalId === goal.id ? (
                  <form
                    style={{ display: "flex", gap: 6, alignItems: "center" }}
                    onSubmit={(e) => { e.preventDefault(); handleEditSubmit(goal.id); }}
                  >
                    <input
                      className="input"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      style={{ flex: 1, padding: "4px 8px", fontSize: 14 }}
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="btn btn-primary btn-small"
                      disabled={updateGoalMutation.isPending || !editText.trim()}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={cancelEditGoal}
                    >
                      ✕
                    </button>
                  </form>
                ) : (
                  <>
                    <div
                      className="list-item-title"
                      style={{ textDecoration: goal.isCompleted ? "line-through" : "none" }}
                    >
                      {goal.text}
                    </div>
                    {goal.completedAt && (
                      <div className="list-item-hint">
                        Выполнено {new Date(goal.completedAt).toLocaleDateString("ru-RU")}
                      </div>
                    )}
                  </>
                )}
              </div>
              {editingGoalId !== goal.id && (
                <div className="list-item-actions">
                  <button
                    className="btn btn-icon"
                    onClick={() => startEditGoal(goal)}
                    title="Редактировать"
                  >
                    ✏️
                  </button>
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={() => deleteGoalMutation.mutate(goal.id)}
                    disabled={deleteGoalMutation.isPending}
                    title="Удалить"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <form
        style={{ marginTop: 16 }}
        onSubmit={(e) => { e.preventDefault(); if (text.trim()) addMutation.mutate({ goalSetId, text: text.trim() }); }}
      >
        <div className="form-row">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Новая цель"
          />
          <VoiceButton
            mode="goals"
            onResult={(transcript) => setText((prev) => prev ? `${prev} ${transcript}` : transcript)}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={addMutation.isPending || !text.trim()}
          >
            Добавить
          </button>
        </div>
        {addMutation.error && <div className="error-msg" style={{ marginTop: 8 }}>{(addMutation.error as Error).message}</div>}
      </form>
    </div>
  );
}
