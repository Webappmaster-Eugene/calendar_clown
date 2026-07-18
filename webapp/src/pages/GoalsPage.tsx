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
  GoalSetVisibility,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { useHaptic } from "../hooks/useHaptic";

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
  const [editingSetId, setEditingSetId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmoji, setEditEmoji] = useState("");
  const [editVisibility, setEditVisibility] = useState<GoalSetVisibility>("private");
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

  const updateSetMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name: string; emoji: string; visibility: GoalSetVisibility }) =>
      api.put<GoalSetDto>(`/api/goals/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setEditingSetId(null);
    },
  });

  const startEditSet = (s: GoalSetDto) => {
    setEditingSetId(s.id);
    setEditName(s.name);
    setEditEmoji(s.emoji ?? "");
    setEditVisibility(s.visibility);
    setShowForm(false);
  };

  if (isLoading) return <div className="page"><h1 className="page-title">Цели</h1><ListSkeleton /></div>;
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
            editingSetId === s.id ? (
              <div key={s.id} className="card" style={{ marginBottom: 8 }}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editName.trim()) {
                      updateSetMutation.mutate({
                        id: s.id,
                        name: editName.trim(),
                        emoji: editEmoji.trim() || "🎯",
                        visibility: editVisibility,
                      });
                    }
                  }}
                >
                  <div className="form-row">
                    <input
                      className="input"
                      value={editEmoji}
                      onChange={(e) => setEditEmoji(e.target.value)}
                      placeholder="🎯"
                      style={{ width: 56, textAlign: "center" }}
                      maxLength={4}
                    />
                    <input
                      className="input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Название набора"
                      autoFocus
                    />
                  </div>
                  <div className="form-group" style={{ marginTop: 8 }}>
                    <label className="form-label">Видимость</label>
                    <select
                      className="input"
                      value={editVisibility}
                      onChange={(e) => setEditVisibility(e.target.value as GoalSetVisibility)}
                    >
                      <option value="private">Приватный</option>
                      <option value="public">Публичный</option>
                    </select>
                  </div>
                  {updateSetMutation.error && <div className="error-msg">{(updateSetMutation.error as Error).message}</div>}
                  <div className="form-row" style={{ marginTop: 8 }}>
                    <button type="button" className="btn" onClick={() => setEditingSetId(null)}>Отмена</button>
                    <button type="submit" className="btn btn-primary" disabled={updateSetMutation.isPending || !editName.trim()}>
                      {updateSetMutation.isPending ? "Сохранение..." : "Сохранить"}
                    </button>
                  </div>
                </form>
              </div>
            ) : (
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
                  {s.visibility === "public" ? " · 🌐 публичный" : ""}
                  {s.deadline ? ` · до ${new Date(s.deadline).toLocaleDateString("ru-RU")}` : ""}
                </div>
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-icon"
                  onClick={() => startEditSet(s)}
                  title="Редактировать"
                >
                  ✏️
                </button>
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
            )
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
  const { selection } = useHaptic();
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
    meta: { skipHapticSuccess: true },
    onMutate: async (goalId: number) => {
      const key = ["goals", "list", goalSetId];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<{ goalSet: GoalSetDto; goals: GoalDto[] }>(key);
      if (prev) {
        const target = prev.goals.find((g) => g.id === goalId);
        const delta = target ? (target.isCompleted ? -1 : 1) : 0;
        queryClient.setQueryData(key, {
          goalSet: { ...prev.goalSet, completedCount: prev.goalSet.completedCount + delta },
          goals: prev.goals.map((g) =>
            g.id === goalId
              ? { ...g, isCompleted: !g.isCompleted, completedAt: g.isCompleted ? null : new Date().toISOString() }
              : g,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _goalId, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["goals", "list", goalSetId], ctx.prev);
    },
    onSettled: () => {
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
                onClick={() => { selection(); toggleMutation.mutate(goal.id); }}
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
