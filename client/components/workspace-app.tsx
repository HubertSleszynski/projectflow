"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import { TaskBoard } from "./task-board";
import { MyTasks } from "./my-tasks";
import { TeamManagement } from "./team-management";
import type { CurrentSession } from "./auth-gate";

type ProjectStatus = "ACTIVE" | "ON_HOLD" | "COMPLETED" | "ARCHIVED";
type Project = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  taskCount: number;
  completedTaskCount: number;
  overdueTaskCount: number;
  createdAt: string;
  updatedAt: string;
};
type TaskPreview = {
  id: string;
  code: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate: string | null;
};
type ProjectDetail = Omit<Project, "completedTaskCount" | "overdueTaskCount"> & { tasks: TaskPreview[] };
type View = "overview" | "projects" | "details" | "tasks" | "team";
type Filter = "ALL" | ProjectStatus;
type ProjectForm = { name: string; description: string };
const EMPTY_FORM = { name: "", description: "" };
const statusLabels: Record<ProjectStatus, string> = {
  ACTIVE: "Active", ON_HOLD: "On hold", COMPLETED: "Completed", ARCHIVED: "Archived",
};
const taskLabels: Record<TaskPreview["status"], string> = {
  TODO: "To do", IN_PROGRESS: "In progress", IN_REVIEW: "In review", DONE: "Done",
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new Error("Could not connect to ProjectFlow. Please try again in a moment.");
  }
  const payload: { message?: string } = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message ?? `Request failed (HTTP ${response.status})`);
  return payload as T;
}
function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function numberPercentage(part: number, total: number) {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

export function WorkspaceApp({ session, onLogout }: { session: CurrentSession; onLogout: () => void }) {
  const initials = session.user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
  const [view, setView] = useState<View>("overview");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm>(EMPTY_FORM);
  const [modalError, setModalError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      const data = await api<{ projects: Project[] }>("/projects");
      setProjects(data.projects);
      return data.projects;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load projects");
      return null;
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const fetchDetail = useCallback(async (id: string) => {
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await api<{ project: ProjectDetail }>(`/projects/${encodeURIComponent(id)}`);
      setDetail(result.project);
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? error.message : "Could not load project details");
    } finally { setDetailLoading(false); }
  }, []);

  useEffect(() => {
    if (view === "details" && selectedId) void fetchDetail(selectedId);
  }, [fetchDetail, selectedId, view]);

  const totals = useMemo(() => {
    const nonArchived = projects.filter((p) => p.status !== "ARCHIVED");
    return {
      active: nonArchived.filter((p) => p.status === "ACTIVE").length,
      projects: nonArchived.length,
      tasks: nonArchived.reduce((sum, p) => sum + p.taskCount, 0),
      done: nonArchived.reduce((sum, p) => sum + p.completedTaskCount, 0),
      overdue: nonArchived.reduce((sum, p) => sum + p.overdueTaskCount, 0),
      archived: projects.length - nonArchived.length,
    };
  }, [projects]);
  const filtered = useMemo(() => projects.filter((project) => {
    const matchesStatus = filter === "ALL" ? project.status !== "ARCHIVED" : project.status === filter;
    const term = search.trim().toLowerCase();
    return matchesStatus && (project.name.toLowerCase().includes(term) || project.key.toLowerCase().includes(term) || (project.description ?? "").toLowerCase().includes(term));
  }), [projects, filter, search]);

  const openProject = (id: string) => {
    setSelectedId(id);
    setDetail(null);
    setNotice("");
    setView("details");
  };
  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalError("");
    setModal("create");
  };
  const openEdit = (project: Pick<Project, "id" | "name" | "description">) => {
    setEditingId(project.id);
    setForm({ name: project.name, description: project.description ?? "" });
    setModalError("");
    setModal("edit");
  };

  async function loadExampleProject() {
    if (busy) return;
    setBusy(true);
    setLoadError("");
    try {
      const result = await api<{ created: boolean; project: { id: string } }>("/projects/sample", { method: "POST" });
      await refresh();
      openProject(result.project.id);
      setNotice(result.created ? "Project board added. You can start organizing work." : "Opening your sample project.");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not add the sample project");
    } finally { setBusy(false); }
  }

  async function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || form.name.trim().length < 3) return;
    setBusy(true);
    setModalError("");
    try {
      const path = modal === "edit" && editingId ? `/projects/${encodeURIComponent(editingId)}` : "/projects";
      const result = await api<{ project: { id: string } }>(path, {
        method: modal === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() }),
      });
      setModal(null);
      setNotice(modal === "edit" ? "Project changes saved." : "Your new project is ready.");
      await refresh();
      if (modal === "edit" && selectedId === result.project.id) await fetchDetail(selectedId);
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Could not save the project");
    } finally { setBusy(false); }
  }

  async function changeStatus(id: string, status: ProjectStatus) {
    setBusy(true);
    setNotice("");
    setDetailError("");
    try {
      await api(`/projects/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      await refresh();
      if (view === "details") await fetchDetail(id);
      setNotice(status === "ARCHIVED" ? "Project archived. You can restore it from Projects → Archived." : `Project status changed to ${statusLabels[status]}.`);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not change status");
    } finally { setBusy(false); }
  }

  async function removeProject(project: ProjectDetail) {
    if (busy) return;
    if (!window.confirm(`Permanently delete “${project.name}” and its ${project.taskCount} task(s)? This cannot be undone.`)) return;
    setBusy(true);
    setDetailError("");
    try {
      await api(`/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
      setView("projects");
      setSelectedId(null);
      setDetail(null);
      setNotice("Project permanently deleted.");
      await refresh();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : "Could not delete project");
    } finally { setBusy(false); }
  }

  function goto(next: View) {
    setView(next);
    setNotice("");
    if (next === "projects") { setFilter("ALL"); setSearch(""); }
  }

  const list = (items: Project[]) => (
    <div className="pf-project-list">
      {items.map((project) => {
        const percentage = numberPercentage(project.completedTaskCount, project.taskCount);
        return <button type="button" className="pf-project-row" key={project.id} onClick={() => openProject(project.id)}>
          <span className="pf-project-icon"><Icon name="folder" size={19}/></span>
          <span className="pf-project-main"><strong>{project.name}</strong><small>{project.description || "No description yet"}</small></span>
          <span className="pf-project-key">{project.key}</span>
          <span className={`pf-status pf-status-${project.status.toLowerCase()}`}>{statusLabels[project.status]}</span>
          <span className="pf-project-progress"><span>{percentage}%</span><span className="pf-progress-track"><span style={{ width: `${percentage}%` }}/></span></span>
          <Icon name="chevron-right" size={17}/>
        </button>;
      })}
      {items.length === 0 ? <div className="pf-empty"><Icon name="folder" size={28}/><strong>No projects here yet</strong><p>Create a project or adjust your filters.</p><button className="pf-btn pf-primary" type="button" onClick={openCreate}>+ Create project</button></div> : null}
    </div>
  );

  return (
    <div className="app-shell pf-app">
      <a className="pf-skip-link" href="#workspace-main">Skip to main content</a>
      <aside className="sidebar pf-sidebar">
        <div className="brand"><div className="brand-mark"><span>PF</span></div><div className="brand-copy"><strong>ProjectFlow</strong><small>WORKSPACE</small></div></div>
        <button type="button" className="workspace-switcher" onClick={() => goto("team")} title="Team and workspace settings"><div className="workspace-avatar">{session.workspace.name.charAt(0).toUpperCase()}</div><div className="workspace-meta"><strong>{session.workspace.name}</strong><span>{session.workspace.role.toLowerCase()} workspace</span></div></button>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="navigation" aria-label="Main navigation">
          <button className={`nav-item ${view === "overview" ? "active" : ""}`} onClick={() => goto("overview")} type="button"><Icon name="grid"/>Overview</button>
          <button className={`nav-item ${view === "projects" || view === "details" ? "active" : ""}`} onClick={() => goto("projects")} type="button"><Icon name="folder"/>Projects<span className="pf-sidebar-count">{totals.projects}</span></button>
          <button className={`nav-item ${view === "tasks" ? "active" : ""}`} type="button" onClick={() => goto("tasks")}><Icon name="checklist"/>My tasks</button>
          <button className={`nav-item ${view === "team" ? "active" : ""}`} type="button" onClick={() => goto("team")}><Icon name="users"/>Team</button>
        </nav>
        <div className="sidebar-section-label section-label-lower">STATUS</div>
        <div className="pf-sidebar-summary"><span className="pf-online-dot"/>Workspace ready<span>Everything is up to date</span></div>
        <div className="sidebar-bottom"><div className="build-label"><span className="tiny-pulse"/>{session.demo ? "EXPLORE MODE" : "YOUR SPACE"}</div><p>{session.demo ? "A private workspace to try things out" : "Everything in its right place"}</p><div className="sidebar-line"/><div className="profile-row"><span className="profile-avatar">{initials}</span><span><strong>{session.user.name}</strong><small>{session.demo ? "Demo visitor" : session.user.email}</small></span></div></div>
      </aside>

      <main id="workspace-main" tabIndex={-1} className="main-area">
        <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><Icon name="chevron-right" size={14}/>
          {view === "details" ? <><button type="button" className="pf-crumb-button" onClick={() => goto("projects")}>Projects</button><Icon name="chevron-right" size={14}/><strong>{detail?.name ?? "Project details"}</strong></> : <strong>{view === "overview" ? "Overview" : view === "tasks" ? "My tasks" : view === "team" ? "Team" : "Projects"}</strong>}</div><div className="topbar-actions"><span className="preview-chip"><span className="preview-dot"/>{session.demo ? "Demo workspace" : "Your workspace"}</span><button type="button" className="logout-button" onClick={onLogout}>Sign out</button><span className="topbar-avatar">{initials}</span></div></header>
        <div className="page-content pf-content">
          {notice ? <div className="pf-toast" role="status"><Icon name="check" size={16}/>{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div> : null}
          {loadError ? <div className="pf-alert" role="alert">{loadError} <button type="button" onClick={() => void refresh()}>Retry</button></div> : null}
          {session.demo ? <div className="pf-demo-banner"><Icon name="layers" size={16}/><span><strong>You're exploring a demo.</strong> This workspace is yours to try for 12 hours. Changes won't affect anyone else.</span><button type="button" onClick={onLogout}>Exit demo</button></div> : null}

          {view === "overview" ? <>
            <div className="pf-heading-row"><div><div className="eyebrow">WORKSPACE / OVERVIEW</div><h1>Welcome back, <span>{session.user.name.split(" ")[0]}.</span></h1><p>A clear view of your team’s work, all in one place.</p></div><div className="pf-heading-actions">{!session.demo && session.workspace.role !== "MEMBER" ? <button className="pf-btn pf-outline" disabled={busy} type="button" onClick={() => void loadExampleProject()}><Icon name="layers" size={16}/> {busy ? "Preparing…" : "Add sample project"}</button> : null}<button className="pf-btn pf-primary" type="button" onClick={openCreate}>+ New project</button></div></div>
            <section className="pf-welcome"><div><span className="pf-welcome-kicker"><span className="pf-online-dot"/> YOUR WEEK AT A GLANCE</span><h2>Stay focused on what’s next.</h2><p>Keep priorities clear, move work forward and see where your team stands.</p><button type="button" onClick={() => goto("projects")}>View your projects <Icon name="arrow-up-right" size={17}/></button></div><div className="pf-welcome-graphic"><div className="pf-focus-panel"><span>WORK IN PROGRESS</span><strong>{loading ? "—" : Math.max(0, totals.tasks - totals.done)}</strong><small>Tasks still open</small><div className="pf-focus-progress"><span style={{ width: `${numberPercentage(totals.done, totals.tasks)}%` }}/></div><small>{numberPercentage(totals.done, totals.tasks)}% completed overall</small></div></div></section>
            <div className="pf-stat-grid">
              <div className="pf-stat"><span><Icon name="folder"/>Active projects</span><strong>{loading ? "—" : totals.active}</strong><small>{totals.archived} archived</small></div>
              <div className="pf-stat"><span><Icon name="checklist"/>Total tasks</span><strong>{loading ? "—" : totals.tasks}</strong><small>Across current projects</small></div>
              <div className="pf-stat"><span><Icon name="check"/>Completed tasks</span><strong>{loading ? "—" : totals.done}</strong><small>{numberPercentage(totals.done, totals.tasks)}% of all tasks</small></div>
              <div className="pf-stat"><span><Icon name="activity"/>Overdue tasks</span><strong>{loading ? "—" : totals.overdue}</strong><small>Need attention</small></div>
            </div>
            <section className="pf-panel"><div className="pf-panel-header"><div><h2>Recent projects</h2><p>Your recently updated projects.</p></div><button type="button" className="pf-link" onClick={() => goto("projects")}>View all projects <Icon name="arrow-up-right" size={16}/></button></div>{loading ? <p className="pf-muted-pad">Loading your workspace…</p> : list(projects.filter((p) => p.status !== "ARCHIVED").slice(0, 5))}</section>

          </> : null}

          {view === "projects" ? <>
            <div className="pf-heading-row"><div><div className="eyebrow">WORKSPACE / PROJECTS</div><h1>All <span>projects.</span></h1><p>Plan, track and manage everything your team is building.</p></div><div className="pf-heading-actions">{!session.demo && session.workspace.role !== "MEMBER" ? <button className="pf-btn pf-outline" disabled={busy} type="button" onClick={() => void loadExampleProject()}><Icon name="layers" size={16}/> {busy ? "Preparing…" : "Add sample project"}</button> : null}<button className="pf-btn pf-primary" type="button" onClick={openCreate}>+ New project</button></div></div>
            <section className="pf-panel"><div className="pf-panel-header"><div><h2>All projects</h2><p>{projects.length} project(s) in this workspace, including archives.</p></div><button type="button" className="pf-link" onClick={() => void refresh()} disabled={loading}><Icon name="refresh" size={15}/>Refresh</button></div>
              <div className="pf-filters"><input aria-label="Search projects" placeholder="Search by name, code or description…" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select aria-label="Filter projects by status" value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="ALL">All current projects</option><option value="ACTIVE">Active</option><option value="ON_HOLD">On hold</option><option value="COMPLETED">Completed</option><option value="ARCHIVED">Archived</option></select></div>
              {loading ? <p className="pf-muted-pad">Loading projects…</p> : list(filtered)}</section>
          </> : null}



          {view === "tasks" ? <MyTasks onOpenProject={openProject}/> : null}
          {view === "team" ? <TeamManagement session={session} onWorkspaceChanged={() => window.location.reload()}/> : null}
          {view === "details" ? <>
            <button type="button" className="pf-back" onClick={() => goto("projects")}>‹ Back to all projects</button>
            {detailError ? <div className="pf-alert" role="alert">{detailError}</div> : null}
            {detailLoading && !detail ? <p className="pf-muted-pad">Loading project details…</p> : null}
            {detail ? <>
              <div className="pf-heading-row pf-detail-header"><div><div className="eyebrow">PROJECT / {detail.key}</div><h1>{detail.name}</h1><p>{detail.description || "No description yet. Edit the project to add one."}</p></div><button type="button" className="pf-btn pf-outline" onClick={() => openEdit(detail)}>Edit project</button></div>
              <div className="pf-detail-grid"><section className="pf-panel pf-detail-main"><div className="pf-panel-header"><div><h2>Project overview</h2><p>Project information and activity</p></div><span className={`pf-status pf-status-${detail.status.toLowerCase()}`}>{statusLabels[detail.status]}</span></div><div className="pf-detail-info"><div><small>Project code</small><strong>{detail.key}</strong></div><div><small>Created</small><strong>{shortDate(detail.createdAt)}</strong></div><div><small>Last updated</small><strong>{shortDate(detail.updatedAt)}</strong></div><div><small>Tasks</small><strong>{detail.taskCount}</strong></div></div><div className="pf-detail-divider"/><div className="pf-panel-header"><div><h2>Recent tasks</h2><p>Latest tasks in this project. Manage them on the board below.</p></div></div>
                {detail.tasks.length ? <div className="pf-task-list">{detail.tasks.map((task) => <div className="pf-task-row" key={task.id}><span className="pf-task-mark"><Icon name="checklist" size={16}/></span><div><strong>{task.title}</strong><small>{task.code} · {task.priority.toLowerCase()} priority</small></div><span className="pf-task-status">{taskLabels[task.status]}</span></div>)}</div> : <div className="pf-empty pf-task-empty"><Icon name="checklist" size={28}/><strong>No tasks yet</strong><p>Add your first task using the Kanban board below.</p></div>}
              </section>
              <aside className="pf-panel pf-detail-actions"><h2>Manage project</h2><label htmlFor="project-state">Status</label><select id="project-state" value={detail.status} disabled={busy} onChange={(e) => void changeStatus(detail.id, e.target.value as ProjectStatus)}><option value="ACTIVE">Active</option><option value="ON_HOLD">On hold</option><option value="COMPLETED">Completed</option><option value="ARCHIVED">Archived</option></select><p>Keep the project status aligned with your team’s progress.</p>
                {detail.status === "ARCHIVED" ? <button className="pf-btn pf-outline pf-full" type="button" disabled={busy} onClick={() => void changeStatus(detail.id, "ACTIVE")}>Restore project</button> : <button className="pf-btn pf-outline pf-full" type="button" disabled={busy} onClick={() => void changeStatus(detail.id, "ARCHIVED")}>Archive project</button>}
                <div className="pf-danger-zone"><h3>Danger zone</h3><p>Permanently delete this project and its tasks. This cannot be undone.</p><button type="button" className="pf-btn pf-danger pf-full" disabled={busy || (session.workspace.role !== "OWNER" && session.workspace.role !== "ADMIN")} onClick={() => void removeProject(detail)}>Delete permanently</button></div>
              </aside></div>
              <TaskBoard projectId={detail.id} currentUser={{ id: session.user.id, name: session.user.name }} readOnly={detail.status === "ARCHIVED"} onTasksChanged={() => { void refresh(); void fetchDetail(detail.id); }} />
            </> : null}
          </> : null}
        </div>
      </main>

      {modal ? <div className="pf-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}><section className="pf-modal" role="dialog" aria-modal="true" aria-labelledby="pf-modal-title"><div className="pf-modal-head"><div className="eyebrow">PROJECT MANAGEMENT</div><button type="button" className="pf-close" aria-label="Close dialog" disabled={busy} onClick={() => setModal(null)}>×</button></div><h2 id="pf-modal-title">{modal === "create" ? "Create a project" : "Edit project"}</h2><p>Organize work in your private workspace.</p><form onSubmit={(event) => void saveProject(event)}><label htmlFor="pf-name">Project name</label><input id="pf-name" autoFocus required minLength={3} maxLength={80} value={form.name} onChange={(e) => setForm((previous) => ({ ...previous, name: e.target.value }))} placeholder="e.g. Mobile application"/><label htmlFor="pf-description">Description <span>(optional)</span></label><textarea id="pf-description" maxLength={280} rows={4} value={form.description} onChange={(e) => setForm((previous) => ({ ...previous, description: e.target.value }))} placeholder="What is this project about?"/>{modalError ? <div className="pf-alert" role="alert">{modalError}</div> : null}<div className="pf-modal-actions"><button type="button" className="pf-btn pf-outline" disabled={busy} onClick={() => setModal(null)}>Cancel</button><button type="submit" className="pf-btn pf-primary" disabled={busy || form.name.trim().length < 3}>{busy ? "Saving…" : modal === "create" ? "Create project" : "Save changes"}</button></div></form></section></div> : null}
    </div>
  );
}
