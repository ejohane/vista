# CLI Release Pipeline

The Vista CLI release flow is driven by Conventional Commit PR titles and
`semantic-release`.

## PR Requirements

PR titles must follow Conventional Commits, for example:

- `feat(cli): add recurring sync service`
- `fix(cli): handle missing release assets`
- `feat(cli)!: change local config format`

For merged PRs to produce semantic versions, GitHub should use squash merges and
the squash commit title should default to the PR title. Otherwise the merge
commit may not be machine-readable by `semantic-release`.

## Release Flow

On pushes to `main`, `.github/workflows/release.yml` runs the quality gate and
then runs `semantic-release`.

If conventional commits since the previous tag require a release,
`semantic-release`:

1. calculates the next SemVer version,
2. creates a `vX.Y.Z` tag,
3. builds CLI binaries with that version embedded,
4. creates a GitHub release,
5. uploads the CLI release assets and checksums.

## Release Assets

The release currently publishes:

- `install.sh`
- `vista-bun-darwin-arm64.tar.gz`
- `vista-bun-darwin-x64.tar.gz`
- `vista-bun-linux-arm64.tar.gz`
- `vista-bun-linux-x64-baseline.tar.gz`
- matching `.sha256` checksum files
- `manifest.json`

## Install Command

Install the latest Vista CLI release:

```sh
curl -fsSL https://github.com/ejohane/vista/releases/latest/download/install.sh | sh
```

The installer writes to `~/.local/bin/vista` by default. To install somewhere
else:

```sh
curl -fsSL https://github.com/ejohane/vista/releases/latest/download/install.sh | VISTA_INSTALL_DIR=/usr/local/bin sh
```

To install a specific version:

```sh
curl -fsSL https://github.com/ejohane/vista/releases/latest/download/install.sh | VISTA_VERSION=1.0.0 sh
```

If the repository or release assets are private, pass a GitHub token into both
the installer download and the installer process:

```sh
GITHUB_TOKEN="$(gh auth token)" sh -c 'curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" https://github.com/ejohane/vista/releases/latest/download/install.sh | sh'
```

## CLI Update Commands

The CLI exposes:

- `vista version`
- `vista version --check`
- `vista upgrade --check`
- `vista upgrade`
- `vista self-update`

Self-upgrade only works from a compiled release binary. It intentionally refuses
to replace `bun run cli` source executions.

If the repository or release assets are private, set `GITHUB_TOKEN` or `GH_TOKEN`
in the shell before running `vista version --check` or `vista upgrade`.

## Codex Skill

Install the bundled Vista CLI skill for local agents:

```sh
vista skill install
```

This writes `vista-cli/SKILL.md` under `$CODEX_HOME/skills` or
`~/.codex/skills`.

## Manual Income

Manual salary and bonus income are stored locally by person and source in the
CLI SQLite database:

```sh
vista income set --person "Erik" --source "Employer" --salary 150000 --bonus 25000 --effective-date 2026-05-01
vista income set --person "Partner" --source "Employer" --salary 120000
vista income show
vista income show --person "Erik"
vista income clear --person "Erik" --source "Employer"
```

## Coinbase

Create a view-only Coinbase Advanced Trade API key, save the downloaded key
JSON file, then connect it:

```sh
vista connect coinbase --api-key-file ~/Downloads/cdp_api_key.json
vista sync
vista accounts
vista holdings
```

Coinbase sync stores one local Coinbase investment account and crypto holdings
priced in USD when a `*-USD` Coinbase product is available.

## HealthEquity HSA

HealthEquity is connected through a balance-only Plaid profile. Plaid Balance is
not passed to Link directly; the CLI initializes the Item with `auth`, stores a
balance-only marker, and syncs `/accounts/get` without investment or transaction
endpoint calls:

```sh
vista connect healthequity
vista sync
vista accounts
```
