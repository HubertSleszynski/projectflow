"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import type { CurrentSession } from "./auth-gate";

type Role = "OWNER" | "ADMIN" | "MEMBER";
type Member = { userId: string; name: string; email: string; role: Role; joinedAt: string };
type Invitation = { id: string; email: string; role: Role; createdAt: string; expiresAt: string };
type Workspace = { id: string; name: string; role: Role; active: boolean };
type TeamData = { status: "ok"; members: Member[]; invitations: Invitation[]; workspaces: Workspace[] };

const labels: Record<Role, string> = { OWNER: "Owner", ADMIN: "Admin", MEMBER: "Member" };
const day = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function teamApi<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await fetch(`/api/team${path}`, { ...options, credentials: "same-origin", cache: "no-store" }); }
  catch { throw new Error("Unable to connect. Try again in a moment."); }
  const data: { message?: string } = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  return data as T;
}

const json = (body: object, method = "POST"): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function TeamManagement({ session, onWorkspaceChanged }: {
  session: CurrentSession; onWorkspaceChanged: () => void;
}) {
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MEMBER" | "ADMIN">("MEMBER");
  const [lastCode, setLastCode] = useState("");
  const [lastRecipient, setLastRecipient] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const isAdmin = !session.demo && (session.workspace.role === "OWNER" || session.workspace.role === "ADMIN");
  const isOwner = !session.demo && session.workspace.role === "OWNER";

  const refresh = useCallback(async () => {
    try {
      setError("");
      const result = await teamApi<TeamData>("");
      setData(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load the team"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function operation(action: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try { await action(); setNotice(success); await refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong"); return false; }
    finally { setBusy(false); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setLastCode(""); setBusy(true); setError(""); setNotice("");
    try {
      const address = email.trim().toLowerCase();
      const result = await teamApi<{ code: string }>("/invitations", json({ email: address, role }));
      setLastCode(result.code); setLastRecipient(address); setEmail("");
      setNotice("Invitation created. Share this code privately with the matching email address.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create invite"); }
    finally { setBusy(false); }
  }

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      await teamApi("/join", json({ code: joinCode.trim() }));
      setJoinCode("");
      onWorkspaceChanged(); // reload so all existing API views use the new workspace
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not join workspace"); setBusy(false); }
  }

  async function switchWorkspace(workspaceId: string) {
    if (busy || session.workspace.id === workspaceId) return;
    setBusy(true); setError("");
    try { await teamApi("/switch", json({ workspaceId })); onWorkspaceChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Cannot switch workspace"); setBusy(false); }
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(lastCode); setNotice("Invitation code copied."); }
    catch { setNotice("Select and copy the invitation code manually."); }
  }

  return <div className="pf-team-page">
    <div className="pf-heading-row"><div><div className="eyebrow">WORKSPACE / TEAM</div><h1>Better work, <span>together.</span></h1><p>Invite teammates, control access and collaborate on shared projects.</p></div>
      <span className="pf-team-count">{data?.members.length ?? "–"} team members</span></div>
    {error ? <div role="alert" className="pf-alert">{error}<button type="button" onClick={() => void refresh()}>Retry</button></div> : null}
    {notice ? <div className="pf-toast" role="status"><Icon name="check" size={16}/>{notice}<button type="button" onClick={() => setNotice("")}>Dismiss</button></div> : null}
    <section className="pf-team-intro"><div><span className="pf-online-dot"/> TEAM COLLABORATION</div><h2>{session.workspace.name}</h2><p>Everyone invited to this workspace can see its projects and work together on the task boards. Your personal workspace remains separate.</p><span className="pf-role-tag">Your role: {labels[session.workspace.role]}</span></section>

    <div className="pf-team-grid">
      <section className="pf-panel pf-team-members"><div className="pf-panel-header"><div><h2>Team members</h2><p>People with access to this workspace.</p></div><button className="pf-link" type="button" onClick={() => void refresh()}>Refresh</button></div>
        {loading ? <p className="pf-muted-pad">Loading members…</p> : (data?.members ?? []).map((member) => <div className="pf-team-row" key={member.userId}>
          <span className="pf-member-avatar">{member.name.slice(0, 1).toUpperCase()}</span>
          <span className="pf-team-person"><strong>{member.name} {member.userId === session.user.id ? <small>(you)</small> : null}</strong><small>{session.demo ? "Demo member" : member.email}</small></span>
          <span className={`pf-role-tag pf-role-${member.role.toLowerCase()}`}>{labels[member.role]}</span>
          {isOwner && member.role !== "OWNER" ? <select aria-label={`Role for ${member.name}`} value={member.role} disabled={busy} onChange={(e) => void operation(() => teamApi(`/members/${encodeURIComponent(member.userId)}`, json({ role: e.target.value }, "PATCH")), "Member role updated.")}><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></select> : null}
          {member.role !== "OWNER" && (member.userId === session.user.id || isOwner || (session.workspace.role === "ADMIN" && member.role === "MEMBER")) ?
            <button className="pf-small-danger" type="button" disabled={busy} onClick={() => {
              if (window.confirm(`${member.userId === session.user.id ? "Leave" : "Remove " + member.name + " from"} this workspace?`))
                void operation(() => teamApi(`/members/${encodeURIComponent(member.userId)}`, { method: "DELETE" }), member.userId === session.user.id ? "You have left the workspace." : "Member removed.").then((ok) => { if (ok && member.userId === session.user.id) onWorkspaceChanged(); });
            }}>{member.userId === session.user.id ? "Leave" : "Remove"}</button> : null}
        </div>)}
      </section>

      <div className="pf-team-side">
        {session.demo ? <section className="pf-panel pf-team-card"><h2>Your demo, your space</h2><p>You can explore projects and tasks freely. Invitations and workspace switching are available with a personal account.</p><span className="pf-role-tag">Demo access</span></section> : <>
        <section className="pf-panel pf-team-card"><h2>Join a team</h2><p>Have an invitation code? Sign in using the invited email, then enter it here.</p>
          <form onSubmit={(e) => void join(e)}><label htmlFor="pf-join-code">Invitation code</label><input id="pf-join-code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="Paste your one-time code" required maxLength={100}/><button className="pf-btn pf-primary pf-full" disabled={busy || !joinCode.trim()} type="submit">Join workspace</button></form>
        </section>
        <section className="pf-panel pf-team-card"><h2>Switch workspace</h2><p>Choose between teams you belong to. Switching changes which projects and tasks you can see.</p>
          <div className="pf-workspace-options">{(data?.workspaces ?? []).map((ws) => <button className={`pf-workspace-option ${ws.active ? "is-active" : ""}`} type="button" disabled={busy || ws.active} key={ws.id} onClick={() => void switchWorkspace(ws.id)}><span className="pf-workspace-avatar">{ws.name.charAt(0).toUpperCase()}</span><span><strong>{ws.name}</strong><small>{labels[ws.role]}</small></span>{ws.active ? <span className="pf-ws-current">Current</span> : <Icon name="chevron-right" size={16}/>}</button>)}</div>
        </section></>}
      </div>
    </div>

    {isAdmin ? <div className="pf-team-grid pf-team-second-row">
      <section className="pf-panel pf-team-card"><h2>Invite a teammate</h2><p>Invitations are tied to one email and expire in 7 days. Codes can be used only once.</p>
        <form onSubmit={(e) => void invite(e)}><div className="pf-team-form-grid"><div><label htmlFor="pf-invite-email">Teammate email</label><input id="pf-invite-email" type="email" required placeholder="colleague@example.com" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)}/></div><div><label htmlFor="pf-invite-role">Role</label><select id="pf-invite-role" value={role} disabled={busy} onChange={(e) => setRole(e.target.value as "MEMBER" | "ADMIN")}><option value="MEMBER">Member</option>{isOwner ? <option value="ADMIN">Admin</option> : null}</select></div></div><button type="submit" className="pf-btn pf-primary" disabled={busy || !email.trim()}>Generate invitation code</button></form>
        {lastCode ? <div className="pf-invite-result"><strong>One-time code for {lastRecipient}</strong><p>Copy this now. The full code will not be shown again after you leave this page.</p><textarea aria-label="Invitation code" readOnly rows={3} value={lastCode} onFocus={(e) => e.currentTarget.select()}/><button className="pf-btn pf-outline" type="button" onClick={() => void copyCode()}>Copy code</button></div> : null}
      </section>
      <section className="pf-panel pf-team-card"><h2>Pending invitations</h2><p>Unclaimed codes and their expiry dates.</p>
        {(data?.invitations.length ?? 0) === 0 ? <div className="pf-empty pf-team-empty">No pending invitations</div> : <div className="pf-invite-list">{data?.invitations.map((invite) => <div className="pf-invite-row" key={invite.id}><div><strong>{invite.email}</strong><small>{labels[invite.role]} · Expires {day(invite.expiresAt)}</small></div>{(isOwner || invite.role === "MEMBER") ? <button type="button" className="pf-small-danger" disabled={busy} onClick={() => void operation(() => teamApi(`/invitations/${encodeURIComponent(invite.id)}`, { method: "DELETE" }), "Invitation revoked.")}>Revoke</button> : null}</div>)}</div>}
      </section>
    </div> : null}

    {!session.demo ? <p className="pf-team-footnote"><Icon name="shield" size={15}/> Invitation codes are private and valid for seven days. Share them only with the person you invited.</p> : null}
  </div>;
}
