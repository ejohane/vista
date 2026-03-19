import {
  createSnaptradePortalClient,
  type SnaptradePortalClient,
} from "@vista/snaptrade";

const DEFAULT_HOUSEHOLD_ID = "household_default";
const DEFAULT_HOUSEHOLD_NAME = "Vista Household";

type BeginSnaptradeConnectionArgs = {
  client?: SnaptradePortalClient;
  clientFactory?: (config: {
    clientId: string;
    consumerKey: string;
  }) => SnaptradePortalClient;
  clientId?: string;
  consumerKey?: string;
  database: D1Database;
  draftIdFactory?: () => string;
  now?: Date;
  redirectUrl: string;
};

type CompleteSnaptradeConnectionArgs = {
  callbackConnectionId: string;
  client?: SnaptradePortalClient;
  clientFactory?: (config: {
    clientId: string;
    consumerKey: string;
  }) => SnaptradePortalClient;
  clientId?: string;
  connectionDraftId: string;
  consumerKey?: string;
  database: D1Database;
  now?: Date;
};

type HouseholdRow = {
  id: string;
};

type SnaptradeSecretRow = {
  accessSecret: string;
};

type PendingDraftRow = {
  accessSecret: string;
  householdId: string;
  id: string;
};

type ExistingConnectionRow = {
  id: string;
};

export type BegunSnaptradeConnection = {
  connectionDraftId: string;
  householdId: string;
  householdWasCreated: boolean;
  redirectUri: string;
};

export type CompletedSnaptradeConnection = {
  brokerageName: null | string;
  connectionId: string;
  householdId: string;
  status: "active" | "disconnected";
};

async function ensureHousehold(database: D1Database, now: Date) {
  const existingHousehold = await database
    .prepare(
      `
        select id
        from households
        order by created_at asc
        limit 1
      `,
    )
    .first<HouseholdRow>();

  if (existingHousehold) {
    return {
      householdId: existingHousehold.id,
      householdWasCreated: false,
    };
  }

  await database
    .prepare(
      `
        insert into households (id, name, last_synced_at, created_at)
        values (?, ?, ?, ?)
      `,
    )
    .bind(
      DEFAULT_HOUSEHOLD_ID,
      DEFAULT_HOUSEHOLD_NAME,
      now.getTime(),
      now.getTime(),
    )
    .run();

  return {
    householdId: DEFAULT_HOUSEHOLD_ID,
    householdWasCreated: true,
  };
}

function resolvePortalClient(args: {
  client?: SnaptradePortalClient;
  clientFactory?: (config: {
    clientId: string;
    consumerKey: string;
  }) => SnaptradePortalClient;
  clientId?: string;
  consumerKey?: string;
}) {
  return (
    args.client ??
    (args.clientId && args.consumerKey
      ? (args.clientFactory ?? createSnaptradePortalClient)({
          clientId: args.clientId,
          consumerKey: args.consumerKey,
        })
      : null)
  );
}

async function loadLatestSnaptradeSecret(
  database: D1Database,
  householdId: string,
) {
  return database
    .prepare(
      `
        select access_secret as accessSecret
        from provider_connections
        where household_id = ?
          and provider = ?
          and access_secret is not null
        order by updated_at desc
        limit 1
      `,
    )
    .bind(householdId, "snaptrade")
    .first<SnaptradeSecretRow>();
}

function buildDraftConnectionId(draftToken: string) {
  return `conn:snaptrade:draft:${draftToken}`;
}

function buildPendingExternalConnectionId(draftToken: string) {
  return `pending:${draftToken}`;
}

export async function beginSnaptradeConnection(
  args: BeginSnaptradeConnectionArgs,
): Promise<BegunSnaptradeConnection> {
  const now = args.now ?? new Date();
  const client = resolvePortalClient(args);

  if (!client) {
    throw new Error("SnapTrade client configuration is required.");
  }

  const { householdId, householdWasCreated } = await ensureHousehold(
    args.database,
    now,
  );
  const existingSecret = await loadLatestSnaptradeSecret(
    args.database,
    householdId,
  );
  const userSecret =
    existingSecret?.accessSecret ??
    (
      await client.registerSnapTradeUser({
        userId: householdId,
      })
    ).userSecret;
  const draftToken = args.draftIdFactory?.() ?? crypto.randomUUID();
  const connectionDraftId = buildDraftConnectionId(draftToken);
  const callbackUrl = new URL(args.redirectUrl);

  callbackUrl.searchParams.set("draftConnectionId", connectionDraftId);

  await args.database
    .prepare(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          access_secret,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      connectionDraftId,
      householdId,
      "snaptrade",
      "disconnected",
      buildPendingExternalConnectionId(draftToken),
      userSecret,
      now.getTime(),
      now.getTime(),
    )
    .run();

  const loginResult = await client.loginSnapTradeUser({
    connectionPortalVersion: "v4",
    connectionType: "read",
    customRedirect: callbackUrl.toString(),
    immediateRedirect: true,
    userId: householdId,
    userSecret,
  });

  return {
    connectionDraftId,
    householdId,
    householdWasCreated,
    redirectUri: loginResult.redirectUri,
  };
}

async function loadPendingDraft(
  database: D1Database,
  connectionDraftId: string,
) {
  return database
    .prepare(
      `
        select
          id,
          household_id as householdId,
          access_secret as accessSecret
        from provider_connections
        where id = ?
          and provider = ?
          and external_connection_id like ?
          and access_secret is not null
        limit 1
      `,
    )
    .bind(connectionDraftId, "snaptrade", "pending:%")
    .first<PendingDraftRow>();
}

async function loadExistingConnection(
  database: D1Database,
  externalConnectionId: string,
) {
  return database
    .prepare(
      `
        select id
        from provider_connections
        where provider = ?
          and external_connection_id = ?
        limit 1
      `,
    )
    .bind("snaptrade", externalConnectionId)
    .first<ExistingConnectionRow>();
}

export async function completeSnaptradeConnection(
  args: CompleteSnaptradeConnectionArgs,
): Promise<CompletedSnaptradeConnection> {
  const now = args.now ?? new Date();
  const client = resolvePortalClient(args);

  if (!client) {
    throw new Error("SnapTrade client configuration is required.");
  }

  const draft = await loadPendingDraft(args.database, args.connectionDraftId);

  if (!draft) {
    throw new Error(
      `SnapTrade draft connection ${args.connectionDraftId} could not be found.`,
    );
  }

  const brokerageAuthorizations = await client.listBrokerageAuthorizations({
    userId: draft.householdId,
    userSecret: draft.accessSecret,
  });
  const connectedAuthorization = brokerageAuthorizations.find(
    (authorization) => authorization.id === args.callbackConnectionId,
  );

  if (!connectedAuthorization?.id) {
    throw new Error(
      `SnapTrade did not return connection ${args.callbackConnectionId} for draft ${args.connectionDraftId}.`,
    );
  }

  const nextStatus = connectedAuthorization.disabled
    ? "disconnected"
    : "active";
  const existingConnection = await loadExistingConnection(
    args.database,
    connectedAuthorization.id,
  );

  if (existingConnection && existingConnection.id !== draft.id) {
    await args.database.batch([
      args.database
        .prepare(
          `
            update provider_connections
            set household_id = ?,
                status = ?,
                access_secret = ?,
                updated_at = ?
            where id = ?
          `,
        )
        .bind(
          draft.householdId,
          nextStatus,
          draft.accessSecret,
          now.getTime(),
          existingConnection.id,
        ),
      args.database
        .prepare(
          `
            delete from provider_connections
            where id = ?
          `,
        )
        .bind(draft.id),
    ]);

    return {
      brokerageName:
        connectedAuthorization.brokerage?.display_name ??
        connectedAuthorization.brokerage?.name ??
        null,
      connectionId: existingConnection.id,
      householdId: draft.householdId,
      status: nextStatus,
    };
  }

  await args.database
    .prepare(
      `
        update provider_connections
        set external_connection_id = ?,
            status = ?,
            access_secret = ?,
            updated_at = ?
        where id = ?
      `,
    )
    .bind(
      connectedAuthorization.id,
      nextStatus,
      draft.accessSecret,
      now.getTime(),
      draft.id,
    )
    .run();

  return {
    brokerageName:
      connectedAuthorization.brokerage?.display_name ??
      connectedAuthorization.brokerage?.name ??
      null,
    connectionId: draft.id,
    householdId: draft.householdId,
    status: nextStatus,
  };
}
