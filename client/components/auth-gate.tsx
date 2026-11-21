"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon } from "./icons";
import { WorkspaceApp } from "./workspace-app";

export type CurrentSession = {
  status: "ok";
  user: { id: string; name: string; email: string };
  workspace: { id: string; name: string; role: "OWNER" | "ADMIN" | "MEMBER" };
  demo?: boolean;
};

type Mode = "login" | "register";

export function AuthGate() {
  const [session, setSession] = useState<CurrentSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");

  const fetchSession = useCallback(async (): Promise<CurrentSession | null> => {
    let response: Response;
    try { response = await fetch("/api/auth/me", { cache: "no-store" }); }
    catch { throw new Error("Unable to connect. Please try again shortly."); }
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Session check failed (HTTP ${response.status}). Try again.`);
    return await response.json() as CurrentSession;
  }, []);

  const checkSession = useCallback(async () => {
    setChecking(true);
    setConnectionError("");
    try { setSession(await fetchSession()); }
    catch (cause) { setConnectionError(cause instanceof Error ? cause.message : "Unable to connect"); }
    finally { setChecking(false); }
  }, [fetchSession]);

  useEffect(() => { void checkSession(); }, [checkSession]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || demoLoading) return;
    setSubmitting(true); setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "register" ? { name, email, password } : { email, password }),
      });
      const payload: { message?: string } = await response.json();
      if (!response.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
      setPassword("");
      const verified = await fetchSession();
      if (!verified) throw new Error("Your session could not be verified. Please sign in again.");
      setSession(verified);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in"); }
    finally { setSubmitting(false); }
  }

  async function exploreDemo() {
    if (submitting || demoLoading) return;
    setDemoLoading(true); setError("");
    try {
      const response = await fetch("/api/demo", { method: "POST", cache: "no-store" });
      const payload: { message?: string } = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? `Unable to start demo (${response.status})`);
      const verified = await fetchSession();
      if (!verified) throw new Error("Could not open the demo workspace. Please try again.");
      setSession(verified);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the demo"); }
    finally { setDemoLoading(false); }
  }

  async function logout() {
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Could not sign out");
      setSession(null); setMode("login"); setPassword("");
    } catch (cause) { window.alert(cause instanceof Error ? cause.message : "Could not sign out"); }
  }

  if (checking) return <main className="auth-loading"><span className="auth-spinner"/><p>Opening your workspace…</p></main>;
  if (session) return <WorkspaceApp session={session} onLogout={() => void logout()}/>;

  return <main className="auth-screen">
    <div className="auth-brand"><div className="brand-mark"><span>PF</span></div><div className="brand-copy"><strong>ProjectFlow</strong><small>WORK, IN ONE PLACE</small></div></div>
    <div className="auth-grid">
      <section className="auth-intro" aria-labelledby="auth-headline">
        <div className="auth-overline"><span className="auth-overline-dot"/> ONE WORKSPACE FOR YOUR TEAM</div>
        <h1 id="auth-headline">Keep projects<br/><span>moving forward.</span></h1>
        <p>Plan projects, manage tasks and work with your team from one organized workspace.</p>
        <div className="auth-feature-list" aria-label="ProjectFlow features">
          <div className="auth-feature-row">
            <span className="auth-feature-icon"><Icon name="folder" size={19}/></span>
            <div className="auth-feature-copy"><strong>Projects</strong><span>Organize work and keep related tasks together.</span></div>
          </div>
          <div className="auth-feature-row">
            <span className="auth-feature-icon"><Icon name="checklist" size={19}/></span>
            <div className="auth-feature-copy"><strong>Tasks &amp; boards</strong><span>Set priorities, assign owners and track progress.</span></div>
          </div>
          <div className="auth-feature-row">
            <span className="auth-feature-icon"><Icon name="users" size={19}/></span>
            <div className="auth-feature-copy"><strong>Team workspaces</strong><span>Bring teammates into the same workspace.</span></div>
          </div>
        </div>
      </section>
      <section className="auth-card" aria-labelledby="auth-heading">
        <div className="auth-card-kicker">YOUR WORKSPACE</div>
        <h2 id="auth-heading">{mode === "login" ? "Welcome back" : "Get started"}</h2>
        <p>{mode === "login" ? "Sign in to pick up where you left off." : "Create an account and bring your work together."}</p>
        {connectionError ? <div className="auth-error" role="alert">{connectionError} <button type="button" className="pf-connection-retry" onClick={() => void checkSession()}>Retry</button></div> : null}
        <div className="auth-tabs" role="group" aria-label="Account access">
          <button type="button" className={mode === "login" ? "selected" : ""} onClick={() => { setMode("login"); setError(""); }}>Sign in</button>
          <button type="button" className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); }}>Create account</button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          {mode === "register" ? <><label htmlFor="auth-name">Full name</label><input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" minLength={2} maxLength={70} required placeholder="Alex Morgan"/></> : null}
          <label htmlFor="auth-email">Email address</label><input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@company.com"/>
          <label htmlFor="auth-password">Password</label><input id="auth-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 12 : 1} maxLength={128} placeholder={mode === "register" ? "At least 12 characters" : "Enter your password"}/>
          {mode === "register" ? <div className="auth-hint">Use at least 12 characters and a unique password.</div> : null}
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <button className="auth-submit" disabled={submitting || demoLoading} type="submit">{submitting ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}<Icon name="arrow-up-right" size={17}/></button>
        </form>
        <div className="auth-divider"><span/>or take a look around<span/></div>
        <button type="button" className="auth-demo-button" onClick={() => void exploreDemo()} disabled={submitting || demoLoading}><Icon name="layers" size={17}/>{demoLoading ? "Preparing your workspace…" : "Explore demo workspace"}<Icon name="arrow-up-right" size={16}/></button>
        <p className="auth-demo-note">No account needed. Your demo is private and available for 12 hours.</p>
      </section>
    </div>
    <div className="auth-bottom">ProjectFlow <span>·</span> Plan together. Deliver better.</div>
  </main>;
}
