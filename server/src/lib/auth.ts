import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Request, RequestHandler, Response } from "express";
import { prisma } from "./prisma.js";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "pf_session";
const WORKSPACE_COOKIE = "pf_workspace";
const SESSION_DAYS = 7;

export type AuthContext = {
  userId: string;
  name: string;
  email: string;
  workspaceId: string;
  workspaceName: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  isDemo: boolean;
};

/** Built-in scrypt means this project needs no native password-hashing dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const output = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${output.toString("hex")}`;
}

export async function verifyPassword(password: string, saved: string | null): Promise<boolean> {
  if (!saved) return false; // Accounts without a password cannot sign in using credentials.
  const [algorithm, salt, storedHex, extra] = saved.split(":");
  if (algorithm !== "scrypt" || extra !== undefined || !salt || !/^[a-f0-9]{32}$/.test(salt) || !storedHex || !/^[a-f0-9]{128}$/.test(storedHex)) return false;
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const stored = Buffer.from(storedHex, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieValue(request: Request, name: string): string {
  const pair = request.headers.cookie?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) ?? "";
}

export function setActiveWorkspaceCookie(response: Response, workspaceId: string, durationMs = SESSION_DAYS * 24 * 60 * 60 * 1000) {
  response.cookie(WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", path: "/", maxAge: durationMs });
}

export function clearActiveWorkspaceCookie(response: Response) {
  response.clearCookie(WORKSPACE_COOKIE, { httpOnly: true, sameSite: "lax",
    secure: process.env.NODE_ENV === "production", path: "/" });
}

function readCookie(request: Request): string | null {
  const token = cookieValue(request, COOKIE_NAME);
  // Session tokens are base64url and intentionally not URL-decoded.
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function startSession(userId: string, response: Response, durationMs = SESSION_DAYS * 24 * 60 * 60 * 1000) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + durationMs);
  await prisma.session.create({ data: { userId, tokenHash: tokenHash(token), expiresAt } });
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: durationMs,
  });
}

export async function endSession(request: Request, response: Response, shouldClearCookie = true) {
  const token = readCookie(request);
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  if (shouldClearCookie) { clearSessionCookie(response); clearActiveWorkspaceCookie(response); }
}

/** Server-side session lookup on EVERY private request: not just a frontend login flag. */
export const requireAuth: RequestHandler = async (request, response, next) => {
  const token = readCookie(request);
  if (!token) {
    response.status(401).json({ status: "error", message: "Please sign in to continue" });
    return;
  }
  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: { include: { memberships: { include: { workspace: true }, orderBy: { joinedAt: "asc" } } } } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await prisma.session.deleteMany({ where: { id: session.id } });
      clearSessionCookie(response);
      response.status(401).json({ status: "error", message: "Session expired. Please sign in again" });
      return;
    }
    if (session.user.isDemo && (!session.user.demoExpiresAt || session.user.demoExpiresAt <= new Date())) {
      clearSessionCookie(response);
      clearActiveWorkspaceCookie(response);
      response.status(401).json({ status: "error", message: "This demo has expired. Start a new demo to continue." });
      return;
    }
    // The selected workspace is untrusted input. Use it ONLY after verifying
    // membership in the database for the authenticated user.
    const selectedId = cookieValue(request, WORKSPACE_COOKIE);
    const membership = session.user.memberships.find((item) => item.workspaceId === selectedId) ?? session.user.memberships[0];
    if (!membership) {
      response.status(403).json({ status: "error", message: "You are not a workspace member" });
      return;
    }
    response.locals.auth = {
      userId: session.userId,
      name: session.user.name,
      email: session.user.email,
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspace.name,
      role: membership.role,
      isDemo: session.user.isDemo,
    } satisfies AuthContext;
    response.setHeader("Cache-Control", "no-store");
    next();
  } catch (error) {
    next(error);
  }
};

export function getAuth(response: Response): AuthContext {
  return response.locals.auth as AuthContext;
}

/** Browser POST/PUT/PATCH/DELETE must originate from our Next.js UI. */
export const checkOrigin: RequestHandler = (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  const origin = request.get("origin");
  const allowedOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  if (origin !== allowedOrigin) {
    response.status(403).json({ status: "error", message: "Request origin is not allowed" });
    return;
  }
  next();
};
