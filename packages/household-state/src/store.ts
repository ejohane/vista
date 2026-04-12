import {
  createD1HouseholdService,
  exportHouseholdState,
  getDb,
  type HouseholdStateExport,
  ingestFixtureSyncBatch,
  type ProviderConnectionStatus,
  type ProviderType,
  type UpdateAccountCurationArgs,
  updateAccountCuration,
} from "@vista/db";
import {
  type PlaidClient,
  syncPlaidConnection as syncLocalPlaidConnection,
} from "@vista/plaid";

import { ensureHouseholdStateSchema } from "./d1-database";

async function importHousehold(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  await database
    .prepare(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          last_synced_at = excluded.last_synced_at,
          created_at = excluded.created_at
      `,
    )
    .bind(
      snapshot.household.id,
      snapshot.household.name,
      snapshot.household.lastSyncedAt.getTime(),
      snapshot.household.createdAt.getTime(),
    )
    .run();
}

async function importProviderConnections(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  for (const connection of snapshot.providerConnections) {
    await database
      .prepare(
        `
          insert into provider_connections (
            id,
            household_id,
            provider,
            status,
            external_connection_id,
            access_token,
            access_secret,
            access_url,
            plaid_item_id,
            institution_id,
            institution_name,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            household_id = excluded.household_id,
            provider = excluded.provider,
            status = excluded.status,
            external_connection_id = excluded.external_connection_id,
            access_token = excluded.access_token,
            access_secret = excluded.access_secret,
            access_url = excluded.access_url,
            plaid_item_id = excluded.plaid_item_id,
            institution_id = excluded.institution_id,
            institution_name = excluded.institution_name,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        connection.id,
        connection.householdId,
        connection.provider,
        connection.status,
        connection.externalConnectionId,
        connection.accessToken,
        connection.accessSecret,
        connection.accessUrl,
        connection.plaidItemId,
        connection.institutionId,
        connection.institutionName,
        connection.createdAt.getTime(),
        connection.updatedAt.getTime(),
      )
      .run();
  }
}

async function importProviderAccounts(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  for (const providerAccount of snapshot.providerAccounts) {
    await database
      .prepare(
        `
          insert into provider_accounts (
            id,
            provider_connection_id,
            provider_account_id,
            name,
            institution_name,
            account_type,
            account_subtype,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            provider_connection_id = excluded.provider_connection_id,
            provider_account_id = excluded.provider_account_id,
            name = excluded.name,
            institution_name = excluded.institution_name,
            account_type = excluded.account_type,
            account_subtype = excluded.account_subtype,
            currency = excluded.currency,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        providerAccount.id,
        providerAccount.providerConnectionId,
        providerAccount.providerAccountId,
        providerAccount.name,
        providerAccount.institutionName,
        providerAccount.accountType,
        providerAccount.accountSubtype,
        providerAccount.currency,
        providerAccount.createdAt.getTime(),
        providerAccount.updatedAt.getTime(),
      )
      .run();
  }
}

async function importAccounts(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  for (const account of snapshot.accounts) {
    await database
      .prepare(
        `
          insert into accounts (
            id,
            household_id,
            provider_account_id,
            name,
            display_name,
            institution_name,
            account_type,
            account_subtype,
            reporting_group,
            ownership_type,
            include_in_household_reporting,
            is_hidden,
            balance_minor,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            household_id = excluded.household_id,
            provider_account_id = excluded.provider_account_id,
            name = excluded.name,
            display_name = excluded.display_name,
            institution_name = excluded.institution_name,
            account_type = excluded.account_type,
            account_subtype = excluded.account_subtype,
            reporting_group = excluded.reporting_group,
            ownership_type = excluded.ownership_type,
            include_in_household_reporting = excluded.include_in_household_reporting,
            is_hidden = excluded.is_hidden,
            balance_minor = excluded.balance_minor,
            currency = excluded.currency,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        account.id,
        account.householdId,
        account.providerAccountId,
        account.name,
        account.displayName,
        account.institutionName,
        account.accountType,
        account.accountSubtype,
        account.reportingGroup,
        account.ownershipType,
        account.includeInHouseholdReporting,
        account.isHidden,
        account.balanceMinor,
        account.currency,
        account.createdAt.getTime(),
        account.updatedAt.getTime(),
      )
      .run();
  }
}

async function importSyncRuns(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  for (const run of snapshot.syncRuns) {
    await database
      .prepare(
        `
          insert into sync_runs (
            id,
            household_id,
            provider_connection_id,
            provider,
            status,
            trigger,
            started_at,
            completed_at,
            records_changed,
            error_summary
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            household_id = excluded.household_id,
            provider_connection_id = excluded.provider_connection_id,
            provider = excluded.provider,
            status = excluded.status,
            trigger = excluded.trigger,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            records_changed = excluded.records_changed,
            error_summary = excluded.error_summary
        `,
      )
      .bind(
        run.id,
        run.householdId,
        run.providerConnectionId,
        run.provider,
        run.status,
        run.trigger,
        run.startedAt.getTime(),
        run.completedAt?.getTime() ?? null,
        run.recordsChanged,
        run.errorSummary,
      )
      .run();
  }
}

async function importBalanceSnapshots(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  for (const balanceSnapshot of snapshot.balanceSnapshots) {
    await database
      .prepare(
        `
          insert into balance_snapshots (
            id,
            account_id,
            source_sync_run_id,
            captured_at,
            as_of_date,
            balance_minor
          )
          values (?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            account_id = excluded.account_id,
            source_sync_run_id = excluded.source_sync_run_id,
            captured_at = excluded.captured_at,
            as_of_date = excluded.as_of_date,
            balance_minor = excluded.balance_minor
        `,
      )
      .bind(
        balanceSnapshot.id,
        balanceSnapshot.accountId,
        balanceSnapshot.sourceSyncRunId,
        balanceSnapshot.capturedAt.getTime(),
        balanceSnapshot.asOfDate,
        balanceSnapshot.balanceMinor,
      )
      .run();
  }
}

async function importHoldings(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  for (const holding of snapshot.holdings) {
    await database
      .prepare(
        `
          insert into holdings (
            id,
            account_id,
            holding_key,
            symbol,
            name,
            security_id,
            asset_class,
            sub_asset_class,
            currency,
            created_at,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            account_id = excluded.account_id,
            holding_key = excluded.holding_key,
            symbol = excluded.symbol,
            name = excluded.name,
            security_id = excluded.security_id,
            asset_class = excluded.asset_class,
            sub_asset_class = excluded.sub_asset_class,
            currency = excluded.currency,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `,
      )
      .bind(
        holding.id,
        holding.accountId,
        holding.holdingKey,
        holding.symbol,
        holding.name,
        holding.securityId,
        holding.assetClass,
        holding.subAssetClass,
        holding.currency,
        holding.createdAt.getTime(),
        holding.updatedAt.getTime(),
      )
      .run();
  }
}

async function importHoldingSnapshots(
  database: D1Database,
  snapshot: HouseholdStateExport,
) {
  for (const holdingSnapshot of snapshot.holdingSnapshots) {
    await database
      .prepare(
        `
          insert into holding_snapshots (
            id,
            holding_id,
            account_id,
            source_sync_run_id,
            captured_at,
            as_of_date,
            quantity,
            price_minor,
            market_value_minor,
            cost_basis_minor
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(id) do update set
            holding_id = excluded.holding_id,
            account_id = excluded.account_id,
            source_sync_run_id = excluded.source_sync_run_id,
            captured_at = excluded.captured_at,
            as_of_date = excluded.as_of_date,
            quantity = excluded.quantity,
            price_minor = excluded.price_minor,
            market_value_minor = excluded.market_value_minor,
            cost_basis_minor = excluded.cost_basis_minor
        `,
      )
      .bind(
        holdingSnapshot.id,
        holdingSnapshot.holdingId,
        holdingSnapshot.accountId,
        holdingSnapshot.sourceSyncRunId,
        holdingSnapshot.capturedAt.getTime(),
        holdingSnapshot.asOfDate,
        holdingSnapshot.quantity,
        holdingSnapshot.priceMinor,
        holdingSnapshot.marketValueMinor,
        holdingSnapshot.costBasisMinor,
      )
      .run();
  }
}

export function createHouseholdStateStore(database: D1Database) {
  void ensureHouseholdStateSchema(database);

  const service = createD1HouseholdService(getDb(database));

  return {
    async createProviderConnection(args: {
      accessSecret?: null | string;
      accessToken?: null | string;
      accessUrl?: null | string;
      createdAt?: Date;
      externalConnectionId: string;
      householdId: string;
      id: string;
      institutionId?: null | string;
      institutionName?: null | string;
      plaidItemId?: null | string;
      provider: ProviderType;
      status: ProviderConnectionStatus;
      updatedAt?: Date;
    }) {
      const createdAt = args.createdAt ?? new Date();
      const updatedAt = args.updatedAt ?? createdAt;

      await database
        .prepare(
          `
            insert into provider_connections (
              id,
              household_id,
              provider,
              status,
              external_connection_id,
              access_token,
              access_secret,
              access_url,
              plaid_item_id,
              institution_id,
              institution_name,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(id) do update set
              household_id = excluded.household_id,
              provider = excluded.provider,
              status = excluded.status,
              external_connection_id = excluded.external_connection_id,
              access_token = excluded.access_token,
              access_secret = excluded.access_secret,
              access_url = excluded.access_url,
              plaid_item_id = excluded.plaid_item_id,
              institution_id = excluded.institution_id,
              institution_name = excluded.institution_name,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
        )
        .bind(
          args.id,
          args.householdId,
          args.provider,
          args.status,
          args.externalConnectionId,
          args.accessToken ?? null,
          args.accessSecret ?? null,
          args.accessUrl ?? null,
          args.plaidItemId ?? null,
          args.institutionId ?? null,
          args.institutionName ?? null,
          createdAt.getTime(),
          updatedAt.getTime(),
        )
        .run();

      return {
        connectionId: args.id,
      };
    },

    exportHouseholdState(householdId: string) {
      return exportHouseholdState(database, householdId);
    },

    getAccountCurationSnapshot(householdId: string) {
      return service.getAccountCurationSnapshot(householdId);
    },

    getDashboardSnapshot(householdId: string) {
      return service.getDashboardSnapshot(householdId);
    },

    getHomepageSnapshot(householdId: string) {
      return service.getHomepageSnapshot(householdId);
    },

    getPortfolioSnapshot(householdId: string) {
      return service.getPortfolioSnapshot(householdId);
    },

    async importHouseholdState(snapshot: HouseholdStateExport) {
      await importHousehold(database, snapshot);
      await importProviderConnections(database, snapshot);
      await importProviderAccounts(database, snapshot);
      await importAccounts(database, snapshot);
      await importSyncRuns(database, snapshot);
      await importBalanceSnapshots(database, snapshot);
      await importHoldings(database, snapshot);
      await importHoldingSnapshots(database, snapshot);
    },

    ingestFixtureSyncBatch(
      batch: Parameters<typeof ingestFixtureSyncBatch>[1],
    ) {
      return ingestFixtureSyncBatch(database, batch);
    },

    async provisionHousehold(args: {
      createdAt?: Date;
      householdId: string;
      householdName: string;
      lastSyncedAt?: Date;
    }) {
      const createdAt = args.createdAt ?? new Date();
      const lastSyncedAt = args.lastSyncedAt ?? createdAt;

      await database
        .prepare(
          `
            insert into households (id, name, last_synced_at, created_at)
            values (?, ?, ?, ?)
            on conflict(id) do update set
              name = excluded.name,
              last_synced_at = excluded.last_synced_at,
              created_at = excluded.created_at
          `,
        )
        .bind(
          args.householdId,
          args.householdName,
          lastSyncedAt.getTime(),
          createdAt.getTime(),
        )
        .run();

      return {
        householdId: args.householdId,
      };
    },

    syncPlaidConnection(args: {
      client?: PlaidClient;
      clientFactory?: (config: {
        clientId: string;
        environment?: "development" | "production" | "sandbox";
        secret: string;
      }) => PlaidClient;
      clientId?: string;
      connectionId: string;
      environment?: "development" | "production" | "sandbox";
      now?: Date;
      secret?: string;
    }) {
      return syncLocalPlaidConnection({
        ...args,
        database,
      });
    },

    updateAccountCuration(args: UpdateAccountCurationArgs) {
      return updateAccountCuration(getDb(database), args);
    },
  };
}
