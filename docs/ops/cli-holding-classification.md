# CLI Holding Classification

Vista stores provider holding classifications separately from local overrides.
Provider syncs continue to update `holdings.asset_class`; local CLI overrides live
in `holding_classification_overrides` and are applied by CLI holding reads.

## Commands

```sh
vista holdings
vista holdings show <id-or-symbol>
vista holdings classify <id-or-symbol> --asset-class cash|equity|fixed_income|crypto|fund|other
```

`vista holdings` prints each stable holding id. Use that id for follow-up
commands when a ticker appears in more than one account.

`vista holdings show <id-or-symbol>` prints account metadata, symbol, name,
current asset class, provider asset class, override asset class, latest
quantity/value, and timestamps.

`vista holdings classify` writes a local override. If a symbol matches multiple
holdings, Vista refuses to mutate anything and prints the matching holding ids.

## Sync Behavior

Provider syncs may keep changing the provider asset class in `holdings`, but the
CLI resolves the current class as:

```text
holding_classification_overrides.asset_class ?? holdings.asset_class
```

This keeps local classifications durable without hiding provider changes.
