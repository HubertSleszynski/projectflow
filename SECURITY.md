# Security and disclosure notes

ProjectFlow is an independently built portfolio-scale collaboration app. It is not a certified production SaaS service. Do not store sensitive customer data in a public demo instance.

## Controls in place

- Server-side session validation on every private request; session tokens are SHA-256 hashed in PostgreSQL and issued as HttpOnly, SameSite=Lax cookies. Production cookies require HTTPS.
- Passwords are hashed with salted Node.js scrypt. Registration and login have bounded, in-memory rate limits.
- Workspace membership and role permissions are checked in the API; a visitor cannot use someone else's session workspace selector to access it.
- Mutating API requests are restricted to the configured web origin; JSON request sizes and project/task counts are capped.
- Temporary demos use separate, random, unguessable accounts and workspaces. They expire after 12 hours. Expired demo data is deleted when the next demo request triggers cleanup. Creation is capped per IP and by the global number of active demos; guest projects and tasks have lower quotas.
- Demo accounts cannot invite, join or manage team memberships. All guest changes remain in their own workspace.
- The production API image prunes dev dependencies and omits the Prisma CLI. A separate maintenance image runs `prisma migrate deploy`.

## Known gaps and release precautions

- No verified email ownership, password reset, MFA, distributed rate limiting, CAPTCHA, scheduled cleanup worker or external monitoring. Demo capacity limits are per process; deploy **one API replica** or add a shared limiter.
- **Dependency advisory:** Prisma 6 tooling can pull in `deepmerge-ts` 7.x, affected by GHSA-ggr8-5vv4-36mx. This is a high-severity advisory that was **not** resolved by the attempted local overrides. No claim of a clean `npm audit` is made. A CI advisory step reports vulnerabilities without blocking functional tests; it does not mean that security checks passed. Track upstream support and reassess production images before public launch.
- Do not expose internal API or PostgreSQL ports to the public Internet. The supplied Docker Compose production setup exposes only Caddy on ports 80/443.
- HTTPS, firewall rules, strong credentials, database backups and traffic/abuse monitoring are the deployer's responsibility. Demo creation should be disabled at the reverse proxy if abuse occurs.
- No email provider is configured. Invite codes must be delivered privately to the named recipient.
- Do not commit `.env`, local databases, session tokens, production credentials or user data. If secrets leak, rotate them and remove the commits containing them; `.gitignore` is not enough.

## Before going public

1. Apply the committed migrations and pass all integration tests on the target environment.
2. Inspect `npm audit` and production image contents; evaluate any outstanding high/critical findings.
3. Verify authentication, demo isolation, expiration, rate limits, account separation and mobile layout in a private browser window.
4. Configure HTTPS, DNS, backups and infrastructure protection; test recovery.
