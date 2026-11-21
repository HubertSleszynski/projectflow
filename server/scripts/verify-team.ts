/** Stage 6 live tests: invitations, memberships, workspace switching, role enforcement.
 * Runs only against temporary QA users and workspaces, then deletes them.
 * Do not run while you are manually changing the same QA records.
 */
import "dotenv/config";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
const salt = randomBytes(8).toString("hex");
const emails = ["owner", "teammate", "third", "wrong"].map((label) => `stage6-${label}-${salt}@example.test`);
const password = `Stage6-testing-${randomBytes(20).toString("hex")}`;

function assert(value: unknown, name: string): asserts value {
  if (!value) throw new Error(`FAILED: ${name}`);
  console.log(`  ✓ ${name}`);
}

function responseCookie(response: Response, name: string) {
  // Node 22 supports getSetCookie; fallback works for the single-cookie endpoints here.
  const cookies = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const found = cookies.find((item) => item.startsWith(`${name}=`));
  return found?.split(";")[0] ?? "";
}

async function main() {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server failed to start");
  const api = `http://127.0.0.1:${address.port}/api`;
  async function call(path: string, options: { method?: string; cookie?: string; body?: object; origin?: string } = {}) {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.method && options.method !== "GET") {
      headers.Origin = options.origin ?? origin;
      headers["Content-Type"] = "application/json";
    }
    const response = await fetch(api + path, {
      method: options.method ?? "GET", headers, body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await response.json() as Record<string, any>;
    return { response, data };
  }
  const register = async (email: string, name: string) => {
    const result = await call("/auth/register", { method: "POST", body: { email, name, password } });
    assert(result.response.status === 201, `${name} registered`);
    const cookie = responseCookie(result.response, "pf_session");
    assert(cookie.startsWith("pf_session="), `${name} has a session`);
    return cookie;
  };
  try {
    console.log("\nProjectFlow Stage 6 — LIVE team and invitation tests:");
    const ownerCookie = await register(emails[0], "Stage 6 Owner");
    const memberCookie = await register(emails[1], "Stage 6 Member");
    const thirdCookie = await register(emails[2], "Stage 6 Third");
    const wrongCookie = await register(emails[3], "Stage 6 Wrong");
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: emails[0] }, include: { memberships: true } });
    const member = await prisma.user.findUniqueOrThrow({ where: { email: emails[1] }, include: { memberships: true } });
    const third = await prisma.user.findUniqueOrThrow({ where: { email: emails[2] } });
    const workspaceId = owner.memberships[0].workspaceId;

    const ownerProject = await call("/projects", { method: "POST", cookie: ownerCookie, body: { name: "Shared team project" } });
    assert(ownerProject.response.status === 201, "owner created a workspace project");
    const foreignProject = await call(`/projects/${ownerProject.data.project.id}`, { cookie: memberCookie });
    assert(foreignProject.response.status === 404, "non-member cannot view private project");
    const noTeam = await call("/team", {});
    assert(noTeam.response.status === 401, "team API requires authentication");
    const invalidSwitch = await call("/team/switch", { method: "POST", cookie: memberCookie, body: { workspaceId } });
    assert(invalidSwitch.response.status === 404, "switch to foreign workspace is rejected");

    const invited = await call("/team/invitations", { method: "POST", cookie: ownerCookie,
      body: { email: emails[1], role: "MEMBER" } });
    assert(invited.response.status === 201 && /^[\w-]{43}$/.test(invited.data.code), "owner created an email-bound secret invitation");
    const code = String(invited.data.code);
    const databaseInvite = await prisma.workspaceInvitation.findFirstOrThrow({ where: { workspaceId, email: emails[1] } });
    assert(databaseInvite.tokenHash !== code && databaseInvite.tokenHash.length === 64, "only invitation hash stored in PostgreSQL");
    const wrongEmail = await call("/team/join", { method: "POST", cookie: wrongCookie, body: { code } });
    assert(wrongEmail.response.status === 400, "invitation cannot be redeemed by a different email");
    const accepted = await call("/team/join", { method: "POST", cookie: memberCookie, body: { code } });
    assert(accepted.response.status === 200, "correct email accepted invitation");
    const active = responseCookie(accepted.response, "pf_workspace");
    assert(active.startsWith("pf_workspace="), "invitation selects shared workspace in cookie");
    const memberSharedCookies = `${memberCookie}; ${active}`;
    const memberMe = await call("/auth/me", { cookie: memberSharedCookies });
    assert(memberMe.response.status === 200 && memberMe.data.workspace.id === workspaceId && memberMe.data.workspace.role === "MEMBER", "member has selected workspace and member role");
    const nowShared = await call(`/projects/${ownerProject.data.project.id}`, { cookie: memberSharedCookies });
    assert(nowShared.response.status === 200, "member sees shared workspace project");
    const reused = await call("/team/join", { method: "POST", cookie: thirdCookie, body: { code } });
    assert(reused.response.status === 400, "invitation is single-use");
    const memberInvite = await call("/team/invitations", { method: "POST", cookie: memberSharedCookies,
      body: { email: emails[2], role: "MEMBER" } });
    assert(memberInvite.response.status === 403, "member cannot invite others");
    const memberPromote = await call(`/team/members/${member.id}`, { method: "PATCH", cookie: memberSharedCookies, body: { role: "ADMIN" } });
    assert(memberPromote.response.status === 403, "member cannot promote self");
    const otherMemberRemoveOwner = await call(`/team/members/${owner.id}`, { method: "DELETE", cookie: memberSharedCookies });
    assert(otherMemberRemoveOwner.response.status === 403, "owner cannot be removed by member");

    const promoted = await call(`/team/members/${member.id}`, { method: "PATCH", cookie: ownerCookie, body: { role: "ADMIN" } });
    assert(promoted.response.status === 200, "owner promotes member to admin");
    const adminInviteAdmin = await call("/team/invitations", { method: "POST", cookie: memberSharedCookies,
      body: { email: emails[2], role: "ADMIN" } });
    assert(adminInviteAdmin.response.status === 403, "admin cannot invite another admin");
    const adminInviteMember = await call("/team/invitations", { method: "POST", cookie: memberSharedCookies,
      body: { email: emails[2], role: "MEMBER" } });
    assert(adminInviteMember.response.status === 201, "admin can invite a member");
    const thirdJoined = await call("/team/join", { method: "POST", cookie: thirdCookie,
      body: { code: adminInviteMember.data.code } });
    assert(thirdJoined.response.status === 200, "third user joins shared workspace");
    const thirdShared = `${thirdCookie}; ${responseCookie(thirdJoined.response, "pf_workspace")}`;
    const adminAttempt = await call(`/team/members/${third.id}`, { method: "PATCH", cookie: memberSharedCookies, body: { role: "ADMIN" } });
    assert(adminAttempt.response.status === 403, "admin cannot promote members");
    const ownerAssignedTask = await call(`/projects/${ownerProject.data.project.id}/tasks`, { method: "POST", cookie: ownerCookie,
      body: { title: "Work together on Kanban", assigneeId: third.id } });
    assert(ownerAssignedTask.response.status === 201, "owner can assign shared task to teammate");
    const mine = await call("/tasks/mine", { cookie: thirdShared });
    assert(mine.response.status === 200 && mine.data.tasks.some((task: { id: string }) => task.id === ownerAssignedTask.data.task.id), "teammate sees assignment in My tasks");

    const removed = await call(`/team/members/${third.id}`, { method: "DELETE", cookie: memberSharedCookies });
    assert(removed.response.status === 200, "admin can remove member");
    assert((await prisma.task.findUniqueOrThrow({ where: { id: ownerAssignedTask.data.task.id } })).assigneeId === null,
      "removed teammate is unassigned from workspace tasks");
    const left = await call("/projects", { cookie: thirdShared });
    assert(!left.data.projects.some((item: { id: string }) => item.id === ownerProject.data.project.id), "removed member loses project access immediately");

    const memberPrivate = await call("/team/switch", { method: "POST", cookie: memberSharedCookies,
      body: { workspaceId: member.memberships[0].workspaceId } });
    assert(memberPrivate.response.status === 200, "user can switch back to own workspace");
    const personalCookies = `${memberCookie}; ${responseCookie(memberPrivate.response, "pf_workspace")}`;
    const personalProject = await call("/projects", { cookie: personalCookies });
    assert(!personalProject.data.projects.some((p: { id: string }) => p.id === ownerProject.data.project.id), "personal workspace does not leak shared projects");

    const revokedInvite = await call("/team/invitations", { method: "POST", cookie: ownerCookie,
      body: { email: emails[3], role: "MEMBER" } });
    assert(revokedInvite.response.status === 201, "owner creates invitation for revocation test");
    const revoke = await call(`/team/invitations/${revokedInvite.data.invitation.id}`, { method: "DELETE", cookie: ownerCookie });
    assert(revoke.response.status === 200, "owner revokes invitation");
    const revokedUse = await call("/team/join", { method: "POST", cookie: wrongCookie, body: { code: revokedInvite.data.code } });
    assert(revokedUse.response.status === 400, "revoked invitation cannot be redeemed");
    const teamList = await call("/team", { cookie: ownerCookie });
    assert(teamList.response.status === 200 && teamList.data.members.length === 2,
      "owner can view team roster with remaining owner and admin");
    console.log("\nAll Stage 6 integration checks passed. ✅\n");
  } finally {
    try {
      const owned = await prisma.workspaceMember.findMany({ where: { role: "OWNER", user: { email: { in: emails } } }, select: { workspaceId: true } });
      if (owned.length) await prisma.workspace.deleteMany({ where: { id: { in: owned.map((row) => row.workspaceId) } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      console.log("Temporary Stage 6 QA accounts, invites and workspaces removed; existing data preserved.");
    } finally {
      await prisma.$disconnect();
      await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    }
  }
}

main().catch((error) => { console.error("Stage 6 tests failed:", error); process.exitCode = 1; });
