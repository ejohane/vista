# Vista CLI Doctor

`vista doctor` runs local setup and health checks for the CLI.

## Usage

```sh
vista doctor
vista doctor --json
```

## Checks

Doctor reports `ok`, `warn`, and `fail` checks for:

- CLI config file
- configured SQLite database path
- local SQLite database file
- provider token encryption key
- provider connections
- Plaid credential presence
- local connection credential readiness
- latest sync result
- sync freshness
- local record counts

`vista doctor` does not call Plaid or Coinbase. Connection validation is local
only and matches `vista connections test <id>`.

## JSON

Use `--json` when another tool or LLM needs to parse the result.

The JSON payload includes:

- `schemaVersion`
- `generatedAt`
- `ok`
- `summary`
- `checks`

Each check has:

- `id`
- `label`
- `status`
- `detail`
- optional `suggestion`
