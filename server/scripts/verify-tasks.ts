/** Stage 5 integration checks: real API, PostgreSQL, user isolation and Kanban reorder. */
import "dotenv/config";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const suffix = randomBytes(6).toString("hex");
const emails = [`stage5-a-${suffix}@example.test`, `stage5-b-${suffix}@example.test`];
const password = `Test5-${randomBytes(16).toString("hex")}`;

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(`FAILED: ${label}`);
  console.log(`  ✓ ${label}`);
}

async function main() {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server unavailable");
  const base = `http://127.0.0.1:${address.port}/api`;
  async function call(path: string, options: { method?: string; cookie?: string; body?: object; origin?: string } = {}) {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.method && options.method !== "GET") {
      headers.Origin = options.origin ?? origin;
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(base + path, { method: options.method ?? "GET", headers,
      body: options.body ? JSON.stringify(options.body) : undefined });
    return { code: response.status, data: await response.json() as Record<string, any>, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
  }
  try {
    console.log("\nProjectFlow Stage 5 — LIVE task-board integration tests:");
    const a = await call("/auth/register", { method: "POST", body: { name: "Task QA A", email: emails[0], password } });
    const b = await call("/auth/register", { method: "POST", body: { name: "Task QA B", email: emails[1], password } });
    check(a.code === 201 && b.code === 201 && !!a.cookie && !!b.cookie, "two private user accounts created");
    const project = await call("/projects", { method: "POST", cookie: a.cookie, body: { name: "Kanban QA workspace" } });
    check(project.code === 201, "project created in workspace A");
    const projectId = String(project.data.project.id);
    const path = `/projects/${projectId}/tasks`;
    check((await call(path)).code === 401, "anonymous user cannot view tasks");
    check((await call(path, { cookie: b.cookie })).code === 404, "workspace B cannot view workspace A tasks");
    check((await call(path, { method: "POST", cookie: b.cookie, body: { title: "Foreign task" } })).code === 404, "workspace B cannot create tasks");
    check((await call(path, { method: "POST", cookie: a.cookie, body: { title: "a" } })).code === 400, "too-short title rejected");
    check((await call(path, { method: "POST", cookie: a.cookie, body: { title: "X task", dueDate: "2026-02-31" } })).code === 400, "invalid calendar date rejected");
    check((await call(path, { method: "POST", cookie: a.cookie, body: { title: "X task", projectId: "another" } })).code === 400, "unknown fields cannot reassign project");
    check((await call(path, { method: "POST", cookie: a.cookie, body: { title: "X task", assigneeId: "unknown" } })).code === 400, "foreign or unknown assignee rejected");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] } });
    const t1 = await call(path, { method: "POST", cookie: a.cookie, body: { title: "Build a Kanban board", priority: "HIGH", assigneeId: user.id, dueDate: "2027-01-18" } });
    check(t1.code === 201 && t1.data.task.title === "Build a Kanban board" && t1.data.task.position === 0, "create task with priority, due date, and assignee");
    const t2 = await call(path, { method: "POST", cookie: a.cookie, body: { title: "Test sorting" } });
    check(t2.code === 201 && t2.data.task.position === 1, "new task appended to same lane");
    const t3 = await call(path, { method: "POST", cookie: a.cookie, body: { title: "Write task tests", status: "IN_PROGRESS", priority: "URGENT" } });
    check(t3.code === 201 && t3.data.task.status === "IN_PROGRESS", "create task in chosen lane");
    const id1 = String(t1.data.task.id), id2 = String(t2.data.task.id), id3 = String(t3.data.task.id);
    const listed = await call(path, { cookie: a.cookie });
    check(listed.code === 200 && listed.data.tasks.length === 3, "project lists all three tasks");
    const mine = await call("/tasks/mine", { cookie: a.cookie });
    check(mine.code === 200 && mine.data.tasks.some((t: any) => t.id === id1), "My tasks includes assigned work");
    check((await call("/tasks/mine", { cookie: b.cookie })).data.tasks.length === 0, "My tasks isolated across workspaces");
    const updated = await call(`${path}/${id1}`, { method: "PATCH", cookie: a.cookie, body: { title: "  Build the Kanban feature ", priority: "URGENT", description: "Frontend with Express API", dueDate: null } });
    check(updated.code === 200 && updated.data.task.title === "Build the Kanban feature" && updated.data.task.dueDate === null, "edit task and clear due date");
    check((await call(`${path}/${id1}`, { method: "PATCH", cookie: b.cookie, body: { title: "Stolen" } })).code === 404, "workspace B cannot modify task");
    check((await call(`${path}/${id1}`, { method: "DELETE", cookie: b.cookie })).code === 404, "workspace B cannot delete task");
    check((await call(`${path}/${id1}`, { method: "PATCH", cookie: a.cookie, body: { title: "Invalid", assigneeId: "unknown" } })).code === 400, "invalid assignee on task edit rejected");
    check((await call(`${path}/${id1}`, { method: "PATCH", cookie: a.cookie, origin: "https://evil.example", body: { title: "Cross-origin" } })).code === 403, "foreign origin write rejected");
    const reordered = await call(`${path}/reorder`, { method: "POST", cookie: a.cookie, body: { taskId: id2, status: "IN_PROGRESS", beforeTaskId: id3 } });
    check(reordered.code === 200, "drag moves task to another column");
    const moved = await call(path, { cookie: a.cookie });
    const inProgress = moved.data.tasks.filter((task: any) => task.status === "IN_PROGRESS").sort((x: any, y: any) => x.position - y.position);
    check(inProgress.length === 2 && inProgress[0].id === id2 && inProgress[1].id === id3, "drop before card preserves lane order");
    const reorderedSame = await call(`${path}/reorder`, { method: "POST", cookie: a.cookie, body: { taskId: id3, status: "IN_PROGRESS", beforeTaskId: id2 } });
    check(reorderedSame.code === 200, "drag reorders cards within same lane");
    const moved2 = await call(path, { cookie: a.cookie });
    check(moved2.data.tasks.filter((task: any) => task.status === "IN_PROGRESS").sort((x: any, y: any) => x.position - y.position)[0].id === id3, "same-lane order persisted in PostgreSQL");
    check((await call(`${path}/reorder`, { method: "POST", cookie: a.cookie, body: { taskId: id2, status: "TODO", beforeTaskId: "no-such-task" } })).code === 400, "reorder target validated");
    const completed = await call(`${path}/${id1}`, { method: "PATCH", cookie: a.cookie, body: { status: "DONE" } });
    check(completed.code === 200 && completed.data.task.status === "DONE", "task status editable without drag and drop");
    const totals = await call("/projects", { cookie: a.cookie });
    check(totals.data.projects.some((p: any) => p.id === projectId && p.taskCount === 3 && p.completedTaskCount === 1), "project dashboard counters update from database");
    await call(`/projects/${projectId}`, { method: "PATCH", cookie: a.cookie, body: { status: "ARCHIVED" } });
    check((await call(path, { method: "POST", cookie: a.cookie, body: { title: "Forbidden archive write" } })).code === 409, "archived project is read-only");
    check((await call(`${path}/${id1}`, { method: "DELETE", cookie: a.cookie })).code === 409, "archived project prevents task deletion");
    await call(`/projects/${projectId}`, { method: "PATCH", cookie: a.cookie, body: { status: "ACTIVE" } });
    check((await call(`${path}/${id1}`, { method: "DELETE", cookie: a.cookie })).code === 200, "task can be deleted after restore");
    check((await call(path, { cookie: a.cookie })).data.tasks.length === 2, "deletion persists");
    console.log("\nAll Stage 5 integration checks passed. ✅\n");
  } finally {
    try {
      const memberships = await prisma.workspaceMember.findMany({ where: { user: { email: { in: emails } } }, select: { workspaceId: true } });
      if (memberships.length) await prisma.workspace.deleteMany({ where: { id: { in: memberships.map((m) => m.workspaceId) } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      console.log("Stage 5 temporary QA users, tasks and projects removed; existing data preserved.");
    } finally {
      await prisma.$disconnect();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

main().catch((error) => { console.error("Stage 5 check failed:", error); process.exitCode = 1; });
