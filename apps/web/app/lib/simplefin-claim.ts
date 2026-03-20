const DEFAULT_HOUSEHOLD_ID = "household_default";
const DEFAULT_HOUSEHOLD_NAME = "Vista Household";

type ClaimSimplefinSetupTokenArgs = {
  database: D1Database;
  fetchImpl?: typeof fetch;
  now?: Date;
  setupToken: string;
};

type HouseholdRow = {
  id: string;
};

export type ClaimedSimplefinConnection = {
  connectionId: string;
  householdId: string;
  householdWasCreated: boolean;
};

function decodeSetupToken(setupToken: string) {
  const normalizedToken = setupToken.trim().replaceAll(/\s+/g, "");

  if (!normalizedToken) {
    throw new Error("Paste a SimpleFIN setup token before submitting.");
  }

  let decodedValue: string;

  try {
    decodedValue = atob(normalizedToken);
  } catch {
    throw new Error("SimpleFIN setup token is not valid base64.");
  }

  let claimUrl: URL;

  try {
    claimUrl = new URL(decodedValue);
  } catch {
    throw new Error("SimpleFIN setup token did not decode to a valid URL.");
  }

  if (claimUrl.protocol !== "https:") {
    throw new Error("SimpleFIN setup tokens must decode to an HTTPS URL.");
  }

  return claimUrl;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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

function validateAccessUrl(accessUrlValue: string) {
  let accessUrl: URL;

  try {
    accessUrl = new URL(accessUrlValue);
  } catch {
    throw new Error("SimpleFIN claim succeeded but returned an invalid URL.");
  }

  if (accessUrl.protocol !== "https:") {
    throw new Error("SimpleFIN access URLs must use HTTPS.");
  }

  if (!accessUrl.username || !accessUrl.password) {
    throw new Error(
      "SimpleFIN claim succeeded but the access URL is missing credentials.",
    );
  }

  return accessUrl.toString();
}

export async function claimSimplefinSetupToken(
  args: ClaimSimplefinSetupTokenArgs,
): Promise<ClaimedSimplefinConnection> {
  const now = args.now ?? new Date();
  const fetchImpl = args.fetchImpl ?? fetch;
  const claimUrl = decodeSetupToken(args.setupToken);
  const claimResponse = await fetchImpl(claimUrl.toString(), {
    method: "POST",
  });

  if (!claimResponse.ok) {
    throw new Error(`SimpleFIN claim returned ${claimResponse.status}.`);
  }

  const accessUrl = validateAccessUrl((await claimResponse.text()).trim());
  const { householdId, householdWasCreated } = await ensureHousehold(
    args.database,
    now,
  );
  const externalConnectionId = `claim:${await sha256Hex(claimUrl.toString())}`;
  const connectionId = `conn:simplefin:${externalConnectionId}`;

  await args.database
    .prepare(
      `
        insert into provider_connections (
          id,
          household_id,
          provider,
          status,
          external_connection_id,
          access_url,
          created_at,
          updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(provider, external_connection_id) do update set
          household_id = excluded.household_id,
          status = excluded.status,
          access_url = excluded.access_url,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      connectionId,
      householdId,
      "simplefin",
      "active",
      externalConnectionId,
      accessUrl,
      now.getTime(),
      now.getTime(),
    )
    .run();

  return {
    connectionId,
    householdId,
    householdWasCreated,
  };
}
