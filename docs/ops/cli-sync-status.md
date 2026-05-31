# CLI Sync Status

Vista stores provider sync attempts in the local SQLite `sync_runs` table. The
CLI exposes read-only operational commands for health checks and troubleshooting.

## Commands

```sh
vista status
vista sync runs
vista sync runs --limit 50
vista sync show <run-id>
```

`vista status` summarizes active provider connections, latest sync result, last
successful sync, last failed sync, active connections that have never synced,
active connections whose last successful sync is more than 24 hours old, and
high-level local record counts.

`vista sync runs` lists recent Plaid and Coinbase sync runs with run id,
provider, connection/institution, status, started/completed times, records
changed, and any error summary. The default limit is 20 and the maximum limit is
100.

`vista sync show <run-id>` prints one sync run in detail. Unknown ids fail with
a clear error.

## Compatibility

The existing sync command remains unchanged:

```sh
vista sync
vista sync --quiet
```

Use `vista sync` to perform ingestion. Use `vista status` and `vista sync runs`
to inspect the result afterward.
