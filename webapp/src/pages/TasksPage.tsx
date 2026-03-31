import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type {
  TaskWorkDto,
  TaskItemDto,
  CreateTaskWorkRequest,
  CreateTaskItemRequest,
} from "@shared/types";
import { useClosingConfirmation } from "../hooks/useClosingConfirmation";

export function TasksPage() {
  useClosingConfirmation();
  const [selectedWorkId, setSelectedWorkId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const { data: works, isLoading, error } = useQuery({
    queryKey: ["tasks"],
    queryFn: () => api.get<TaskWorkDto[]>("/api/tasks"),
  });

  const createWorkMutation = useMutation({
    mutationFn: (data: CreateTaskWorkRequest) =>
      api.post<TaskWorkDto>("/api/tasks", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setShowForm(false);
      setName("");
    },
  });

  const deleteWorkMutation = useMutation({
    mutationFn: (id: number) => api.del<void>(`/api/tasks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  if (selectedWorkId !== null) {
    return (
      <TaskList
        workId={selectedWorkId}
        onBack={() => setSelectedWorkId(null)}
      />
    );
  }

  return (
    <div className="page">
      <h1 className="page-title">Трекер задач</h1>

      {works && works.length === 0 && !showForm && (
        <div className="empty-state">
          <div className="empty-state-emoji">✅</div>
          <div className="empty-state-text">Нет проектов. Создайте первый!</div>
        </div>
      )}

      {works && works.length > 0 && (
        <div className="list">
          {works.map((w) => (
            <div key={w.id} className="list-item">
              <span className="list-item-emoji">{w.emoji}</span>
              <div
                className="list-item-content"
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedWorkId(w.id)}
              >
                <div className="list-item-title">{w.name}</div>
                <div className="list-item-hint">
                  {w.activeCount > 0
                    ? `${w.activeCount} активн.`
                    : "нет задач"}
                  {w.completedCount > 0 && ` | ${w.completedCount} выполн.`}
                </div>
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-icon btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Удалить проект со всеми задачами?")) {
                      deleteWorkMutation.mutate(w.id);
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

      {showForm ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) {
                createWorkMutation.mutate({ name: name.trim() });
              }
            }}
          >
            <div className="form-group">
              <label className="form-label">Название проекта</label>
              <input
                className="input"
                type="text"
                placeholder="Например: Работа"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                maxLength={100}
              />
            </div>
            {createWorkMutation.isError && (
              <div className="error-msg">
                {(createWorkMutation.error as Error).message}
              </div>
            )}
            <div className="form-row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowForm(false);
                  setName("");
                }}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={createWorkMutation.isPending || !name.trim()}
              >
                {createWorkMutation.isPending ? "Создание..." : "Создать"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button className="fab" onClick={() => setShowForm(true)} title="Новый проект">
          +
        </button>
      )}
    </div>
  );
}

// ─── Task List (within a work) ──────────────────────────────

function TaskList({ workId, onBack }: { workId: number; onBack: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [text, setText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks", workId],
    queryFn: () =>
      api.get<{ work: TaskWorkDto; tasks: TaskItemDto[] }>(`/api/tasks/${workId}`),
  });

  const addTaskMutation = useMutation({
    mutationFn: (req: CreateTaskItemRequest) =>
      api.post<TaskItemDto>(`/api/tasks/${workId}/items`, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", workId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setShowForm(false);
      setText("");
      setDeadline("");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (itemId: number) =>
      api.put<TaskItemDto>(`/api/tasks/items/${itemId}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", workId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: number) =>
      api.del<void>(`/api/tasks/items/${itemId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks", workId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;
  if (!data) return <div className="page">Проект не найден</div>;

  const { work, tasks } = data;
  const activeTasks = tasks.filter((t) => !t.isCompleted);
  const completedTasks = tasks.filter((t) => t.isCompleted);

  if (showHistory) {
    return (
      <TaskHistory
        workId={workId}
        workName={work.name}
        onBack={() => setShowHistory(false)}
      />
    );
  }

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Назад
      </button>
      <h1 className="page-title">{work.emoji} {work.name}</h1>
      <p className="page-subtitle">
        Активных: {activeTasks.length} | Выполненных: {completedTasks.length}
      </p>

      {activeTasks.length === 0 && completedTasks.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-emoji">📝</div>
          <div className="empty-state-text">Нет задач. Добавьте первую!</div>
        </div>
      )}

      <div className="list">
        {activeTasks.map((task) => {
          const dl = new Date(task.deadline);
          const isOverdue = dl.getTime() < Date.now();
          return (
            <div key={task.id} className={`list-item${isOverdue ? " overdue" : ""}`}>
              <button
                className="btn btn-icon"
                onClick={() => toggleMutation.mutate(task.id)}
                title="Отметить выполненной"
              >
                ⬜
              </button>
              <div className="list-item-content">
                <div className="list-item-title">{task.text}</div>
                <div className={`list-item-hint${isOverdue ? " text-danger" : ""}`}>
                  ⏰ {formatDeadline(dl)}
                  {isOverdue && " — просрочено"}
                </div>
              </div>
              <div className="list-item-actions">
                <button
                  className="btn btn-icon btn-danger"
                  onClick={() => {
                    if (confirm("Удалить задачу?")) {
                      deleteMutation.mutate(task.id);
                    }
                  }}
                  title="Удалить"
                >
                  🗑️
                </button>
              </div>
            </div>
          );
        })}

        {completedTasks.length > 0 && (
          <>
            <div className="section-title">Выполнено</div>
            {completedTasks.slice(0, 5).map((task) => (
              <div key={task.id} className="list-item">
                <button
                  className="btn btn-icon"
                  onClick={() => toggleMutation.mutate(task.id)}
                  title="Вернуть в работу"
                >
                  ✅
                </button>
                <div className="list-item-content">
                  <div className="list-item-title completed">{task.text}</div>
                  {task.completedAt && (
                    <div className="list-item-hint">
                      Выполнено: {formatDeadline(new Date(task.completedAt))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {completedTasks.length > 5 && (
              <button className="btn btn-small" onClick={() => setShowHistory(true)}>
                Показать все ({completedTasks.length})
              </button>
            )}
          </>
        )}
      </div>

      {showForm ? (
        <div className="card" style={{ marginTop: 16 }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim() && deadline) {
                addTaskMutation.mutate({ text: text.trim(), deadline });
              }
            }}
          >
            <div className="form-group">
              <label className="form-label">Описание задачи</label>
              <input
                className="input"
                type="text"
                placeholder="Что нужно сделать?"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                maxLength={500}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Дедлайн</label>
              <input
                className="input"
                type="datetime-local"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </div>
            {addTaskMutation.isError && (
              <div className="error-msg">
                {(addTaskMutation.error as Error).message}
              </div>
            )}
            <div className="form-row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowForm(false);
                  setText("");
                  setDeadline("");
                }}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={addTaskMutation.isPending || !text.trim() || !deadline}
              >
                {addTaskMutation.isPending ? "Добавление..." : "Добавить"}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button className="fab" onClick={() => setShowForm(true)} title="Добавить задачу">
          +
        </button>
      )}
    </div>
  );
}

// ─── Task History ───────────────────────────────────────────

function TaskHistory({
  workId,
  workName,
  onBack,
}: {
  workId: number;
  workName: string;
  onBack: () => void;
}) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ["tasks", workId, "history"],
    queryFn: () => api.get<TaskItemDto[]>(`/api/tasks/${workId}/history`),
  });

  if (isLoading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="page"><div className="error-msg">{(error as Error).message}</div></div>;

  return (
    <div className="page">
      <button className="btn btn-small" onClick={onBack} style={{ marginBottom: 12 }}>
        ← Назад
      </button>
      <h1 className="page-title">История: {workName}</h1>

      {(!history || history.length === 0) && (
        <div className="empty-state">
          <div className="empty-state-emoji">📜</div>
          <div className="empty-state-text">Нет выполненных задач</div>
        </div>
      )}

      <div className="list">
        {history?.map((task) => (
          <div key={task.id} className="list-item">
            <div className="list-item-content">
              <div className="list-item-title">✅ {task.text}</div>
              {task.completedAt && (
                <div className="list-item-hint">
                  Выполнено: {formatDeadline(new Date(task.completedAt))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function formatDeadline(date: Date): string {
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
