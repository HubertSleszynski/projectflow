import { randomBytes } from "node:crypto";
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { endSession, getAuth, hashPassword, requireAuth, startSession, verifyPassword } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must have at least 2 characters").max(70),
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12, "Password must have at least 12 characters").max(128),
}).strict();

// Computing a dummy hash also for unknown email addresses reduces response-time
// differences that could otherwise help enumerate registered accounts.
const DUMMY_PASSWORD_HASH = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

const loginSchema = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: z.string(),
}).strict();

/** Bounded, per-process throttle. Deploy ONE API replica; use a shared limiter before scaling. */
const attempts = new Map<string, { count: number; until: number }>();
function authRateLimit(ip: string): boolean {
  const now = Date.now();
  if (attempts.size > 5000) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  if (attempts.size >= 5000 && !attempts.has(ip)) {
    const first = attempts.keys().next().value;
    if (first !== undefined) attempts.delete(first);
  }
  const record = attempts.get(ip);
  if (!record || record.until < now) {
    attempts.set(ip, { count: 1, until: now + 15 * 60_000 });
    return true;
  }
  record.count += 1;
  return record.count <= 20;
}

function guardRateLimit(ip: string, response: import("express").Response): boolean {
  if (authRateLimit(ip)) return true;
  response.setHeader("Retry-After", "900");
  response.status(429).json({ status: "error", message: "Too many attempts. Please try later" });
  return false;
}

authRouter.post("/register", async (request, response, next) => {
  if (!guardRateLimit(request.ip ?? "unknown", response)) return;
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid registration data" });
    return;
  }
  const { name, email, password } = parsed.data;
  try {
    const passwordHash = await hashPassword(password);
    const slug = `team-${randomBytes(8).toString("hex")}`;
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { name, email, passwordHash } });
      await tx.workspace.create({
        data: {
          name: `${name}'s Workspace`, slug,
          members: { create: { userId: created.id, role: "OWNER" } },
        },
      });
      return created;
    });
    await startSession(user.id, response);
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json({ status: "ok", user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ status: "error", message: "This email is already registered" });
      return;
    }
    next(error);
  }
});

authRouter.post("/login", async (request, response, next) => {
  if (!guardRateLimit(request.ip ?? "unknown", response)) return;
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: "Enter a valid email and password" });
    return;
  }
  try {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    const passwordCorrect = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordCorrect) {
      response.status(401).json({ status: "error", message: "Invalid email or password" });
      return;
    }
    await endSession(request, response, false); // revoke previous session, then send ONLY the new cookie
    await startSession(user.id, response);
    response.setHeader("Cache-Control", "no-store");
    response.json({ status: "ok", user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) { next(error); }
});

authRouter.get("/me", requireAuth, (_request, response) => {
  const auth = getAuth(response);
  response.json({ status: "ok", user: { id: auth.userId, name: auth.name, email: auth.email }, workspace: { id: auth.workspaceId, name: auth.workspaceName, role: auth.role }, demo: auth.isDemo });
});

authRouter.post("/logout", async (request, response, next) => {
  try {
    await endSession(request, response);
    response.setHeader("Cache-Control", "no-store");
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});
