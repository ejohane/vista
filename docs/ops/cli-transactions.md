# CLI Transactions

Vista treats transactions as a local queryable resource. Bank transactions can
also be safely excluded from, or included in, reporting when the local schema has
`exclude_from_reporting`.

## List

```sh
vista transactions [--limit 25] [--account <id-or-name>] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--kind bank|investment]
```

Filters can be combined. `--account` first matches a stable account id. If no id
matches, it matches exact account names/display names case-insensitively and
fails if the name is ambiguous.

List output includes a stable transaction id such as `bank-1234abcd` or
`inv-1234abcd`. Use that id with `show`, `exclude`, or `include`.

## Show

```sh
vista transactions show <id>
```

`<id>` can be the list id, the full local transaction id, or the provider
transaction id. `show` supports both bank and investment transactions.

## Reporting Overrides

```sh
vista transactions exclude <id>
vista transactions include <id>
```

Reporting overrides only apply to bank transactions. Investment transactions do
not currently have a reporting override column, so Vista rejects those mutations
with a clear error instead of changing unrelated data.
