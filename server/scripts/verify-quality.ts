/** Stage 7 live tests: sample content, isolation, idempotency and cleanup. */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const suffix = randomBytes(7).toString("hex");
const users = [`stage7-a-${suffix}@example.test`, `stage7-b-${suffix}@example.test`];
const password = `Stage7-${randomBytes(18).toString("hex")}`;
function check(value: unknown, description: string): asserts value {
  if (!value) throw new Error(`FAILED: ${description}`);
  console.log(`  ✓ ${description}`);
}

async function main() {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not open test server");
  const url = `http://127.0.0.1:${addr.port}/api`;
  async function call(path: string, opts: { method?: string; cookie?: string; body?: object; origin?: string } = {}) {
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (opts.method && opts.method !== "GET") {
      headers.Origin = opts.origin ?? origin;
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(url + path, {
      method: opts.method ?? "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await response.json() as Record<string, any>;
    return { response, data };
  }
  try {
    console.log("\nProjectFlow Stage 7 — LIVE demo onboarding and safety tests:");
    const anonymous = await call("/projects/sample", { method: "POST" });
    check(anonymous.response.status === 401, "anonymous visitor cannot create sample projects");

    async function register(email: string, name: string) {
      const result = await call("/auth/register", { method: "POST", body: { email, password, name } });
      check(result.response.status === 201, `${name} registered`);
      const cookie = result.response.headers.get("set-cookie")?.split(";")[0] ?? "";
      check(cookie.startsWith("pf_session="), `${name} has an authenticated session`);
      return cookie;
    }
    const a = await register(users[0], "Stage7 QA A");
    const b = await register(users[1], "Stage7 QA B");
    const foreign = await call("/projects/sample", { method: "POST", cookie: a, origin: "https://evil.example" });
    check(foreign.response.status === 403, "cross-origin sample creation is rejected");
    const first = await call("/projects/sample", { method: "POST", cookie: a });
    check(first.response.status === 201 && first.data.created === true, "first click creates one sample project");
    const idA = String(first.data.project.id);
    const detailsA = await call(`/projects/${idA}`, { cookie: a });
    check(detailsA.response.status === 200 && detailsA.data.project.key === "EVT" && detailsA.data.project.name === "City Food Festival", "sample project is a real-world event plan, not a website project");
    const tasksA = await call(`/projects/${idA}/tasks`, { cookie: a });
    check(tasksA.response.status === 200 && tasksA.data.tasks.length === 7, "sample board has seven saved tasks");
    check(tasksA.data.tasks.some((t: any) => t.title === "Confirm venue booking"), "sample tasks cover event planning");
    check(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"].every((state) => tasksA.data.tasks.some((t: any) => t.status === state)), "all four Kanban columns are represented");
    const again = await call("/projects/sample", { method: "POST", cookie: a });
    check(again.response.status === 200 && again.data.created === false && again.data.project.id === idA, "repeated click reuses the same board");
    check(await prisma.task.count({ where: { projectId: idA } }) === 7, "repeated clicks do not duplicate tasks");

    // Simulate a project seeded by ProjectFlow 1.1 and verify safe in-place upgrade.
    // The ID, task count, statuses and any user-edited content must be retained.
    await prisma.project.update({ where: { id: idA }, data: {
      key: "PF-DEMO", name: "Website redesign",
      description: "Refresh the company website, improve navigation and prepare the next launch.",
    } });
    const taskToMigrate = await prisma.task.findFirstOrThrow({ where: { projectId: idA, title: "Confirm venue booking" } });
    await prisma.task.update({ where: { id: taskToMigrate.id }, data: {
      code: `WEB-${randomBytes(8).toString("hex").toUpperCase()}`,
      title: "Review homepage wireframes",
      description: "Share the latest layouts with stakeholders and collect final feedback.",
    } });
    const upgraded = await call("/projects/sample", { method: "POST", cookie: a });
    check(upgraded.response.status === 200 && upgraded.data.created === false && upgraded.data.project.id === idA && upgraded.data.project.key === "EVT", "previous sample is upgraded without creating another project");
    const upgradedProject = await call(`/projects/${idA}`, { cookie: a });
    check(upgradedProject.data.project.name === "City Food Festival", "previous website sample is renamed");
    const upgradedTasks = await call(`/projects/${idA}/tasks`, { cookie: a });
    check(upgradedTasks.data.tasks.length === 7 && upgradedTasks.data.tasks.some((t: any) => t.id === taskToMigrate.id && t.title === "Confirm venue booking" && t.code.startsWith("EVT-")), "previous website task is updated without losing its identity");
    const other = await call("/projects", { cookie: b });
    check(other.response.status === 200 && other.data.projects.length === 0, "other workspace does not see first user's sample board");
    const blocked = await call(`/projects/${idA}`, { cookie: b });
    check(blocked.response.status === 404, "other user cannot read first user's example board");
    const own = await call("/projects/sample", { method: "POST", cookie: b });
    check(own.response.status === 201 && own.data.project.id !== idA, "other workspace receives a separate sample board");
    console.log("\nAll Stage 7 integration checks passed. ✅\n");
  } finally {
    try {
      const members = await prisma.workspaceMember.findMany({
        where: { user: { email: { in: users } } }, select: { workspaceId: true },
      });
      if (members.length) await prisma.workspace.deleteMany({ where: { id: { in: members.map((m) => m.workspaceId) } } });
      await prisma.user.deleteMany({ where: { email: { in: users } } });
      console.log("Temporary Stage 7 test accounts and projects removed; your real data is untouched.");
    } finally {
      await prisma.$disconnect();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

main().catch((error) => { console.error("Stage 7 verification failed:", error); process.exitCode = 1; });
