import { randomBytes } from "node:crypto";
import { Router } from "express";
import { endSession, setActiveWorkspaceCookie, startSession } from "../lib/auth.js";
import { sampleProjects, makeTasks } from "../lib/demo-data.js";
import { prisma } from "../lib/prisma.js";

export const demoRouter = Router();
const DEMO_LIFETIME_MS = 12 * 60 * 60 * 1000;
const MAX_ACTIVE_DEMOS = 120;
const MAX_IP_DEMOS_PER_HOUR = 6;
const calls = new Map<string, { count: number; resetAt: number }>();

function allowDemo(ip: string): boolean {
  const now = Date.now();
  for (const [key, value] of calls) if (value.resetAt < now) calls.delete(key);
  if (calls.size > 5000 && !calls.has(ip)) return false;
  const current = calls.get(ip);
  if (!current || current.resetAt < now) {
    calls.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return true;
  }
  current.count++;
  return current.count <= MAX_IP_DEMOS_PER_HOUR;
}

// Cleanup happens on new demo requests; no cron process is required for local development.
async function purgeExpiredDemos() {
  const expired = await prisma.user.findMany({
    where: { isDemo: true, demoExpiresAt: { lte: new Date() } },
    select: { id: true }, take: 250,
  });
  if (!expired.length) return;
  const userIds = expired.map((user) => user.id);
  await prisma.$transaction(async (tx) => {
    // Demo users own precisely one isolated workspace. Delete it before the user.
    await tx.workspace.deleteMany({ where: {
      slug: { startsWith: "demo-" },
      members: { some: { userId: { in: userIds } } },
    } });
    await tx.user.deleteMany({ where: { id: { in: userIds }, isDemo: true } });
  });
}

// Public, origin-checked endpoint. Every visitor gets a fresh account + workspace;
// no shared login details, no access to other visitors' projects.
demoRouter.post("/", async (request, response, next) => {
  if (!allowDemo(request.ip ?? "unknown")) {
    response.setHeader("Retry-After", "3600");
    response.status(429).json({ status: "error", message: "Demo limit reached. Please try again later." });
    return;
  }
  try {
    await purgeExpiredDemos();
    if (await prisma.user.count({ where: { isDemo: true } }) >= MAX_ACTIVE_DEMOS) {
      response.setHeader("Retry-After", "3600");
      response.status(429).json({ status: "error", message: "The demo is busy. Please try again later." });
      return;
    }
    const uniqueId = randomBytes(12).toString("hex");
    const expiresAt = new Date(Date.now() + DEMO_LIFETIME_MS);
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: {
        name: "Alex Morgan", email: `visitor-${uniqueId}@demo.projectflow.invalid`,
        passwordHash: null, isDemo: true, demoExpiresAt: expiresAt,
      } });
      const workspace = await tx.workspace.create({ data: {
        name: "Northstar Events", slug: `demo-${uniqueId}`,
        members: { create: { userId: user.id, role: "OWNER" } },
      } });
      for (const project of sampleProjects) {
        await tx.project.create({ data: {
          key: project.key, name: project.name, description: project.description,
          status: project.status, workspaceId: workspace.id,
          tasks: { create: makeTasks(project, user.id) },
        } });
      }
      return { user, workspace };
    });
    await endSession(request, response, false);
    await startSession(created.user.id, response, DEMO_LIFETIME_MS);
    setActiveWorkspaceCookie(response, created.workspace.id, DEMO_LIFETIME_MS);
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ status: "ok", demo: true, expiresAt });
  } catch (error) { next(error); }
});
