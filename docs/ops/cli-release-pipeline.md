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

- `vista-bun-darwin-arm64.tar.gz`
- `vista-bun-darwin-x64.tar.gz`
- `vista-bun-linux-arm64.tar.gz`
- `vista-bun-linux-x64-baseline.tar.gz`
- matching `.sha256` checksum files
- `manifest.json`

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
