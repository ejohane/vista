# CLI Connections

Vista stores Plaid, HealthEquity, and Coinbase credentials as local provider
connections in the CLI SQLite database. Use the `connections` command to inspect
and manage those local records.

## Commands

```sh
vista connections
vista connections show <id>
vista connections test <id>
vista connections remove <id> --yes
```

`vista connections` lists all provider connections, including Plaid and
Coinbase. The table includes connection id, provider, institution/name, local
status, last successful sync, latest sync status, created time, and updated time.

`vista connections show <id>` prints one connection with detailed local sync and
data counts. Unknown ids fail with a clear `Connection not found` error.

`vista connections test <id>` performs local validation only. It verifies that
the local connection is active, has an external provider id, and has the
credentials Vista needs to sync. It does not call Plaid or Coinbase.

`vista connections remove <id> --yes` is a safe local disconnect. It clears the
stored access credentials and marks the connection `disconnected`, while leaving
synced accounts, holdings, transactions, and sync history in place.
