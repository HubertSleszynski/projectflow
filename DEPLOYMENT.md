# Deploy ProjectFlow publicly (one domain, Docker Compose, HTTPS)

This guide is for the **included self-hosted Docker deployment**. The hosted app does not exist until you perform these steps on your own server. A public domain, DNS and a Linux VPS are required. Docker Desktop on Windows is useful for development but does not provide a public website.

## Architecture and prerequisites

A public browser communicates with **Caddy** on ports 80/443. Caddy routes to Next.js (`web:3000`). Next.js proxies `/api/*` to **Express** (`api:3001`) inside the same Docker network, which talks to internal **PostgreSQL** (`db:5432`). **Only Caddy exposes public ports.** Cookies are `Secure` in production.

You need:

- A Linux VPS with Docker Engine and the Compose plugin, accessible over SSH.
- A domain/subdomain (e.g. `projectflow.example.com`) whose DNS **A** record points to your VPS public IP; allow inbound TCP 80/443 and optionally UDP 443 in the firewall.
- This clean source repository on the VPS (via `git clone`, SCP or a secure deploy method).
- A backup and a plan for future dependency/security updates. Production database credentials must be different from local development credentials.

## 1. Configure production environment

On the VPS in the repository root:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` using `nano`/`vim` or a secure editor:

```dotenv
APP_DOMAIN=projectflow.example.com
POSTGRES_PASSWORD=YOUR_RANDOM_URL_SAFE_PASSWORD
```

Use **only letters, digits, `-`, `_`** in the generated URL-safe database password; this avoids URL-encoding issues in `DATABASE_URL`. Generate it locally, for example:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Use your own secret value and your actual hostname. Never commit or share `.env.production`.

## 2. Check configuration and build containers

```bash
docker compose --env-file .env.production -f compose.prod.yml config --quiet
docker compose --env-file .env.production -f compose.prod.yml build
```

The build downloads Node and npm dependencies from the internet. It creates a Next.js standalone image, a production Express image with dev tools pruned, and a Prisma migration image. If you encounter a build error, fix it before proceeding. Keep the backend behind the private Docker network.

## 3. Start database and apply migrations

```bash
docker compose --env-file .env.production -f compose.prod.yml up -d db
docker compose --env-file .env.production -f compose.prod.yml run --rm migrate
```

**Production uses `prisma migrate deploy`, not `prisma migrate dev`.** Existing migrations create the necessary tables. Do **not** run the demo seed on your production instance, and do **not** use `docker compose down -v` on a database containing real data. Prisma's official production workflow recommends `migrate deploy` for applying committed migrations.

## 4. Launch the website

```bash
docker compose --env-file .env.production -f compose.prod.yml up -d api web caddy
docker compose --env-file .env.production -f compose.prod.yml ps
```

Caddy requests and renews the HTTPS certificate when your DNS and ports are correct. Visit `https://YOUR_APP_DOMAIN` only after the certificate is issued; the `.env.production` `APP_DOMAIN` value contains **no** `https://` prefix.

Check:

```bash
curl -I https://projectflow.example.com
curl https://projectflow.example.com/api/health
```

Replace the sample domain with your actual one. The health endpoint should return JSON with `"status":"ok"` and `"version":"1.1.0"`.

## 5. Test the real public application

- Open the URL in a private browser window. Register a new account with a new password (do not reuse a personal password).
- Create a project and a task, move it on the Kanban board, refresh and verify persistence.
- Create a second account in another private window, invite it by email-bound code and verify workspace isolation and assignments.
- Logout and confirm a previously authenticated private API endpoint now returns HTTP 401.
- Check mobile layout and browser console.
- Run `npm audit --omit=dev` and `npm audit` on a machine with registry access before public launch; resolve or explicitly assess high/critical advisories and rebuild images. The Prisma 6 / deepmerge-ts advisory is tracked in `SECURITY.md`.

## Maintenance and backups

For logs:

```bash
docker compose --env-file .env.production -f compose.prod.yml logs --tail=100 api web caddy
```

For a database backup, **store backups securely** (they include private account/workspace data):

```bash
mkdir -p backups
chmod 700 backups
docker compose --env-file .env.production -f compose.prod.yml exec -T db pg_dump -U projectflow projectflow > backups/projectflow-$(date +%F).sql
chmod 600 backups/*.sql
```

`backups/` is ignored by Git. Keep backups **outside the VPS** as well, test restoration periodically, and ensure HTTPS and firewall rules remain in place. Rebuild and restart images when upgrading dependencies or modifying the app; back up the database before running new migrations.

## Security and scope caveats

- **One API process**: the current auth throttle is in-memory and not distributed. Use an external shared rate limiter before scaling replicas; the demo should not be marketed as internet-scale production SaaS.
- Registration doesn't verify email ownership. Invite codes must be communicated privately. No automatic email delivery, password reset or MFA are implemented.
- Anonymous demo creation uses per-IP and global caps, but rate limits are process-local. Demo data expires after 12 hours and is cleaned up on subsequent demo requests; add external abuse protection and scheduled cleanup for public use.
- The app exposes legitimate registration and demo endpoints; monitor signups, traffic and database size. Control costs and abuse at infrastructure level.
- SSL/HTTPS, strong database credentials, firewall, updating dependencies and regular backups are the deployer's responsibility.
- Never expose the database or API container ports directly to the public internet. The provided Compose config exposes only Caddy.
- Verify the image builds and full end-to-end flows on your actual host before placing the link on your CV.

## Official references

- Next.js self-hosting: https://nextjs.org/docs/app/guides/self-hosting
- Prisma v6 deployment migrations: https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production
- Docker Compose environment variables: https://docs.docker.com/compose/how-tos/environment-variables/best-practices/
- Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
