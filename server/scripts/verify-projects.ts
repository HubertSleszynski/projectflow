/**
 * Stage 4 integration tests against the local PostgreSQL database.
 * Creates temporary workspaces, users and a task; removes only those records.
 */
import "dotenv/config";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const suffix = randomBytes(7).toString("hex");
const userEmails = [`stage4-a-${suffix}@example.test`, `stage4-b-${suffix}@example.test`];
const password = `Stage4-test-${randomBytes(16).toString("hex")}`;

function check(value: unknown, description: string): asserts value {
  if (!value) throw new Error(`FAILED: ${description}`);
  console.log(`  ✓ ${description}`);
}

async function main() {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not open test server");
  const endpoint = `http://127.0.0.1:${addr.port}/api`;
  async function call(path: string, opts: { method?: string; cookie?: string; body?: object; origin?: string } = {}) {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (opts.method && opts.method !== "GET") {
      headers.Origin = opts.origin ?? origin;
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(endpoint + path, {
      method: opts.method ?? "GET", headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { response, data: await response.json() as Record<string, any> };
  }
  try {
    console.log("\nProjectFlow Stage 4 — LIVE project-management tests:");
    const anon = await call("/projects");
    check(anon.response.status === 401, "projects require a login session");

    const register = async (email: string, name: string) => {
      const result = await call("/auth/register", { method: "POST", body: { email, name, password } });
      check(result.response.status === 201, `registered ${name}`);
      const cookie = result.response.headers.get("set-cookie")?.split(";")[0] ?? "";
      check(cookie.startsWith("pf_session="), `${name} received a private session`);
      return cookie;
    };
    const cookieA = await register(userEmails[0], "Stage4 QA A");
    const cookieB = await register(userEmails[1], "Stage4 QA B");

    const created = await call("/projects", { method: "POST", cookie: cookieA, body: { name: "  Original Project  ", description: "Test" } });
    check(created.response.status === 201, "created a project in workspace A");
    const id = String(created.data.project.id);
    check(created.data.project.name === "Original Project", "project name was trimmed");

    const userA = await prisma.user.findUniqueOrThrow({ where: { email: userEmails[0] }, include: { memberships: true } });
    const task = await prisma.task.create({
      data: { projectId: id, code: `QA4-${suffix}`, title: "Stage4 test task", status: "DONE", priority: "HIGH" },
    });
    const listA = await call("/projects", { cookie: cookieA });
    check(listA.response.status === 200 && listA.data.projects.some((p: any) => p.id === id && p.taskCount === 1 && p.completedTaskCount === 1), "project list includes real task counts");
    const detailA = await call(`/projects/${id}`, { cookie: cookieA });
    check(detailA.response.status === 200 && detailA.data.project.tasks.some((p: any) => p.id === task.id), "project details show its saved tasks");

    const listB = await call("/projects", { cookie: cookieB });
    check(!listB.data.projects.some((p: any) => p.id === id), "workspace B cannot list workspace A projects");
    const foreignGet = await call(`/projects/${id}`, { cookie: cookieB });
    check(foreignGet.response.status === 404, "workspace B cannot read workspace A project details");
    const foreignPatch = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieB, body: { name: "Hacked" } });
    check(foreignPatch.response.status === 404, "workspace B cannot modify workspace A project");
    const foreignDelete = await call(`/projects/${id}`, { method: "DELETE", cookie: cookieB });
    check(foreignDelete.response.status === 404, "workspace B cannot delete workspace A project");

    const badName = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieA, body: { name: "x" } });
    check(badName.response.status === 400, "invalid project name rejected");
    const massAssign = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieA, body: { workspaceId: userA.memberships[0].workspaceId } });
    check(massAssign.response.status === 400, "workspace reassignment rejected by validation");
    const emptyPatch = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieA, body: {} });
    check(emptyPatch.response.status === 400, "empty update rejected");
    const wrongOrigin = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieA, origin: "https://evil.example", body: { status: "ARCHIVED" } });
    check(wrongOrigin.response.status === 403, "cross-origin writes rejected");

    const updated = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieA, body: { name: "Revised Project", description: "Updated via API", status: "ON_HOLD" } });
    check(updated.response.status === 200 && updated.data.project.name === "Revised Project" && updated.data.project.status === "ON_HOLD", "project fields and status updated");
    const archived = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieA, body: { status: "ARCHIVED" } });
    check(archived.response.status === 200 && archived.data.project.status === "ARCHIVED", "project archived without being deleted");
    const archivedList = await call("/projects", { cookie: cookieA });
    check(archivedList.data.projects.some((p: any) => p.id === id && p.status === "ARCHIVED"), "archived project is still retrievable");
    const restored = await call(`/projects/${id}`, { method: "PATCH", cookie: cookieA, body: { status: "ACTIVE" } });
    check(restored.data.project.status === "ACTIVE", "archived project restored");

    const deletion = await call(`/projects/${id}`, { method: "DELETE", cookie: cookieA });
    check(deletion.response.status === 200, "owner permanently deleted own project");
    const missing = await call(`/projects/${id}`, { cookie: cookieA });
    check(missing.response.status === 404, "deleted project is no longer accessible");
    check(await prisma.task.count({ where: { id: task.id } }) === 0, "associated tasks removed by cascade");
    console.log("\nAll Stage 4 integration checks passed. ✅\n");
  } finally {
    try {
      const members = await prisma.workspaceMember.findMany({
        where: { user: { email: { in: userEmails } } }, select: { workspaceId: true },
      });
      if (members.length) await prisma.workspace.deleteMany({ where: { id: { in: members.map((m) => m.workspaceId) } } });
      await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
      console.log("Temporary Stage 4 QA data removed; your existing accounts and projects were not touched.");
    } finally {
      await prisma.$disconnect();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

main().catch((error) => { console.error("Stage 4 verification failed:", error); process.exitCode = 1; });
