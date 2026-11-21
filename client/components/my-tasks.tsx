"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { boardPriorityLabels, boardStatusLabels, type TaskPriority, type TaskStatus } from "./task-board";

type Mine = { id: string; title: string; code: string; status: TaskStatus; priority: TaskPriority; dueDate: string | null;
  project: { id: string; key: string; name: string } };

export function MyTasks({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const [tasks, setTasks] = useState<Mine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"OPEN" | "ALL" | "DONE">("OPEN");
  async function refresh() {
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/tasks/mine", { cache: "no-store", credentials: "same-origin" });
      const data: { message?: string; tasks?: Mine[] } = await res.json();
      if (!res.ok) throw new Error(data.message ?? "Unable to load assigned tasks");
      setTasks(data.tasks ?? []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load assigned tasks"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const shown = tasks.filter((t) => filter === "ALL" || (filter === "DONE" ? t.status === "DONE" : t.status !== "DONE"));
  return <>
    <div className="pf-heading-row"><div><div className="eyebrow">WORKSPACE / MY TASKS</div><h1>Your work, <span>all in one place.</span></h1><p>Tasks assigned to you across your active projects.</p></div>
      <button type="button" className="pf-btn pf-outline" onClick={() => void refresh()}><Icon name="refresh" size={15}/> Refresh</button></div>
    <section className="pf-panel"><div className="pf-panel-header"><div><h2>Assigned to you</h2><p>{tasks.filter((t) => t.status !== "DONE").length} open · {tasks.length} total</p></div></div>
      <div className="pf-filters"><select aria-label="Filter my tasks" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="OPEN">Open tasks</option><option value="ALL">All tasks</option><option value="DONE">Completed</option></select></div>
      {loading ? <p className="pf-muted-pad">Loading your tasks…</p> : error ? <div className="pf-alert" role="alert">{error}</div> : shown.length === 0 ? <div className="pf-empty"><Icon name="checklist" size={30}/><strong>Nothing assigned here</strong><p>Open a project, create a task and set its assignee to “Me”.</p></div> :
        <div className="pf-mytasks-list">{shown.map((task) => <button type="button" key={task.id} onClick={() => onOpenProject(task.project.id)} className="pf-mytasks-row">
          <span className={`pf-lane-dot pf-dot-${task.status.toLowerCase()}`}/><div><strong>{task.title}</strong><small>{task.project.name} · {task.code}</small></div>
          <span className={`pf-priority pf-priority-${task.priority.toLowerCase()}`}>{boardPriorityLabels[task.priority]}</span>
          <span className="pf-mytasks-due">{task.dueDate ? new Date(task.dueDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "No due date"}</span>
          <span className="pf-task-status">{boardStatusLabels[task.status]}</span><Icon name="chevron-right" size={16}/>
        </button>)}</div>}
    </section>
  </>;
}
