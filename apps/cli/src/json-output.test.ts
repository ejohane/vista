import { describe, expect, test } from "bun:test";

import { type AccountRow, toAccountsJson } from "./accounts";
import { toDashboardJson } from "./dashboard";
import { type HoldingRow, toHoldingsJson } from "./holdings";
import {
  type IncomeProfileRow,
  parseIncomeArgs,
  toIncomeProfilesJson,
} from "./income";
import {
  parseTransactionArgs,
  type TransactionRow,
  toTransactionsJson,
} from "./transactions";

function roundTripJson(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

describe("CLI JSON output", () => {
  test("builds dashboard JSON with ISO timestamps and minor-unit totals", () => {
    expect(
      roundTripJson(
        toDashboardJson({
          connections: [
            {
              institutionName: "Demo Bank",
              lastCompletedSyncAt: 1_767_225_600_000,
              status: "active",
            },
          ],
          summary: {
            accountCount: 2,
            bankTransactionCount: 4,
            cashMinor: 10_000,
            connectionCount: 1,
            holdingCount: 3,
            investmentTransactionCount: 5,
            investmentsMinor: 25_000,
            lastCompletedSyncAt: 1_767_225_600_000,
            lastFailedSyncAt: null,
            liabilitiesMinor: -1_000,
          },
        }),
      ),
    ).toMatchObject({
      connections: [
        {
          lastCompletedSyncAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      schemaVersion: 1,
      summary: {
        cashMinor: 10_000,
        currency: "USD",
        lastCompletedSyncAt: "2026-01-01T00:00:00.000Z",
        lastFailedSyncAt: null,
        netWorthMinor: 34_000,
      },
    });
  });

  test("builds accounts JSON with boolean flags and group totals", () => {
    const accounts: AccountRow[] = [
      {
        accountSubtype: "checking",
        accountType: "checking",
        balanceMinor: 12_500,
        currency: "USD",
        displayName: "Bills",
        id: "acct_cash",
        includeInHouseholdReporting: 1,
        institutionName: "Demo Bank",
        isHidden: 0,
        name: "Checking",
        reportingGroup: "cash",
        updatedAt: 1_767_225_600_000,
      },
      {
        accountSubtype: null,
        accountType: "brokerage",
        balanceMinor: 50_000,
        currency: "USD",
        displayName: null,
        id: "acct_hidden",
        includeInHouseholdReporting: 1,
        institutionName: "Broker",
        isHidden: 1,
        name: "Hidden",
        reportingGroup: "investments",
        updatedAt: 1_767_225_600_000,
      },
    ];

    expect(roundTripJson(toAccountsJson(accounts))).toMatchObject({
      accounts: [
        {
          id: "acct_cash",
          includeInHouseholdReporting: true,
          isHidden: false,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          id: "acct_hidden",
          isHidden: true,
        },
      ],
      schemaVersion: 1,
      totals: {
        cashMinor: 12_500,
        currency: "USD",
        investmentsMinor: 0,
        netWorthMinor: 12_500,
      },
    });
  });

  test("builds holdings JSON with minor-unit market totals", () => {
    const holdings: HoldingRow[] = [
      {
        accountName: "Brokerage",
        assetClass: "equity",
        costBasisMinor: 8_000,
        currency: "USD",
        id: "holding_vti",
        marketValueMinor: 10_000,
        name: "Total Market",
        priceMinor: 25_00,
        quantity: "4",
        symbol: "VTI",
      },
    ];

    expect(roundTripJson(toHoldingsJson(holdings))).toEqual({
      holdings: [
        {
          accountName: "Brokerage",
          assetClass: "equity",
          costBasisMinor: 8_000,
          currency: "USD",
          id: "holding_vti",
          marketValueMinor: 10_000,
          name: "Total Market",
          priceMinor: 25_00,
          quantity: "4",
          symbol: "VTI",
        },
      ],
      schemaVersion: 1,
      totals: {
        costBasisMinor: 8_000,
        currency: "USD",
        marketValueMinor: 10_000,
      },
    });
  });

  test("parses and builds transactions JSON with limit metadata", () => {
    const options = parseTransactionArgs(["--json", "--limit", "1"]);
    const transactions: TransactionRow[] = [
      {
        accountName: "Checking",
        amountMinor: -1_234,
        currency: "USD",
        description: "Coffee",
        kind: "bank",
        postedDate: "2026-05-30",
        quantity: null,
        subtype: "food_and_drink",
        symbol: null,
        type: "debit",
      },
    ];

    expect(options).toEqual({ json: true, limit: 1 });
    expect(roundTripJson(toTransactionsJson(transactions, options))).toEqual({
      count: 1,
      limit: 1,
      schemaVersion: 1,
      transactions: transactions,
    });
  });

  test("parses and builds income JSON filtered by person", () => {
    const command = parseIncomeArgs(["show", "--person", "Erik", "--json"]);
    const profiles: IncomeProfileRow[] = [
      {
        bonusMinor: 2_500_000,
        currency: "USD",
        effectiveDate: "2026-05-01",
        id: "income_demo",
        note: null,
        personName: "Erik",
        salaryMinor: 15_000_000,
        source: "Employer",
        updatedAt: 1_767_225_600_000,
      },
    ];

    expect(command).toEqual({
      householdId: undefined,
      json: true,
      kind: "show",
      personName: "Erik",
    });
    expect(roundTripJson(toIncomeProfilesJson(profiles))).toMatchObject({
      profiles: [
        {
          annualMinor: 17_500_000,
          monthlyGrossMinor: 1_458_333,
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      schemaVersion: 1,
      totals: {
        annualMinor: 17_500_000,
        bonusMinor: 2_500_000,
        currency: "USD",
        monthlyGrossMinor: 1_458_333,
        salaryMinor: 15_000_000,
      },
    });
  });
});
