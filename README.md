# ProjectFlow

A focused workspace for planning projects, coordinating tasks and keeping teams aligned. Built with a lightweight interface, private workspaces, a Kanban board and clear project progress.

> **Status:** v1.1 source release. The application runs locally; a public instance is not included with this repository. See `DEPLOYMENT.md` for self-hosted deployment.

## What you can do

- Create, update, archive and delete projects, with progress and due-date summaries.
- Organize tasks across **To do**, **In progress**, **In review** and **Done**. Set priorities, due dates and assignees; reorder by dragging.
- Filter tasks and see work assigned to you.
- Invite teammates to private workspaces using single-use, email-bound invitation codes and manage Owner, Admin and Member permissions.
- Sign in to a real account or use **Explore demo workspace** to try an isolated, prepopulated workspace without registration.

### Visitor demo

Click **Explore demo workspace** on the sign-in page. The server creates a unique temporary account with a private workspace containing three fictional business projects and realistic tasks. Visitors can create and edit projects and tasks. Demo sessions expire after **12 hours**; the server removes expired demo data on subsequent demo requests. Invitations and workspace switching are disabled in demos. A global active-session cap, an IP-based demo creation limit and smaller project/task quotas reduce abuse.

The optional **Add sample project** action remains available to regular workspace owners and admins. It does not overwrite ordinary work.

## Stack

| Area | Technology |
| --- | --- |
| Web | Next.js 16, React 19, TypeScript, CSS |
| API | Express 5, TypeScript, Zod |
| Data | PostgreSQL 16, Prisma 6 |
| Authentication | Server-side sessions, HttpOnly cookies, scrypt password hashing |
| Tooling | npm workspaces, Node 22+, Docker Compose, GitHub Actions |
| Deployment files | Docker, Caddy, HTTPS |

## Start locally

Prerequisites: Node.js 22+, npm, Docker Desktop/Engine. On Windows with Git Bash, use `npm.cmd` instead of `npm`.

```bash
# Open Docker Desktop first (Windows)
docker compose up -d --wait postgres

# First install or after downloading a new release
npm install

# Existing projects: KEEP server/.env from the old version.
# New clone: copy server/.env.example to server/.env and configure DATABASE_URL.
npm run db:generate
npm run db:deploy

# In terminal 1
npm run dev:api
# In terminal 2
npm run dev:web
```

Open **http://localhost:3000**. Register an account or use the visitor demo. If the database is already in use, `db:deploy` applies only pending migrations; do not reset the database. Windows-specific guidance is in `START_HERE_WINDOWS.md`.

### Check before committing

```bash
npm run verify:all
npm run build
```

`verify:all` runs TypeScript, API tests and live integration tests for authentication, projects, tasks, team invitations, sample content and demo isolation. It needs a running PostgreSQL container and the applied migrations. The integration scripts remove their temporary QA data.

### Repository layout

```text
client/                  Next.js interface and styles
server/src/              Express API, routes, session logic and demo service
server/prisma/           Schema and committed migrations
server/scripts/          Live verification scripts
.github/workflows/ci.yml CI tests and advisory report
compose.prod.yml         Self-hosted production topology
deploy/Caddyfile          HTTPS reverse proxy
```

## Security and deployment

Credentials are **never** included in the source archive. Keep `server/.env` and `.env.production` out of Git and screenshots. API access checks are enforced on the server, not just by hiding buttons. Demo projects are isolated from real accounts and other demos. The supplied production API image omits the Prisma CLI; a separate migration image runs schema migrations.

The dependency tree may still report a **high-severity `deepmerge-ts` advisory inherited through Prisma 6 tooling**. It is documented in `SECURITY.md`; do not treat passing application tests as proof the advisory is resolved. Before public deployment, assess the runtime images, apply available upstream fixes and add infrastructure abuse controls.

Refer to `SECURITY.md` and `DEPLOYMENT.md` for limitations, TLS setup, migrations and backups. This is a portfolio-scale application, not a production security certification.
