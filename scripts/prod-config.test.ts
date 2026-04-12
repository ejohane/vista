import { describe, expect, test } from "bun:test";

import {
  materializeProdWranglerConfig,
  PROD_DATABASE_ID_PLACEHOLDER,
  PROD_PREVIEW_DATABASE_ID_PLACEHOLDER,
  resolveProdConfigValues,
} from "./prod-config";

describe("resolveProdConfigValues", () => {
  test("throws when the production database id is missing", () => {
    expect(() => resolveProdConfigValues({})).toThrow(
      "VISTA_PROD_D1_DATABASE_ID is required to generate production Wrangler config.",
    );
  });

  test("falls back the preview database id to the production id", () => {
    expect(
      resolveProdConfigValues({
        VISTA_PROD_D1_DATABASE_ID: "prod-db-id",
      }),
    ).toEqual({
      databaseId: "prod-db-id",
      previewDatabaseId: "prod-db-id",
    });
  });
});

describe("materializeProdWranglerConfig", () => {
  test("replaces both production database placeholders", () => {
    const source = JSON.stringify({
      database_id: PROD_DATABASE_ID_PLACEHOLDER,
      preview_database_id: PROD_PREVIEW_DATABASE_ID_PLACEHOLDER,
    });

    expect(
      materializeProdWranglerConfig(source, {
        databaseId: "prod-db-id",
        previewDatabaseId: "preview-db-id",
      }),
    ).toBe(
      '{"database_id":"prod-db-id","preview_database_id":"preview-db-id"}',
    );
  });
});
