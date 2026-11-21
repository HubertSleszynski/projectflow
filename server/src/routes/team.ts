import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getAuth, setActiveWorkspaceCookie, clearActiveWorkspaceCookie } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export const teamRouter = Router();
// Demo visitors may view their private team roster, but cannot invite, join,
// modify membership or share a workspace with real accounts.
teamRouter.use((request, response, next) => {
  if (request.method !== "GET" && getAuth(response).isDemo) {
    response.status(403).json({ status: "error", message: "Team management is unavailable in the demo workspace." });
    return;
  }
  next();
});
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
const adminRoles = new Set(["OWNER", "ADMIN"]);

const inviteInput = z.object({
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["MEMBER", "ADMIN"]),
}).strict();
const joinInput = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation code") }).strict();
const switchInput = z.object({ workspaceId: z.string().min(1).max(128) }).strict();
const roleInput = z.object({ role: z.enum(["MEMBER", "ADMIN"]) }).strict();

// Only records for the active workspace may be listed. The active workspace
// itself is validated against session membership by requireAuth.
teamRouter.get("/", async (_request, response, next) => {
  try {
    const auth = getAuth(response);
    const [members, workspaces, invitations] = await Promise.all([
      prisma.workspaceMember.findMany({ where: { workspaceId: auth.workspaceId },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { joinedAt: "asc" } }),
      prisma.workspaceMember.findMany({ where: { userId: auth.userId },
        include: { workspace: { select: { id: true, name: true } } }, orderBy: { joinedAt: "asc" } }),
      adminRoles.has(auth.role) ? prisma.workspaceInvitation.findMany({
        where: { workspaceId: auth.workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      }) : Promise.resolve([]),
    ]);
    response.json({ status: "ok",
      members: members.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email,
        role: m.role, joinedAt: m.joinedAt })),
      workspaces: workspaces.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role,
        active: m.workspaceId === auth.workspaceId })),
      invitations,
    });
  } catch (error) { next(error); }
});

// Without an email provider, a secret invitation code
// is returned ONCE for the inviter to share privately with the named recipient.
teamRouter.post("/invitations", async (request, response, next) => {
  const auth = getAuth(response);
  if (!adminRoles.has(auth.role)) {
    response.status(403).json({ status: "error", message: "Only owners and admins can invite members" }); return;
  }
  const parsed = inviteInput.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid invitation" }); return;
  }
  const { email, role } = parsed.data;
  if (role === "ADMIN" && auth.role !== "OWNER") {
    response.status(403).json({ status: "error", message: "Only owners can invite administrators" }); return;
  }
  try {
    const existing = await prisma.workspaceMember.findFirst({ where: { workspaceId: auth.workspaceId, user: { email } } });
    if (existing) { response.status(409).json({ status: "error", message: "That person is already on the team" }); return; }
    const count = await prisma.workspaceMember.count({ where: { workspaceId: auth.workspaceId } });
    if (count >= 50) { response.status(409).json({ status: "error", message: "Team limit reached (50 members)" }); return; }
    const pending = await prisma.workspaceInvitation.findMany({ where: {
      workspaceId: auth.workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() },
    }, select: { email: true } });
    if (pending.length >= 25) { response.status(409).json({ status: "error", message: "Too many pending invitations (25)" }); return; }
    if (pending.some((item) => item.email === email)) {
      response.status(409).json({ status: "error", message: "An active invitation already exists for this email; revoke it first" }); return;
    }
    const code = randomBytes(32).toString("base64url");
    const invitation = await prisma.workspaceInvitation.create({ data: {
      workspaceId: auth.workspaceId, email, role, tokenHash: hashCode(code), createdById: auth.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    }, select: { id: true, email: true, role: true, expiresAt: true } });
    response.status(201).json({ status: "ok", invitation, code });
  } catch (error) { next(error); }
});

teamRouter.delete("/invitations/:id", async (request, response, next) => {
  const auth = getAuth(response);
  if (!adminRoles.has(auth.role)) { response.status(403).json({ status: "error", message: "Not allowed" }); return; }
  try {
    const id = String(request.params.id);
    const invitation = await prisma.workspaceInvitation.findFirst({ where: { id, workspaceId: auth.workspaceId,
      revokedAt: null, acceptedAt: null } });
    if (!invitation) { response.status(404).json({ status: "error", message: "Invitation not found" }); return; }
    if (auth.role === "ADMIN" && invitation.role !== "MEMBER") {
      response.status(403).json({ status: "error", message: "Admins may only revoke member invitations" }); return;
    }
    await prisma.workspaceInvitation.updateMany({ where: { id, workspaceId: auth.workspaceId, revokedAt: null, acceptedAt: null },
      data: { revokedAt: new Date() } });
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

teamRouter.post("/join", async (request, response, next) => {
  const parsed = joinInput.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ status: "error", message: "Invalid invitation code" }); return; }
  const auth = getAuth(response);
  try {
    const workspaceId = await prisma.$transaction(async (tx) => {
      const invitation = await tx.workspaceInvitation.findUnique({ where: { tokenHash: hashCode(parsed.data.code) } });
      if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt.getTime() <= Date.now()
        || invitation.email !== auth.email.toLowerCase() || invitation.role === "OWNER") return null;
      const alreadyMember = await tx.workspaceMember.findUnique({ where: {
        workspaceId_userId: { workspaceId: invitation.workspaceId, userId: auth.userId },
      } });
      if (alreadyMember) return null;
      const size = await tx.workspaceMember.count({ where: { workspaceId: invitation.workspaceId } });
      if (size >= 50) return null;
      const claimed = await tx.workspaceInvitation.updateMany({ where: {
        id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() },
      }, data: { acceptedAt: new Date() } });
      if (claimed.count !== 1) return null;
      await tx.workspaceMember.create({ data: { workspaceId: invitation.workspaceId, userId: auth.userId, role: invitation.role } });
      return invitation.workspaceId;
    });
    if (!workspaceId) { response.status(400).json({ status: "error", message: "Invitation is invalid, expired, used, or for another email" }); return; }
    setActiveWorkspaceCookie(response, workspaceId);
    response.json({ status: "ok", workspaceId });
  } catch (error) { next(error); }
});

teamRouter.post("/switch", async (request, response, next) => {
  const parsed = switchInput.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ status: "error", message: "Invalid workspace" }); return; }
  try {
    const auth = getAuth(response);
    const member = await prisma.workspaceMember.findUnique({ where: {
      workspaceId_userId: { workspaceId: parsed.data.workspaceId, userId: auth.userId },
    } });
    if (!member) { response.status(404).json({ status: "error", message: "Workspace not found" }); return; }
    setActiveWorkspaceCookie(response, member.workspaceId);
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

teamRouter.patch("/members/:userId", async (request, response, next) => {
  const auth = getAuth(response);
  if (auth.role !== "OWNER") { response.status(403).json({ status: "error", message: "Only the owner can change roles" }); return; }
  const parsed = roleInput.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ status: "error", message: "Role must be Admin or Member" }); return; }
  const userId = String(request.params.userId);
  if (userId === auth.userId) { response.status(400).json({ status: "error", message: "You cannot change your own owner role" }); return; }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.workspaceMember.updateMany({ where: { workspaceId: auth.workspaceId, userId, role: { not: "OWNER" } },
        data: { role: parsed.data.role } });
      // An admin demoted to Member must not retain unused invitation codes.
      if (result.count && parsed.data.role === "MEMBER") {
        await tx.workspaceInvitation.updateMany({ where: { workspaceId: auth.workspaceId, createdById: userId,
          acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return result;
    });
    if (!updated.count) { response.status(404).json({ status: "error", message: "Team member not found or cannot be changed" }); return; }
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

teamRouter.delete("/members/:userId", async (request, response, next) => {
  const auth = getAuth(response);
  const userId = String(request.params.userId);
  try {
    const member = await prisma.workspaceMember.findUnique({ where: {
      workspaceId_userId: { workspaceId: auth.workspaceId, userId },
    } });
    if (!member) { response.status(404).json({ status: "error", message: "Team member not found" }); return; }
    if (member.role === "OWNER") { response.status(403).json({ status: "error", message: "Owner cannot be removed" }); return; }
    const isSelf = auth.userId === userId;
    if (!isSelf && auth.role !== "OWNER" && !(auth.role === "ADMIN" && member.role === "MEMBER")) {
      response.status(403).json({ status: "error", message: "Insufficient permissions to remove this member" }); return;
    }
    await prisma.$transaction(async (tx) => {
      await tx.task.updateMany({ where: { assigneeId: userId, project: { workspaceId: auth.workspaceId } }, data: { assigneeId: null } });
      await tx.workspaceInvitation.updateMany({ where: { workspaceId: auth.workspaceId, createdById: userId,
        acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.workspaceMember.deleteMany({ where: { workspaceId: auth.workspaceId, userId, role: { not: "OWNER" } } });
    });
    if (isSelf) clearActiveWorkspaceCookie(response);
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});
