import { describe, expect, test } from "bun:test";

import {
  parseConnectHealthEquityArgs,
  parseConnectPlaidArgs,
} from "./connect-plaid";

describe("Plaid CLI connection args", () => {
  test("uses the default Plaid connection profile", () => {
    expect(parseConnectPlaidArgs(["--no-open"])).toMatchObject({
      connectionProfile: "default",
      openBrowser: false,
    });
  });

  test("uses the HealthEquity balance-only profile", () => {
    expect(
      parseConnectHealthEquityArgs(["--no-open", "--timeout-seconds", "30"]),
    ).toMatchObject({
      connectionProfile: "healthequity",
      openBrowser: false,
      timeoutSeconds: 30,
    });
  });
});
