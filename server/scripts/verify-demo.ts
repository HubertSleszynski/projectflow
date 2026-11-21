/** Live checks for isolated, expiring visitor demo accounts. Requires migrated PostgreSQL. */
import "dotenv/config";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const createdUsers: string[] = [];
const assert = (pass: unknown, message: string) => {
  if (!pass) throw new Error(`FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
};

async function main() {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  const base = `http://127.0.0.1:${address.port}/api`;

  async function call(path: string, options: { method?: string; cookie?: string; origin?: string; body?: object } = {}) {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.method && options.method !== "GET") {
      headers.Origin = options.origin ?? origin;
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(base + path, { method: options.method ?? "GET", headers,
      body: options.body ? JSON.stringify(options.body) : undefined });
    const data = await response.json() as Record<string, any>;
    return { response, data };
  }

  try {
    console.log("\nProjectFlow 1.1 — visitor demo integration checks:");
    const badOrigin = await call("/demo", { method: "POST", origin: "https://untrusted.example" });
    assert(badOrigin.response.status === 403, "demo creation rejects foreign Origin");
    const anonymous = await call("/projects");
    assert(anonymous.response.status === 401, "projects remain private without a session");

    async function createDemo() {
      const result = await call("/demo", { method: "POST" });
      assert(result.response.status === 201, "visitor can start a demo without registering");
      const cookie = result.response.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert(cookie.startsWith("pf_session="), "demo uses an HttpOnly session cookie");
      const me = await call("/auth/me", { cookie });
      assert(me.response.status === 200 && me.data.demo === true, "demo session is recognized by the API");
      createdUsers.push(String(me.data.user.id));
      const projects = await call("/projects", { cookie });
      assert(projects.response.status === 200 && projects.data.projects.length === 3, "demo has three realistic projects");
      return { cookie, projects: projects.data.projects as Array<{ id: string; key: string }> };
    }

    const first = await createDemo();
    const second = await createDemo();
    // The projects API sorts by updatedAt, not by seed order. Select the
    // populated event board explicitly instead of assuming index 0.
    const eventProject = first.projects.find((project) => project.key === "EVT");
    assert(eventProject, "demo includes the city food festival project");
    const board = await call(`/projects/${eventProject.id}/tasks`, { cookie: first.cookie });
    assert(board.response.status === 200 && board.data.tasks.length >= 7, "demo has a populated task board");
    const foreign = await call(`/projects/${first.projects[0].id}`, { cookie: second.cookie });
    assert(foreign.response.status === 404, "demo workspaces are isolated from each other");
    const teamMutation = await call("/team/invitations", { method: "POST", cookie: first.cookie, body: { email: "friend@example.test", role: "MEMBER" } });
    assert(teamMutation.response.status === 403, "demo cannot invite users into its workspace");
    const edit = await call(`/projects/${first.projects[0].id}`, { method: "PATCH", cookie: first.cookie, body: { name: "Updated festival plan" } });
    assert(edit.response.status === 200, "visitors can edit their own demo project");
    const unchanged = await call(`/projects/${first.projects[0].id}`, { cookie: second.cookie });
    assert(unchanged.response.status === 404, "edits cannot affect another visitor's workspace");
    console.log("\nAll demo integration checks passed. ✅\n");
  } finally {
    try {
      if (createdUsers.length) {
        await prisma.workspace.deleteMany({ where: {
          slug: { startsWith: "demo-" },
          members: { some: { userId: { in: createdUsers } } },
        } });
        await prisma.user.deleteMany({ where: { id: { in: createdUsers }, isDemo: true } });
      }
      console.log("Temporary demo QA data removed; existing accounts and projects preserved.");
    } finally {
      await prisma.$disconnect();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

main().catch((error) => { console.error("Demo verification failed:", error); process.exitCode = 1; });
