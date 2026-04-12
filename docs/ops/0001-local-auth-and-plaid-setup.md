# Local Auth and Plaid Setup

## Local environment file

Create `.env.local` at the repo root from `.env.example`.

Required values for the authenticated local app:

| Name | Purpose |
| --- | --- |
| `CLERK_PUBLISHABLE_KEY` | Browser-facing Clerk key used by the React Router app |
| `CLERK_SECRET_KEY` | Server-side Clerk validation key for loaders and actions |
| `PLAID_CLIENT_ID` | Plaid API client id for onboarding and sync |
| `PLAID_SECRET` | Plaid API secret for onboarding and sync |
| `PLAID_ENV` | Usually `sandbox` for local development |
| `PROVIDER_TOKEN_ENCRYPTION_KEY` | Base64url-encoded 32-byte AES-GCM key for provider credential storage |

Optional values:

| Name | Purpose |
| --- | --- |
| `PLAID_REDIRECT_URI` | Required when testing Plaid OAuth institutions locally |
| `VISTA_DEV_HOST` | Override the local bind host |
| `VISTA_WEB_PORT` | Override the web port |
| `VISTA_SYNC_PORT` | Override the sync port |
| `VISTA_SKIP_SEED` | Skip local seed behavior when set to `1` |

## Starting the stack

Use the repo root so the web worker, sync worker, and local D1 state stay aligned:

```bash
bun install
bun run dev
```

Use `bun run dev:worktree` from a secondary git worktree so ports, `.env.local`, and Wrangler state stay isolated.

## Plaid OAuth locally

If you test an OAuth-based institution locally, `PLAID_REDIRECT_URI` must be `https` and point at a non-privileged port. The dev tooling will start the HTTPS proxy automatically when the redirect URI uses a tailnet hostname ending in `.ts.net`.

Example:

```bash
PLAID_REDIRECT_URI=https://vista-dev.ts.net:8443/connect/plaid
```

## Generating the encryption key

The provider encryption key must decode to exactly 32 bytes. One portable way to generate it is:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

## Common local failures

- Clerk handshake or JWKS errors usually mean the browser has stale dev cookies or the local keys do not match the current Clerk instance.
- Plaid onboarding errors usually mean one of `PLAID_CLIENT_ID`, `PLAID_SECRET`, or `PROVIDER_TOKEN_ENCRYPTION_KEY` is missing.
- Production-only deploy scripts need `VISTA_PROD_D1_DATABASE_ID`; local dev does not.