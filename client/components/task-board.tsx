"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { Icon } from "./icons";

export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type BoardTask = {
  id: string; projectId: string; code: string; title: string; description: string | null;
  status: TaskStatus; priority: TaskPriority; position: number; dueDate: string | null;
  assigneeId: string | null; assignee: { id: string; name: string } | null;
  createdAt: string; updatedAt: string;
};

export const boardStatuses: TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];
export const boardStatusLabels: Record<TaskStatus, string> = {
  TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done",
};
export const boardPriorityLabels: Record<TaskPriority, string> = {
  LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent",
};

type TaskForm = { title: string; description: string; status: TaskStatus; priority: TaskPriority; dueDate: string; assigneeId: string };
const blank = (status: TaskStatus = "TODO"): TaskForm => ({ title: "", description: "", status, priority: "MEDIUM", dueDate: "", assigneeId: "" });

async function taskApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, credentials: "same-origin", cache: "no-store" });
  const data: { message?: string } = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? `HTTP ${response.status}`);
  return data as T;
}

export function TaskBoard({ projectId, currentUser, readOnly, onTasksChanged }: {
  projectId: string;
  currentUser: { id: string; name: string };
  readOnly: boolean;
  onTasksChanged: () => void;
}) {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [teamMembers, setTeamMembers] = useState<Array<{ userId: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<"ALL" | TaskPriority>("ALL");
  const [assignee, setAssignee] = useState<"ALL" | "MINE" | "UNASSIGNED">("ALL");
  const [dragged, setDragged] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskForm>(blank());
  const [formError, setFormError] = useState("");

  const base = `/projects/${encodeURIComponent(projectId)}/tasks`;
  const refresh = useCallback(async () => {
    try {
      setError("");
      const result = await taskApi<{ tasks: BoardTask[] }>(`/projects/${encodeURIComponent(projectId)}/tasks`);
      setTasks(result.tasks);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load tasks"); }
    finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { setLoading(true); void refresh(); }, [refresh]);
  useEffect(() => {
    let active = true;
    void fetch("/api/team", { credentials: "same-origin", cache: "no-store" }).then(async (res) => {
      if (!res.ok) return;
      const body = await res.json() as { members: Array<{ userId: string; name: string }> };
      if (active) setTeamMembers(body.members);
    }).catch(() => { /* still allow self-assignment if team API is unavailable */ });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => tasks.filter((task) => {
    const term = query.trim().toLowerCase();
    return (term === "" || `${task.title} ${task.description ?? ""} ${task.code}`.toLowerCase().includes(term))
      && (priority === "ALL" || task.priority === priority)
      && (assignee === "ALL" || (assignee === "MINE" ? task.assigneeId === currentUser.id : !task.assigneeId));
  }), [tasks, query, priority, assignee, currentUser.id]);

  const startCreate = (status: TaskStatus = "TODO") => {
    setEditingId(null); setForm(blank(status)); setFormError(""); setModal("create");
  };
  const startEdit = (task: BoardTask) => {
    setEditingId(task.id);
    setForm({ title: task.title, description: task.description ?? "", status: task.status,
      priority: task.priority, dueDate: task.dueDate?.slice(0, 10) ?? "", assigneeId: task.assigneeId ?? "" });
    setFormError(""); setModal("edit");
  };
  const changed = async (message: string) => {
    await refresh();
    onTasksChanged();
    setNotice(message);
  };

  async function saveTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || readOnly || form.title.trim().length < 3) return;
    setBusy(true); setFormError("");
    try {
      await taskApi(modal === "edit" && editingId ? `${base}/${encodeURIComponent(editingId)}` : base, {
        method: modal === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: form.title.trim(), description: form.description.trim(),
          status: form.status, priority: form.priority, dueDate: form.dueDate || null, assigneeId: form.assigneeId || null }),
      });
      setModal(null);
      await changed(modal === "edit" ? "Task saved." : "New task created.");
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Could not save task"); }
    finally { setBusy(false); }
  }

  async function deleteTask() {
    if (!editingId || busy || readOnly) return;
    const task = tasks.find((item) => item.id === editingId);
    if (!window.confirm(`Delete task “${task?.title ?? ""}” permanently?`)) return;
    setBusy(true); setFormError("");
    try {
      await taskApi(`${base}/${encodeURIComponent(editingId)}`, { method: "DELETE" });
      setModal(null);
      await changed("Task deleted.");
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : "Could not delete task"); }
    finally { setBusy(false); }
  }

  async function moveTask(taskId: string, status: TaskStatus, beforeTaskId: string | null) {
    if (busy || readOnly || taskId === beforeTaskId) return;
    setBusy(true); setError("");
    try {
      await taskApi(`${base}/reorder`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, status, beforeTaskId }) });
      await changed("Board updated.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to move task"); }
    finally { setBusy(false); setDragged(null); setOverColumn(null); }
  }

  const dropOnLane = (event: DragEvent<HTMLElement>, status: TaskStatus) => {
    event.preventDefault();
    const taskId = dragged || event.dataTransfer.getData("text/plain");
    if (taskId) void moveTask(taskId, status, null);
  };
  const dropBefore = (event: DragEvent<HTMLElement>, status: TaskStatus, beforeTaskId: string) => {
    event.preventDefault(); event.stopPropagation();
    const taskId = dragged || event.dataTransfer.getData("text/plain");
    if (taskId) void moveTask(taskId, status, beforeTaskId);
  };
  const formatDue = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const filtersActive = Boolean(query || priority !== "ALL" || assignee !== "ALL");

  return <section className="pf-panel pf-board-section" aria-label="Kanban task board">
    <div className="pf-board-heading">
      <div><div className="eyebrow">PROJECT WORKFLOW</div><h2>Task board <span className="pf-board-number">{tasks.length}</span></h2>
        <p>Move cards between stages, set priorities and keep work on track.</p></div>
      <div className="pf-board-actions"><button type="button" className="pf-btn pf-outline" onClick={() => void refresh()} disabled={loading || busy}><Icon name="refresh" size={15}/> Refresh</button>
        {!readOnly ? <button type="button" className="pf-btn pf-primary" onClick={() => startCreate()}>+ New task</button> : null}</div>
    </div>
    {readOnly ? <div className="pf-board-banner">This project is archived. Restore it to create or change tasks.</div> : null}
    {notice ? <div className="pf-toast pf-board-toast" role="status"><Icon name="check" size={15}/>{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div> : null}
    {error ? <div className="pf-alert" role="alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></div> : null}
    <div className="pf-board-filterbar">
      <input aria-label="Search tasks" placeholder="Search tasks by title or code…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Filter by priority" value={priority} onChange={(e) => setPriority(e.target.value as "ALL" | TaskPriority)}>
        <option value="ALL">All priorities</option>{(["URGENT", "HIGH", "MEDIUM", "LOW"] as TaskPriority[]).map((p) => <option value={p} key={p}>{boardPriorityLabels[p]}</option>)}
      </select>
      <select aria-label="Filter by assignee" value={assignee} onChange={(e) => setAssignee(e.target.value as typeof assignee)}>
        <option value="ALL">Everyone</option><option value="MINE">Assigned to me</option><option value="UNASSIGNED">Unassigned</option>
      </select>
      {filtersActive ? <button className="pf-clear-filters" type="button" onClick={() => { setQuery(""); setPriority("ALL"); setAssignee("ALL"); }}>Clear</button> : null}
    </div>
    {loading ? <div className="pf-muted-pad">Loading tasks…</div> : <div className="pf-kanban-scroller"><div className="pf-kanban">
      {boardStatuses.map((status) => {
        const lane = visible.filter((task) => task.status === status).sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
        return <div key={status} className={`pf-kanban-lane ${overColumn === status ? "pf-lane-over" : ""}`} onDragOver={(e) => { if (!readOnly && dragged) { e.preventDefault(); setOverColumn(status); } }} onDrop={(e) => dropOnLane(e, status)}>
          <div className="pf-lane-top"><div><span className={`pf-lane-dot pf-dot-${status.toLowerCase()}`}/><strong>{boardStatusLabels[status]}</strong><span className="pf-lane-count">{lane.length}</span></div>
            {!readOnly ? <button aria-label={`Add task to ${boardStatusLabels[status]}`} type="button" onClick={() => startCreate(status)}>+</button> : null}</div>
          <div className="pf-lane-cards">{lane.map((task) => {
            const overdue = Boolean(task.dueDate && task.status !== "DONE" && new Date(task.dueDate).getTime() < Date.now());
            return <button type="button" key={task.id} className={`pf-task-card ${dragged === task.id ? "pf-card-dragged" : ""}`} draggable={!readOnly && !busy && !filtersActive}
              onDragStart={(event) => { setDragged(task.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }}
              onDragEnd={() => { setDragged(null); setOverColumn(null); }}
              onDragOver={(event) => { if (dragged && !filtersActive) event.preventDefault(); }}
              onDrop={(event) => { if (!filtersActive) dropBefore(event, status, task.id); }}
              onClick={() => { if (!dragged) startEdit(task); }}>
              <div className="pf-task-card-top"><span>{task.code}</span><span className={`pf-priority pf-priority-${task.priority.toLowerCase()}`}>{boardPriorityLabels[task.priority]}</span></div>
              <strong className="pf-task-title">{task.title}</strong>
              {task.description ? <p>{task.description}</p> : null}
              <div className="pf-task-card-foot"><span className={overdue ? "pf-overdue" : ""}>{task.dueDate ? `◷ ${formatDue(task.dueDate)}` : "No due date"}</span>
                <span className={`pf-task-avatar ${task.assignee ? "" : "pf-unassigned"}`} title={task.assignee?.name ?? "Unassigned"}>{task.assignee?.name.slice(0, 1).toUpperCase() ?? "–"}</span></div>
            </button>;
          })}
          {lane.length === 0 ? <div className="pf-lane-empty">{filtersActive ? "No matching tasks" : "Drop tasks here"}</div> : null}</div>
        </div>;
      })}
    </div></div>}
    <div className="pf-board-hint">Tip: drag &amp; drop is available on desktop when filters are cleared. On touch devices, open a task and change its status.</div>

    {modal ? <div className="pf-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}>
      <section className="pf-modal pf-task-modal" role="dialog" aria-modal="true" aria-labelledby="pf-task-modal-title">
        <div className="pf-modal-head"><div className="eyebrow">TASK MANAGEMENT</div><button className="pf-close" type="button" disabled={busy} onClick={() => setModal(null)}>×</button></div>
        <h2 id="pf-task-modal-title">{modal === "create" ? "Create task" : "Edit task"}</h2>
        <p>Plan the next step and keep work moving.</p>
        <form onSubmit={(event) => void saveTask(event)}>
          <label htmlFor="pf-task-title">Task title</label>
          <input id="pf-task-title" autoFocus required minLength={3} maxLength={120} disabled={readOnly} value={form.title} placeholder="e.g. Review campaign assets" onChange={(e) => setForm((old) => ({ ...old, title: e.target.value }))}/>
          <label htmlFor="pf-task-description">Description (optional)</label>
          <textarea id="pf-task-description" rows={3} maxLength={2000} disabled={readOnly} value={form.description} onChange={(e) => setForm((old) => ({ ...old, description: e.target.value }))}/>
          <div className="pf-task-form-grid"><div><label htmlFor="pf-task-status">Status</label><select id="pf-task-status" value={form.status} disabled={readOnly} onChange={(e) => setForm((old) => ({ ...old, status: e.target.value as TaskStatus }))}>{boardStatuses.map((s) => <option key={s} value={s}>{boardStatusLabels[s]}</option>)}</select></div>
            <div><label htmlFor="pf-task-priority">Priority</label><select id="pf-task-priority" value={form.priority} disabled={readOnly} onChange={(e) => setForm((old) => ({ ...old, priority: e.target.value as TaskPriority }))}>{(["LOW", "MEDIUM", "HIGH", "URGENT"] as TaskPriority[]).map((p) => <option value={p} key={p}>{boardPriorityLabels[p]}</option>)}</select></div>
            <div><label htmlFor="pf-task-due">Due date</label><input type="date" id="pf-task-due" value={form.dueDate} disabled={readOnly} onChange={(e) => setForm((old) => ({ ...old, dueDate: e.target.value }))}/></div>
            <div><label htmlFor="pf-task-assignee">Assignee</label><select id="pf-task-assignee" value={form.assigneeId} disabled={readOnly} onChange={(e) => setForm((old) => ({ ...old, assigneeId: e.target.value }))}><option value="">Unassigned</option><option value={currentUser.id}>Me ({currentUser.name})</option>{teamMembers.filter((m) => m.userId !== currentUser.id).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></div></div>
          {formError ? <div className="pf-alert" role="alert">{formError}</div> : null}
          <div className="pf-modal-actions">{modal === "edit" && !readOnly ? <button type="button" className="pf-btn pf-danger pf-delete-task" disabled={busy} onClick={() => void deleteTask()}>Delete task</button> : null}
            <button type="button" className="pf-btn pf-outline" disabled={busy} onClick={() => setModal(null)}>Close</button>
            {!readOnly ? <button type="submit" className="pf-btn pf-primary" disabled={busy || form.title.trim().length < 3}>{busy ? "Saving…" : modal === "create" ? "Create task" : "Save task"}</button> : null}
          </div>
        </form>
      </section>
    </div> : null}
  </section>;
}
