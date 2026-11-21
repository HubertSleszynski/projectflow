# ProjectFlow

A collaborative workspace for managing projects, organizing tasks, and keeping teams aligned.

ProjectFlow combines project tracking, a drag-and-drop Kanban board, team workspaces, and role-based access in a single application. Visitors can explore the product without creating an account using an isolated demo workspace.

## Features

- **Project management** — create, edit, archive, restore, and delete projects.
- **Kanban boards** — move tasks between To do, In progress, In review, and Done; reorder tasks with drag and drop.
- **Task tracking** — priorities, due dates, assignees, and a personal **My tasks** view.
- **Team collaboration** — private workspaces, invitation codes, and Owner / Admin / Member roles.
- **Authentication** — password hashing, database-backed sessions, and HttpOnly cookies.
- **Instant demo** — explore three fictional event-management projects without registration. Each visitor gets a separate temporary workspace.

## Tech stack

| Layer | Technologies |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, CSS |
| Backend | Express 5, TypeScript, Zod |
| Database | PostgreSQL 16, Prisma 6 |
| Tooling | npm workspaces, Docker Compose, GitHub Actions |

The frontend and API are separate applications within the same repository. The browser uses a same-origin `/api` path, which Next.js proxies to Express.

## Getting started

**Requirements:** Node.js 22+, npm, and Docker Desktop (or Docker Engine with Compose).

1. Clone the repository and install dependencies:

   ```bash
   git clone https://github.com/HubertSleszynski/projectflow.git
   cd projectflow
   npm install
   ```

2. Create the local backend configuration:

   ```bash
   cp server/.env.example server/.env
   ```

   The example configuration targets the PostgreSQL container on port `5433`. Keep your real `.env` files out of version control.

3. Start PostgreSQL and apply the database migrations:

   ```bash
   docker compose up -d --wait postgres
   npm run db:generate
   npm run db:deploy
   ```

4. Start the application in two separate terminals:

   ```bash
   # Terminal 1 — Express API
   npm run dev:api
   ```

   ```bash
   # Terminal 2 — Next.js frontend
   npm run dev:web
   ```

Open **http://localhost:3000**. Sign up for an account or select **Explore demo workspace**.

> **Windows / Git Bash:** Use `npm.cmd` in place of `npm` if your shell does not resolve the npm command correctly.

## Testing

With PostgreSQL running and migrations applied:

```bash
npm run verify:all
npm run build
```

The verification suite covers TypeScript, API unit tests, authentication, workspace isolation, projects, tasks, invitations, and demo access. Integration tests create and remove temporary test data.

## Project structure

```text
client/                   Next.js frontend
server/src/               Express API and business logic
server/prisma/            Database schema and migrations
server/scripts/           Integration verification scripts
.github/workflows/        Continuous integration
docker-compose.yml        Local PostgreSQL service
```

## Demo and security notes

The demo creates a private, temporary workspace with fictional event-management data. Demo sessions expire after 12 hours, and invitations are unavailable in demo mode. Cleanup runs when subsequent demo requests arrive, rather than on a background schedule.

ProjectFlow is a portfolio project. Before exposing it publicly, review dependency advisories, serverless-specific rate limiting, session behavior, database connection limits, and abuse protection. Do not use real customer or sensitive data in the public demo.

## Deployment

A public deployment is being prepared. The intended setup is **Vercel for the frontend and API** with **Neon PostgreSQL**. Deployment configuration and the live URL will be added after production verification.
