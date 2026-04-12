# Plan 0001: Productionize myzine.app on Cloudflare

- Status: In Progress
- Date: 2026-04-11
- Scope: Launch the existing web app publicly at `https://myzine.app` on Cloudflare, secure it with Clerk authentication, and automate production delivery with GitHub Actions.
- Related docs:
  - `docs/blueprint/0001-v1-repository-blueprint.md`
  - `docs/adr/0002-normalized-data-model-and-sync-workflow.md`
  - `docs/prd/0001-v1-household-financial-snapshot.md`

## Goals

- Serve the app at the apex domain `myzine.app`.
- Keep the runtime fully on Cloudflare for production traffic.
- Add real application authentication before public launch.
- Separate local development from production infrastructure and secrets.
- Automate migrations and deployments through GitHub Actions.
- Close the highest-risk security gaps before launch.

## Progress

### Milestone log

- 2026-04-11: Completed the first identity foundation slice.
  - Added D1 identity tables for `members` and `user_identities`.
  - Added a Clerk-backed membership bootstrap helper so first sign-in creates a household owner instead of attaching users to a shared default household.
  - Verified red/green with `bun test ./packages/db/src/identity.test.ts` and `bun run --cwd packages/db typecheck`.
- 2026-04-11: Completed the first web auth and protected-route slice.
  - Added Clerk React Router integration in the web app root with middleware, root loader state, and `/sign-in` plus `/sign-up` routes.
  - Protected `/`, `/portfolio`, `/accounts/review`, and `/connect/plaid` with authenticated household resolution.
  - Removed shared-household Plaid onboarding behavior so link token creation and public-token exchange now require the authenticated household ID.
  - Verified with `bun run lint`, `bun run typecheck`, and `bun run test`.
  - Manual browser verification was attempted via local dev at `http://127.0.0.1:5173/` and `http://localhost:5173/sign-in`, but blocked by a local Clerk handshake/JWKS mismatch from existing dev cookies rather than an app-code failure.

### Workstream status

- Workstream 1: Not started.
- Workstream 2: In progress.
- Workstream 3: Not started.
- Workstream 4: Not started.
- Workstream 5: Not started.
- Workstream 6: Not started.
- Workstream 7: Not started.

### Verification notes

- Automated verification currently passes for the identity and protected-route slices.
- Local browser verification of Clerk flows requires a clean Clerk dev session and matching local keys. The current machine/browser state produced Clerk handshake token verification failures before route rendering, so that step remains environment-blocked until local Clerk cookies or keys are reset.

## Non-goals

- Replacing Plaid with a different provider during this productionization pass.
- Reworking the product UI or navigation structure.
- Introducing additional Cloudflare products such as R2 or Queues unless a concrete production requirement appears during implementation.
- Building a full invite and household-sharing system beyond the minimum identity model required for a safe public launch.

## Inputs Already Decided

- `myzine.app` is already on Cloudflare.
- The app should run on the apex hostname `myzine.app`.
- The site should be publicly reachable on the internet.
- Clerk should be added now for app-level authentication.
- GitHub Actions CI/CD should be part of the productionization work.

## Current State Summary

### What already exists

- The web app is already deployed as a Cloudflare Worker entrypoint from `apps/web/workers/app.ts` with config in `apps/web/wrangler.jsonc`.
- The sync runtime already exists as a separate Cloudflare Worker with a cron trigger in `apps/sync/wrangler.jsonc`.
- Both apps already use Cloudflare D1 bindings and share the schema under `packages/db`.
- A quality-only CI workflow already exists in `.github/workflows/ci.yml`.
- Plaid onboarding and sync already run server-side in the existing codebase.

### Gaps that block a safe public launch

- `apps/web/wrangler.jsonc` and `apps/sync/wrangler.jsonc` are still effectively local or dev-only and use placeholder D1 IDs.
- There is no custom domain configuration for `myzine.app` yet.
- There is no deployed production environment model for the two Workers.
- The app does not yet have Clerk or another real authentication layer.
- The database schema currently has `households`, but no `members` or `user_identities` tables.
- User-facing queries still allow a fallback to the first household in the database when no household ID is provided.
- `apps/web/app/lib/plaid-connect.ts` still uses a shared default household bootstrap (`DEFAULT_HOUSEHOLD_ID` / `DEFAULT_HOUSEHOLD_NAME`), which is unsafe for a public multi-user app.
- Provider credentials are currently modeled as plaintext fields in D1 (`access_token`, `access_secret`) with no encryption layer.
- `.env.example` is out of sync with the actual runtime needs and does not document Plaid or Clerk local development configuration.
- There is no deployment workflow yet for production migrations and Worker deploys.

## Production Blockers

1. No authenticated identity boundary for public traffic.
2. Default-household behavior that could mix user data.
3. Plaintext provider token storage in D1.
4. No production Cloudflare resource bindings.
5. No automated production migration and deploy path.

## Target Production Architecture

- `myzine.app` points to the production web Worker through a Cloudflare Custom Domain.
- The web Worker serves the SSR app and requires a valid Clerk session for every finance route.
- Clerk owns authentication and session state.
- Vista owns app identity, household membership, and authorization state in D1.
- The sync Worker remains a separate Cloudflare Worker with cron scheduling and no public `workers.dev` surface in production.
- Both Workers bind to the same production D1 database.
- Provider secrets and app secrets are managed as Cloudflare secrets or environment variables, with sensitive values never committed to the repo.
- GitHub Actions runs verification, applies D1 migrations, and deploys the production Workers.

## Success Criteria

- `https://myzine.app` resolves to the production web Worker.
- Unauthenticated users are redirected to Clerk sign-in.
- Authenticated users only see their own household data.
- There is no code path that falls back to the first household in D1 for user-facing reads.
- Plaid onboarding stores provider credentials through an encryption layer, not plaintext.
- The sync Worker runs successfully against production D1 using production secrets.
- A merge to `main` can run migrations and deploy the production app without manual file edits.
- Operators have a basic rollback and smoke-test process.

## Workstream 1: Cloudflare Environment Model and Resource Provisioning

### Objective

Create a production Cloudflare shape that cleanly separates dev and prod for both Workers.

### Tasks

- Add explicit environment blocks to `apps/web/wrangler.jsonc` and `apps/sync/wrangler.jsonc`.
- Define production Worker names for the web and sync apps.
- Create a production D1 database and bind it in both Worker configs.
- Attach `myzine.app` to the production web Worker using a Custom Domain configuration.
- Set `workers_dev: false` for the sync Worker in production so it is not exposed publicly.
- Add `observability` and `upload_source_maps` where appropriate for production diagnostics.
- Standardize production scripts in `package.json` for remote D1 migration and deploy commands.

### Deliverables

- Updated Wrangler configs with `dev` and `prod` environments.
- A production D1 binding shared by web and sync.
- A production deployment command path that does not require editing config files by hand.

### Acceptance Criteria

- `wrangler deploy` can target production without editing JSONC files.
- `myzine.app` is managed through Cloudflare as the Worker origin.
- The sync Worker can run on cron without a public hostname.

## Workstream 2: Authentication and Identity Model

### Objective

Add Clerk authentication and replace the current implicit single-household assumptions with session-aware household ownership.

### Tasks

- Add Clerk packages compatible with React Router SSR and Cloudflare Workers.
- Add sign-in and sign-up routes for the web app.
- Wrap the app with the Clerk client provider in the root layout.
- Add server-side auth helpers so loaders and actions can read the authenticated user from the request.
- Add D1 tables for app-owned identity and membership, at minimum:
  - `members`
  - `user_identities`
- Decide and implement the minimum v1 onboarding model:
  - first authenticated user creates a household and becomes the owner member
  - additional household-sharing flows can be deferred
- Replace `DEFAULT_HOUSEHOLD_ID` bootstrap behavior in Plaid onboarding with authenticated household resolution.
- Protect all finance routes, including `/`, `/portfolio`, `/accounts/review`, and `/connect/plaid`.
- Ensure sign-out removes access immediately from authenticated loaders and actions.

### Deliverables

- Clerk-backed authentication in the web app.
- A D1-backed user-to-household mapping layer.
- Protected routes that require authentication.

### Acceptance Criteria

- Anonymous traffic cannot view financial data routes.
- A new authenticated user can sign in and get a household context.
- Plaid onboarding stores connections under the authenticated user's household, not a shared default household.

## Workstream 3: Provider Credential Security

### Objective

Remove plaintext provider credential storage before launch.

### Tasks

- Introduce a small server-only encryption utility for provider credentials.
- Add an encryption key secret, for example `PROVIDER_TOKEN_ENCRYPTION_KEY`.
- Add key-version support so rotation is possible later.
- Migrate `provider_connections` storage from plaintext credential writes to encrypted writes.
- Update the sync path to decrypt credentials only at runtime when Plaid calls are made.
- Decide whether existing local dev rows should be migrated or dropped during the schema change.

### Deliverables

- A new D1 migration for encrypted provider credential storage.
- Updated write paths in the web app and read paths in the sync worker.
- Secret documentation for credential encryption.

### Acceptance Criteria

- New provider credentials are not stored as plaintext in D1.
- Sync still succeeds using decrypted credentials at runtime.
- Production secrets are sufficient to rotate encryption keys later without redesigning the schema.

## Workstream 4: Route Safety and Data Access Hardening

### Objective

Make the application safe for multiple public users by removing implicit global database assumptions.

### Tasks

- Remove the "first household wins" fallback from user-facing query resolution.
- Require household context for home, portfolio, and account review queries.
- Thread authenticated household identity through loaders, actions, and database reads.
- Audit route actions that mutate state to ensure they authorize against the current member or household.
- Keep the sync worker able to process all households without coupling it to web session state.

### Deliverables

- Query helpers that require explicit household selection for user-facing routes.
- Route loaders and actions that are auth-aware.
- Regression tests for authorization boundaries.

### Acceptance Criteria

- User-facing routes cannot read data for another household by omission or malformed input.
- Existing home and portfolio views continue to work once a valid session and household are present.

## Workstream 5: CI/CD and Production Delivery

### Objective

Extend the existing quality workflow into an automated production deployment pipeline.

### Tasks

- Keep `.github/workflows/ci.yml` focused on lint, typecheck, test, and build.
- Add a production deploy workflow, for example `.github/workflows/deploy-prod.yml`.
- Configure GitHub Actions secrets for Cloudflare deploy access, at minimum:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- Run remote D1 migrations before deploying app code that depends on them.
- Deploy the web and sync Workers as separate jobs so failures are easier to isolate.
- Add workflow protections so production deploys only happen from `main`.
- Document manual recovery steps if migration or deploy fails mid-run.

### Deliverables

- A production deploy workflow in GitHub Actions.
- A migration-first deployment order.
- Deployment documentation for operators.

### Acceptance Criteria

- A push to `main` can migrate D1 and deploy the Workers without local CLI use.
- Failed deploy jobs do not leave the repo in an unknown release state.

## Workstream 6: Secrets, Config, and Local Development Hygiene

### Objective

Bring local docs and runtime configuration in line with the production architecture.

### Tasks

- Update `.env.example` to include Plaid and Clerk local development variables.
- Add or update repo docs for local Clerk and Plaid configuration.
- Add Wrangler `secrets.required` declarations where useful to validate deploy-time configuration.
- Separate safe public values from true secrets.
- Document the production secret matrix for web and sync.

### Deliverables

- A corrected `.env.example`.
- Clear documentation for local and production env variables.
- Fewer configuration surprises during first production deploy.

### Acceptance Criteria

- A new contributor can identify the local variables required for auth and Plaid.
- Production deploy validation fails fast if required secrets are missing.

## Workstream 7: Observability, Verification, and Rollout

### Objective

Make the first production launch observable and reversible.

### Tasks

- Enable Worker observability and source maps.
- Define a short smoke-test checklist for:
  - anonymous visit to `myzine.app`
  - sign-in flow
  - authenticated home page render
  - Plaid connect flow initialization
  - scheduled sync run
- Add lightweight post-deploy checks in CI or documented manual steps.
- Document rollback steps for web deploys, sync deploys, and failed migrations.

### Deliverables

- A launch checklist.
- Production log visibility in Cloudflare.
- A rollback procedure.

### Acceptance Criteria

- Operators can verify the production site immediately after deploy.
- Errors in the web or sync Worker can be located from Cloudflare logs without guesswork.

## File-Level Implementation Map

| Area | Planned changes |
| --- | --- |
| `apps/web/wrangler.jsonc` | Add `prod` environment, custom domain config for `myzine.app`, production D1 binding, vars and secret declarations, observability settings |
| `apps/sync/wrangler.jsonc` | Add `prod` environment, production D1 binding, secret declarations, and a non-public production surface |
| `package.json` | Add production migration and deploy scripts |
| `.env.example` | Add Plaid and Clerk local development variables |
| `.github/workflows/ci.yml` | Keep as quality gate, adjust only if needed for reusable jobs |
| `.github/workflows/deploy-prod.yml` | Add migration and deploy automation |
| `packages/db/src/schema.ts` | Add identity and encrypted credential schema |
| `packages/db/migrations/*` | Add migrations for identity tables and encrypted provider credentials |
| `apps/web/app/root.tsx` | Add Clerk client wiring and authenticated root behavior |
| `apps/web/app/routes.ts` | Add auth routes and protect application routes |
| `apps/web/app/lib/plaid-connect.ts` | Remove shared default household flow and write encrypted credentials |
| `apps/web/app/routes/*.tsx` | Require authenticated household context in loaders and actions |
| `apps/sync/src/index.ts` and related sync modules | Decrypt credentials at runtime and continue cron-based sync |

## Secret and Config Matrix

| Scope | Name | Type | Notes |
| --- | --- | --- | --- |
| Web Worker | `CLERK_PUBLISHABLE_KEY` | variable | Safe to expose to the client, but still managed explicitly |
| Web Worker | `CLERK_SECRET_KEY` | secret | Required for server-side auth validation |
| Web Worker | `COOKIE_ENCRYPTION_SECRET` | secret | Needed if server-managed cookies or encrypted session state are introduced |
| Web Worker | `PLAID_CLIENT_ID` | secret | Keep with other provider credentials |
| Web Worker | `PLAID_SECRET` | secret | Required for link token exchange and onboarding |
| Web Worker | `PLAID_ENV` | variable | `production` in prod |
| Web Worker | `PLAID_REDIRECT_URI` | variable | `https://myzine.app/connect/plaid` |
| Web Worker | `PROVIDER_TOKEN_ENCRYPTION_KEY` | secret | Used to encrypt provider credentials before D1 storage |
| Sync Worker | `PLAID_CLIENT_ID` | secret | Required for scheduled sync |
| Sync Worker | `PLAID_SECRET` | secret | Required for scheduled sync |
| Sync Worker | `PLAID_ENV` | variable | `production` in prod |
| Sync Worker | `PROVIDER_TOKEN_ENCRYPTION_KEY` | secret | Must match the key used for encrypted token storage |
| GitHub Actions | `CLOUDFLARE_API_TOKEN` | secret | Needed for deploy and migration jobs |
| GitHub Actions | `CLOUDFLARE_ACCOUNT_ID` | secret | Needed for deploy and migration jobs |

## Recommended Execution Order

1. Finalize the production environment and secret matrix.
2. Add D1 schema changes for identity and encrypted provider credentials.
3. Update Plaid onboarding and sync paths to use household-aware encrypted credential handling.
4. Add Clerk authentication, sign-in routes, and route protection.
5. Remove first-household fallbacks from user-facing data access.
6. Add production Wrangler environments and the `myzine.app` custom domain.
7. Add production scripts and GitHub Actions deploy automation.
8. Populate Cloudflare and Clerk secrets.
9. Run remote migrations, deploy to production, and execute the smoke-test checklist.

## Testing Plan

- Unit tests:
  - auth helper behavior
  - provider credential encryption and decryption
  - household resolution rules
- Integration tests:
  - first sign-in bootstrap
  - protected route redirects
  - Plaid connect writes to the authenticated household
  - sync reads encrypted credentials correctly
- Build checks:
  - `bun run lint`
  - `bun run typecheck`
  - `bun run test`
  - `bun run build`
- Launch smoke checks:
  - anonymous request redirects to sign-in
  - authenticated request renders the dashboard
  - Plaid link token creation succeeds in production
  - scheduled sync runs without credential errors

## Risks and Open Questions

- The current codebase is Plaid-only, while earlier blueprint material also discusses other providers. Productionization should stay focused on Plaid unless provider strategy changes separately.
- The product is intended for household data. The minimum v1 identity model should avoid overbuilding invites and collaboration, but the ownership model still needs to be explicit.
- Plaid coverage for Vanguard should be validated with a real production connection before launch, since infrastructure productionization alone does not guarantee the data source is good enough for actual use.
- If Clerk integration on Cloudflare Workers introduces framework-specific friction, the fallback is not to skip auth, but to adjust the integration approach while keeping the public-launch requirement intact.
- The sync Worker currently has a fetch handler used for local visibility. In production, decide whether to keep an internal-only health endpoint or rely exclusively on logs and cron telemetry.

## Recommendation

Treat authentication plus encrypted provider credential storage as the true critical path. Domain wiring and GitHub Actions deploys are straightforward once the app has a real user boundary, a production D1 binding, and a safe secret model.