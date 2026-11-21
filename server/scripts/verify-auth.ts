/**
 * Real integration test against local PostgreSQL, without touching seeded demo data.
 * Requires: docker compose up -d --wait postgres; npm run db:migrate
 */
import "dotenv/config";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const suffix = randomBytes(6).toString("hex");
const emailA = `pf-stage3-a-${suffix}@example.test`;
const emailB = `pf-stage3-b-${suffix}@example.test`;
const password = `Stage3-Test-${randomBytes(16).toString("hex")}`;

function assert(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${description}`);
  console.log(`  ✓ ${description}`);
}

async function main() {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Could not bind test HTTP server");
  const api = `http://127.0.0.1:${addr.port}/api`;

  const call = async (path: string, options: { cookie?: string; method?: string; body?: object; origin?: string | null } = {}) => {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.method && options.method !== "GET") {
      headers.Origin = options.origin === undefined ? origin : options.origin ?? "";
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(api + path, { method: options.method ?? "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined });
    return { response, body: await response.json() as Record<string, any> };
  };

  try {
    console.log("\nProjectFlow Stage 3 — LIVE authentication tests:");
    const anon = await call("/projects");
    assert(anon.response.status === 401, "unauthenticated projects API returns 401");

    const badOrigin = await call("/auth/register", { method: "POST", origin: "https://evil.example", body: { name: "Attacker", email: "bad@example.test", password } });
    assert(badOrigin.response.status === 403, "foreign Origin rejected for POST requests");

    async function createAccount(name: string, email: string) {
      const result = await call("/auth/register", { method: "POST", body: { name, email, password } });
      assert(result.response.status === 201, `register ${name} (status ${result.response.status})`);
      const cookie = result.response.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert(cookie.startsWith("pf_session="), `${name} receives a session cookie`);
      const me = await call("/auth/me", { cookie });
      assert(me.response.status === 200, `authenticated /auth/me for ${name}`);
      return cookie;
    }

    const cookieA = await createAccount("QA User A", emailA);
    const cookieB = await createAccount("QA User B", emailB);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: emailA }, select: { passwordHash: true } });
    assert(!!user.passwordHash && user.passwordHash.startsWith("scrypt:") && !user.passwordHash.includes(password), "password stored as a scrypt hash, not plain text");

    const create = await call("/projects", { cookie: cookieA, method: "POST", body: { name: "Only A can see this" } });
    assert(create.response.status === 201, "user A creates a project in PostgreSQL");
    const projectId = create.body.project.id;
    const viewA = await call("/projects", { cookie: cookieA });
    assert(viewA.response.status === 200 && viewA.body.projects.some((item: {id:string}) => item.id === projectId), "user A sees their project");
    const viewB = await call("/projects", { cookie: cookieB });
    assert(viewB.response.status === 200 && !viewB.body.projects.some((item: {id:string}) => item.id === projectId), "user B CANNOT see user A's project");

    const wrongPassword = await call("/auth/login", { method: "POST", body: { email: emailA, password: "wrong" } });
    assert(wrongPassword.response.status === 401, "incorrect password is rejected");
    const validLogin = await call("/auth/login", { method: "POST", body: { email: emailA, password } });
    assert(validLogin.response.status === 200, "correct password logs in");
    const freshCookie = validLogin.response.headers.get("set-cookie")?.split(";")[0] ?? "";
    assert(!!freshCookie, "re-login issues a new session cookie");
    const persist = await call("/projects", { cookie: freshCookie });
    assert(persist.body.projects.some((item: {id:string}) => item.id === projectId), "project remains after new login");

    const logout = await call("/auth/logout", { cookie: freshCookie, method: "POST" });
    assert(logout.response.status === 200, "logout succeeds");
    const afterLogout = await call("/auth/me", { cookie: freshCookie });
    assert(afterLogout.response.status === 401, "logged-out session is invalidated in the database");
    const oldDemo = await call("/demo/projects", { method: "POST", body: { name: "No demo writes" } });
    assert(oldDemo.response.status === 404, "old unsecured demo project creation endpoint removed");
    console.log("\nAll Stage 3 integration checks passed. ✅\n");
  } finally {
    try {
      const testEmails = [emailA, emailB];
      const members = await prisma.workspaceMember.findMany({
        where: { user: { email: { in: testEmails } } },
        select: { workspaceId: true },
      });
      if (members.length) await prisma.workspace.deleteMany({ where: { id: { in: members.map((member) => member.workspaceId) } } });
      await prisma.user.deleteMany({ where: { email: { in: testEmails } } });
      console.log("Temporary QA accounts and projects removed; original demo projects remain untouched.");
    } finally {
      await prisma.$disconnect();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
}

main().catch((error) => { console.error("Stage 3 verification failed:", error); process.exitCode = 1; });
