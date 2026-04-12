# Vista Web

The web app is the authenticated React Router SSR frontend for Vista. It runs on the Cloudflare Worker entrypoint in `workers/app.ts` and shares D1 state with the sync worker.

## Local development

Install dependencies from the repo root:

```bash
bun install
```

Copy the repo-level `.env.example` to `.env.local`, add your Clerk and Plaid credentials, then start the full local stack from the repo root:

```bash
bun run dev
```

The web app is available at `http://127.0.0.1:5173` by default, or at `http://$VISTA_DEV_HOST:$VISTA_WEB_PORT` when those environment variables are set.

## Useful commands

From the repo root:

```bash
bun run build:web
bun run typecheck
bun test apps/web/app/routes/home.test.tsx
```

## Production deploys

Production deploys are driven from the repo root so the web and sync workers stay in lockstep:

```bash
bun run db:migrate:prod
bun run deploy:prod:web
```

Before using the production scripts, set `VISTA_PROD_D1_DATABASE_ID` and optionally `VISTA_PROD_PREVIEW_D1_DATABASE_ID` in your shell or CI environment. The full launch and rollback process lives in `docs/ops/0002-production-runbook.md`.
