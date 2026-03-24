import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  GoalSetDto,
  GoalDto,
  CreateGoalSetRequest,
  CreateGoalRequest,
  GoalPeriod,
} from "@shared/types";

export function GoalsPage() {
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [period, setPeriod] = useState<GoalPeriod>("current");
  const queryClient = useQueryClient();

  const { data: sets, isLoading, error } = useQuery({
    queryKey: ["goals", "sets"],
    queryFn: () => api.get<GoalSetDto[]>("/api/goals/sets"),
  });

  const createSetMutation = useMutation({
    mutationFn: (data: CreateGoalSetRequest) =>
      api.post<GoalSetDto>("/api/goals/sets", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals", "sets"] });
      setShowForm(false);
      setName("");
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
            <button
              key={s.id}
              className="list-item"
              style={{ cursor: "pointer", border: "none", width: "100%", textAlign: "left" }}
              onClick={() => setSelectedSetId(s.id)}
            >
              <span className="list-item-emoji">{s.emoji || "🎯"}</span>
              <div className="list-item-content">
                <div className="list-item-title">{s.name}</div>
                <div className="list-item-hint">
                  {s.completedCount}/{s.totalCount} выполнено &middot; {s.period}
                </div>
              </div>
            </button>
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

  const { data: goals, isLoading } = useQuery({
    queryKey: ["goals", "list", goalSetId],
    queryFn: () => api.get<GoalDto[]>(`/api/goals/sets/${goalSetId}/goals`),
  });

  const addMutation = useMutation({
    mutationFn: (data: CreateGoalRequest) =>
      api.post<GoalDto>("/api/goals", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      setText("");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (goalId: number) =>
      api.put<GoalDto>(`/api/goals/${goalId}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
  });

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        К наборам
      </button>

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
                <div
                  className="list-item-title"
                  style={{ textDecoration: goal.isCompleted ? "line-through" : "none" }}
                >
                  {goal.text}
                </div>
              </div>
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
