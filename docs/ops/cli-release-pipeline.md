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
