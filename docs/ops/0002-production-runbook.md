# Production Runbook

## Required GitHub configuration

Repository secrets:

| Name | Used by |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Migration and deploy jobs |
| `CLOUDFLARE_ACCOUNT_ID` | Migration and deploy jobs |
| `CLERK_PUBLISHABLE_KEY` | Web worker secret sync |
| `CLERK_SECRET_KEY` | Web worker secret sync |
| `PLAID_CLIENT_ID` | Web and sync worker secret sync |
| `PLAID_SECRET` | Web and sync worker secret sync |
| `PROVIDER_TOKEN_ENCRYPTION_KEY` | Web and sync worker secret sync |

Repository variables:

| Name | Purpose |
| --- | --- |
| `VISTA_PROD_D1_DATABASE_ID` | Production D1 database id used by both workers |
| `VISTA_PROD_PREVIEW_D1_DATABASE_ID` | Optional preview D1 id for the `prod` config; defaults to the production id if omitted by scripts |

## Local production commands

The production Wrangler config is generated from the checked-in `prod` environment blocks plus the D1 ids supplied through the shell or CI environment.

```bash
export VISTA_PROD_D1_DATABASE_ID=...
export VISTA_PROD_PREVIEW_D1_DATABASE_ID=...

bun run prepare:prod-config
bun run db:migrate:prod
bun run deploy:prod:web
bun run deploy:prod:sync
```

## GitHub Actions deploy flow

`deploy-prod.yml` runs in this order:

1. Generate production Wrangler configs with the configured D1 ids.
2. Apply remote D1 migrations.
3. Sync production secrets into the web worker.
4. Deploy the web worker.
5. Sync production secrets into the sync worker.
6. Deploy the sync worker.
7. Run a lightweight smoke check against `https://myzine.app`.

## Manual smoke-test checklist

Run this after the first production deploy, after any Clerk change, or after any Plaid onboarding change.

1. Visit `https://myzine.app` in an anonymous browser and confirm the app redirects to `/sign-in`.
2. Complete the Clerk sign-in flow and confirm the dashboard renders for the signed-in household.
3. Open the Plaid connect flow and confirm link-token initialization succeeds.
4. Complete a Plaid connect for a real testable institution and confirm the connection lands under the authenticated household.
5. Trigger the sync worker manually from the Cloudflare dashboard and confirm the scheduled run completes without credential-decryption or Plaid auth errors.
6. Verify Cloudflare observability shows logs for both `vista-web-prod` and `vista-sync-prod`.

## Rollback steps

### Web rollback

1. List deployed versions with `wrangler versions list --config apps/web/wrangler.prod.jsonc --env prod`.
2. Promote the last known good version with `wrangler versions deploy --config apps/web/wrangler.prod.jsonc --env prod`.
3. Re-run the anonymous redirect smoke check against `https://myzine.app`.

### Sync rollback

1. Re-deploy the previous known good commit through `deploy-prod.yml`, or deploy the previous version locally with `bun run deploy:prod:sync` from that commit.
2. Trigger the cron manually in Cloudflare and confirm the scheduled run succeeds.

### Migration rollback

1. Treat schema rollbacks as forward fixes unless the migration is fully reversible and already tested.
2. If a migration introduces an application incompatibility, first roll back the web and sync workers to the last compatible version.
3. Prepare and apply an explicit corrective migration instead of editing applied migration files.

## Operational notes

- The sync worker has `workers_dev: false` in production and should be observed through cron history and Cloudflare logs, not a public endpoint.
- The web worker is routed through the `myzine.app` custom domain and should not require config-file edits during routine deploys.
- Both workers must receive the same `PROVIDER_TOKEN_ENCRYPTION_KEY` value.