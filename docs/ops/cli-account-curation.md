# CLI Account Curation

Vista stores provider-imported accounts locally. The account curation commands update local account metadata without changing provider credentials or upstream account data.

## Commands

```sh
vista accounts
vista accounts show <id>
vista accounts rename <id> "Display Name"
vista accounts rename <id> --clear
vista accounts hide <id>
vista accounts unhide <id>
vista accounts include <id>
vista accounts exclude <id>
vista accounts owner <id> --owner mine|wife|joint
```

## Semantics

- `show` prints account metadata, provider linkage, inclusion, hidden state, and ownership.
- `rename` sets the local display name. Use `rename <id> --clear` to remove the local display name and fall back to the provider account name.
- `hide` keeps the account in the local database but marks it hidden. Hidden accounts are omitted from dashboard and account-list totals.
- `exclude` keeps the account visible but removes it from household reporting totals.
- `owner` updates the existing local ownership label. Supported values are `mine`, `wife`, and `joint`.

Unknown account IDs fail with `Account not found: <id>` and do not update any account.
