const QUANTITY_SCALE = 1_000_000n;

type AccountRow = {
  accountId: string;
  includeInHouseholdReporting: number;
  reportingGroup: "cash" | "investments" | "liabilities";
};

type AnchorRow = {
  accountId: string;
  asOfDate: string;
  costBasisMinor: null | number;
  quantity: string;
  securityId: string;
};

type InvestmentTransactionRow = {
  accountId: string;
  postedDate: string;
  quantity: string;
  securityId: string;
  subtype: null | string;
  type: string;
};

type PriceRow = {
  closePriceMinor: null | number;
  isEstimated: number;
  priceDate: string;
  securityId: string;
  source: "alpha_vantage" | "missing" | "plaid_holdings";
};

type SnapshotComponentRow = {
  factDate: string;
  reportingGroup: "cash" | "liabilities";
  totalMinor: number;
};

type PairState = {
  accountId: string;
  anchorCostBasisMinor: number;
  anchorQuantity: bigint;
  securityId: string;
};

type PairFact = {
  accountId: string;
  costBasisMinor: number;
  householdId: string;
  isEstimated: boolean;
  positionDate: string;
  quantity: string;
  rebuiltAt: number;
  securityId: string;
  sourceWindowEnd: string;
  sourceWindowStart: string;
};

type AccountValueFact = {
  accountId: string;
  costBasisMinor: number;
  factDate: string;
  householdId: string;
  isEstimated: boolean;
  marketValueMinor: number;
  missingPriceCount: number;
  pricedPositionCount: number;
  rebuiltAt: number;
};

type NetWorthFact = {
  cashMinor: number;
  coverageMode:
    | "investments_backfilled"
    | "mixed_snapshot_and_backfill"
    | "snapshot_only";
  factDate: string;
  householdId: string;
  investmentsMinor: number;
  isEstimated: boolean;
  liabilitiesMinor: number;
  netWorthMinor: number;
  rebuiltAt: number;
};

type RebuildHistoricalNetWorthFactsArgs = {
  database: D1Database;
  endDate?: string;
  householdId: string;
  now: Date;
  startDate?: string;
};

type RebuildHistoricalNetWorthFactsResult = {
  accountValueFactCount: number;
  netWorthFactCount: number;
  positionFactCount: number;
};

function normalizeSecurityId(securityId: string) {
  return securityId.startsWith("security:plaid:")
    ? securityId
    : `security:plaid:${securityId.replaceAll(":", "_")}`;
}

function parseScaledQuantity(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return 0n;
  }

  const sign = trimmedValue.startsWith("-") ? -1n : 1n;
  const unsignedValue = trimmedValue.replace(/^[+-]/, "");
  const [wholePart, fractionalPart = ""] = unsignedValue.split(".");
  const normalizedWhole = wholePart === "" ? "0" : wholePart;
  const normalizedFraction = `${fractionalPart}000000`.slice(0, 6);

  return (
    sign *
    (BigInt(normalizedWhole) * QUANTITY_SCALE + BigInt(normalizedFraction))
  );
}

function formatScaledQuantity(value: bigint) {
  const sign = value < 0 ? "-" : "";
  const absoluteValue = value < 0 ? -value : value;
  const wholePart = absoluteValue / QUANTITY_SCALE;
  const fractionalPart = (absoluteValue % QUANTITY_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");

  return fractionalPart
    ? `${sign}${wholePart.toString()}.${fractionalPart}`
    : `${sign}${wholePart.toString()}`;
}

function multiplyScaledQuantityByMinor(quantity: bigint, priceMinor: number) {
  const product = quantity * BigInt(priceMinor);

  return Number((product + QUANTITY_SCALE / 2n) / QUANTITY_SCALE);
}

function addDays(isoDate: string, dayCount: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayCount);
  return date.toISOString().slice(0, 10);
}

function listDates(startDate: string, endDate: string) {
  const dates: string[] = [];

  for (
    let currentDate = startDate;
    currentDate <= endDate;
    currentDate = addDays(currentDate, 1)
  ) {
    dates.push(currentDate);
  }

  return dates;
}

function summarizeTransactionEffect(row: InvestmentTransactionRow) {
  const normalizedType = row.type.trim().toLowerCase();
  const normalizedSubtype = row.subtype?.trim().toLowerCase() ?? "";
  const normalizedQuantity = parseScaledQuantity(row.quantity);

  if (normalizedQuantity === 0n) {
    return 0n;
  }

  if (
    normalizedType === "sell" ||
    normalizedSubtype === "sell" ||
    normalizedSubtype === "transfer out"
  ) {
    return -normalizedQuantity;
  }

  if (
    normalizedType === "buy" ||
    normalizedSubtype === "buy" ||
    normalizedSubtype.startsWith("reinvest") ||
    normalizedSubtype === "transfer in"
  ) {
    return normalizedQuantity;
  }

  return 0n;
}

function findLatestPrice(
  pricesBySecurityId: Map<
    string,
    {
      exactByDate: Map<string, PriceRow>;
      resolvedRows: PriceRow[];
    }
  >,
  securityId: string,
  factDate: string,
) {
  const priceState = pricesBySecurityId.get(securityId);

  if (!priceState) {
    return {
      isEstimated: true,
      missingPrice: true,
      priceMinor: null,
    };
  }

  const exactRow = priceState.exactByDate.get(factDate);

  if (
    exactRow?.closePriceMinor !== null &&
    exactRow?.closePriceMinor !== undefined
  ) {
    return {
      isEstimated: Boolean(exactRow.isEstimated),
      missingPrice: false,
      priceMinor: exactRow.closePriceMinor,
    };
  }

  const latestResolvedRow = [...priceState.resolvedRows]
    .reverse()
    .find((row) => row.priceDate <= factDate);

  if (!latestResolvedRow) {
    return {
      isEstimated: true,
      missingPrice: true,
      priceMinor: null,
    };
  }

  return {
    isEstimated: true,
    missingPrice: false,
    priceMinor: latestResolvedRow.closePriceMinor,
  };
}

function buildSnapshotCarryForward(
  snapshotRows: SnapshotComponentRow[],
  factDate: string,
) {
  const latestSnapshotDate = snapshotRows
    .filter((row) => row.factDate <= factDate)
    .map((row) => row.factDate)
    .sort()
    .at(-1);

  if (!latestSnapshotDate) {
    return {
      cashMinor: 0,
      hasCoverageGap: true,
      liabilitiesMinor: 0,
    };
  }

  const rowsForDate = snapshotRows.filter(
    (row) => row.factDate === latestSnapshotDate,
  );

  return {
    cashMinor: rowsForDate
      .filter((row) => row.reportingGroup === "cash")
      .reduce((sum, row) => sum + row.totalMinor, 0),
    hasCoverageGap: latestSnapshotDate !== factDate,
    liabilitiesMinor: rowsForDate
      .filter((row) => row.reportingGroup === "liabilities")
      .reduce((sum, row) => sum + row.totalMinor, 0),
  };
}

function hasIncompleteAccountPriceCoverage(facts: AccountValueFact[]) {
  return facts.some(
    (fact) => fact.pricedPositionCount === 0 && fact.missingPriceCount > 0,
  );
}

async function loadAccounts(database: D1Database, householdId: string) {
  const rows = await database
    .prepare(
      `
        select
          id as accountId,
          include_in_household_reporting as includeInHouseholdReporting,
          reporting_group as reportingGroup
        from accounts
        where household_id = ?
      `,
    )
    .bind(householdId)
    .all<AccountRow>();

  return rows.results;
}

async function loadLatestHoldingRun(database: D1Database, householdId: string) {
  return database
    .prepare(
      `
        select hs.source_sync_run_id as runId
        from holding_snapshots hs
        inner join accounts a on a.id = hs.account_id
        inner join sync_runs sr on sr.id = hs.source_sync_run_id
        where a.household_id = ?
          and sr.status = ?
        order by sr.completed_at desc, sr.started_at desc
        limit 1
      `,
    )
    .bind(householdId, "succeeded")
    .first<{ runId: string }>();
}

async function loadAnchors(
  database: D1Database,
  householdId: string,
  runId: string,
) {
  const rows = await database
    .prepare(
      `
        select
          hs.account_id as accountId,
          hs.as_of_date as asOfDate,
          hs.cost_basis_minor as costBasisMinor,
          hs.quantity,
          h.security_id as securityId
        from holding_snapshots hs
        inner join holdings h on h.id = hs.holding_id
        inner join accounts a on a.id = hs.account_id
        where a.household_id = ?
          and hs.source_sync_run_id = ?
          and a.reporting_group = 'investments'
          and a.include_in_household_reporting = 1
          and h.security_id is not null
      `,
    )
    .bind(householdId, runId)
    .all<AnchorRow>();

  return rows.results.map((row) => ({
    ...row,
    securityId: normalizeSecurityId(row.securityId),
  }));
}

async function loadInvestmentTransactions(
  database: D1Database,
  householdId: string,
) {
  const rows = await database
    .prepare(
      `
        select
          it.account_id as accountId,
          date(it.posted_at / 1000, 'unixepoch') as postedDate,
          it.quantity,
          it.security_id as securityId,
          it.subtype,
          it.type
        from investment_transactions it
        inner join accounts a on a.id = it.account_id
        where a.household_id = ?
          and a.reporting_group = 'investments'
          and a.include_in_household_reporting = 1
          and it.security_id is not null
        order by it.posted_at desc
      `,
    )
    .bind(householdId)
    .all<InvestmentTransactionRow>();

  return rows.results.map((row) => ({
    ...row,
    securityId: normalizeSecurityId(row.securityId),
  }));
}

async function loadSecurityPrices(
  database: D1Database,
  securityIds: string[],
  endDate: string,
) {
  if (securityIds.length === 0) {
    return [];
  }

  const placeholders = securityIds.map(() => "?").join(", ");
  const rows = await database
    .prepare(
      `
        select
          close_price_minor as closePriceMinor,
          is_estimated as isEstimated,
          price_date as priceDate,
          security_id as securityId,
          source
        from security_price_daily
        where security_id in (${placeholders})
          and price_date <= ?
        order by price_date asc
      `,
    )
    .bind(...securityIds, endDate)
    .all<PriceRow>();

  return rows.results.map((row) => ({
    ...row,
    securityId: normalizeSecurityId(row.securityId),
  }));
}

async function loadSnapshotComponents(
  database: D1Database,
  householdId: string,
) {
  const rows = await database
    .prepare(
      `
        select
          latest_balances.as_of_date as factDate,
          a.reporting_group as reportingGroup,
          sum(latest_balances.balance_minor) as totalMinor
        from accounts a
        inner join (
          select bs.account_id, bs.as_of_date, bs.balance_minor
          from balance_snapshots bs
          inner join (
            select account_id, as_of_date, max(captured_at) as capturedAt
            from balance_snapshots
            group by account_id, as_of_date
          ) latest
            on latest.account_id = bs.account_id
           and latest.as_of_date = bs.as_of_date
           and latest.capturedAt = bs.captured_at
        ) latest_balances
          on latest_balances.account_id = a.id
        where a.household_id = ?
          and a.include_in_household_reporting = 1
          and a.reporting_group in ('cash', 'liabilities')
        group by latest_balances.as_of_date, a.reporting_group
        order by latest_balances.as_of_date asc
      `,
    )
    .bind(householdId)
    .all<SnapshotComponentRow>();

  return rows.results;
}

async function deleteExistingFacts(args: {
  database: D1Database;
  endDate: string;
  householdId: string;
  startDate: string;
}) {
  await args.database.batch([
    args.database
      .prepare(
        `
          delete from daily_security_position_facts
          where household_id = ?
            and position_date >= ?
            and position_date <= ?
        `,
      )
      .bind(args.householdId, args.startDate, args.endDate),
    args.database
      .prepare(
        `
          delete from daily_investment_account_value_facts
          where household_id = ?
            and fact_date >= ?
            and fact_date <= ?
        `,
      )
      .bind(args.householdId, args.startDate, args.endDate),
    args.database
      .prepare(
        `
          delete from daily_net_worth_facts
          where household_id = ?
            and fact_date >= ?
            and fact_date <= ?
        `,
      )
      .bind(args.householdId, args.startDate, args.endDate),
  ]);
}

async function insertFacts(
  database: D1Database,
  positionFacts: PairFact[],
  accountValueFacts: AccountValueFact[],
  netWorthFacts: NetWorthFact[],
) {
  await database.batch([
    ...positionFacts.map((fact) =>
      database
        .prepare(
          `
            insert into daily_security_position_facts (
              household_id,
              account_id,
              security_id,
              position_date,
              quantity,
              cost_basis_minor,
              source_window_start,
              source_window_end,
              is_estimated,
              rebuilt_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          fact.householdId,
          fact.accountId,
          fact.securityId,
          fact.positionDate,
          fact.quantity,
          fact.costBasisMinor,
          fact.sourceWindowStart,
          fact.sourceWindowEnd,
          fact.isEstimated ? 1 : 0,
          fact.rebuiltAt,
        ),
    ),
    ...accountValueFacts.map((fact) =>
      database
        .prepare(
          `
            insert into daily_investment_account_value_facts (
              household_id,
              account_id,
              fact_date,
              market_value_minor,
              cost_basis_minor,
              priced_position_count,
              missing_price_count,
              is_estimated,
              rebuilt_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          fact.householdId,
          fact.accountId,
          fact.factDate,
          fact.marketValueMinor,
          fact.costBasisMinor,
          fact.pricedPositionCount,
          fact.missingPriceCount,
          fact.isEstimated ? 1 : 0,
          fact.rebuiltAt,
        ),
    ),
    ...netWorthFacts.map((fact) =>
      database
        .prepare(
          `
            insert into daily_net_worth_facts (
              household_id,
              fact_date,
              cash_minor,
              investments_minor,
              liabilities_minor,
              net_worth_minor,
              coverage_mode,
              is_estimated,
              rebuilt_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          fact.householdId,
          fact.factDate,
          fact.cashMinor,
          fact.investmentsMinor,
          fact.liabilitiesMinor,
          fact.netWorthMinor,
          fact.coverageMode,
          fact.isEstimated ? 1 : 0,
          fact.rebuiltAt,
        ),
    ),
  ]);
}

export async function rebuildHistoricalNetWorthFacts(
  args: RebuildHistoricalNetWorthFactsArgs,
): Promise<RebuildHistoricalNetWorthFactsResult> {
  const accounts = await loadAccounts(args.database, args.householdId);
  const latestHoldingRun = await loadLatestHoldingRun(
    args.database,
    args.householdId,
  );

  if (!latestHoldingRun) {
    return {
      accountValueFactCount: 0,
      netWorthFactCount: 0,
      positionFactCount: 0,
    };
  }

  const anchors = await loadAnchors(
    args.database,
    args.householdId,
    latestHoldingRun.runId,
  );
  const transactions = await loadInvestmentTransactions(
    args.database,
    args.householdId,
  );

  const householdAnchorDate = anchors
    .map((anchor) => anchor.asOfDate)
    .sort()
    .at(-1);

  if (!householdAnchorDate) {
    return {
      accountValueFactCount: 0,
      netWorthFactCount: 0,
      positionFactCount: 0,
    };
  }

  const effectiveStartDate =
    args.startDate ??
    [
      ...transactions.map((transaction) => transaction.postedDate),
      householdAnchorDate,
    ]
      .sort()
      .at(0) ??
    householdAnchorDate;
  const effectiveEndDate =
    args.endDate && args.endDate < householdAnchorDate
      ? args.endDate
      : householdAnchorDate;

  if (effectiveStartDate > effectiveEndDate) {
    return {
      accountValueFactCount: 0,
      netWorthFactCount: 0,
      positionFactCount: 0,
    };
  }

  const pairStates = new Map<string, PairState>();

  for (const anchor of anchors) {
    const key = `${anchor.accountId}:${anchor.securityId}`;
    pairStates.set(key, {
      accountId: anchor.accountId,
      anchorCostBasisMinor: anchor.costBasisMinor ?? 0,
      anchorQuantity: parseScaledQuantity(anchor.quantity),
      securityId: anchor.securityId,
    });
  }

  for (const transaction of transactions) {
    const key = `${transaction.accountId}:${transaction.securityId}`;

    if (!pairStates.has(key)) {
      pairStates.set(key, {
        accountId: transaction.accountId,
        anchorCostBasisMinor: 0,
        anchorQuantity: 0n,
        securityId: transaction.securityId,
      });
    }
  }

  const transactionEffectsByPair = new Map<string, Map<string, bigint>>();

  for (const transaction of transactions) {
    const key = `${transaction.accountId}:${transaction.securityId}`;
    const effectForDate = summarizeTransactionEffect(transaction);
    const pairEffects = transactionEffectsByPair.get(key) ?? new Map();
    pairEffects.set(
      transaction.postedDate,
      (pairEffects.get(transaction.postedDate) ?? 0n) + effectForDate,
    );
    transactionEffectsByPair.set(key, pairEffects);
  }

  const prices = await loadSecurityPrices(
    args.database,
    [
      ...new Set(
        Array.from(pairStates.values()).map((state) => state.securityId),
      ),
    ],
    effectiveEndDate,
  );
  const pricesBySecurityId = prices.reduce<
    Map<
      string,
      {
        exactByDate: Map<string, PriceRow>;
        resolvedRows: PriceRow[];
      }
    >
  >((result, row) => {
    const existing = result.get(row.securityId) ?? {
      exactByDate: new Map<string, PriceRow>(),
      resolvedRows: [],
    };
    existing.exactByDate.set(row.priceDate, row);
    if (row.closePriceMinor !== null && row.closePriceMinor !== undefined) {
      existing.resolvedRows.push(row);
    }
    result.set(row.securityId, existing);
    return result;
  }, new Map());
  const snapshotComponents = await loadSnapshotComponents(
    args.database,
    args.householdId,
  );
  const hasMixedCoverage = accounts.some(
    (account) =>
      account.includeInHouseholdReporting === 1 &&
      account.reportingGroup !== "investments",
  );

  const positionFacts: PairFact[] = [];
  const accountValueFactsByDateAndAccount = new Map<string, AccountValueFact>();

  for (const [pairKey, pairState] of pairStates) {
    let quantity = pairState.anchorQuantity;
    const transactionEffects =
      transactionEffectsByPair.get(pairKey) ?? new Map();

    for (
      let currentDate = householdAnchorDate;
      currentDate >= effectiveStartDate;
      currentDate = addDays(currentDate, -1)
    ) {
      if (currentDate <= effectiveEndDate) {
        positionFacts.push({
          accountId: pairState.accountId,
          costBasisMinor: pairState.anchorCostBasisMinor,
          householdId: args.householdId,
          isEstimated: false,
          positionDate: currentDate,
          quantity: formatScaledQuantity(quantity),
          rebuiltAt: args.now.getTime(),
          securityId: pairState.securityId,
          sourceWindowEnd: householdAnchorDate,
          sourceWindowStart: effectiveStartDate,
        });

        const accountValueKey = `${pairState.accountId}:${currentDate}`;
        const existingAccountValueFact = accountValueFactsByDateAndAccount.get(
          accountValueKey,
        ) ?? {
          accountId: pairState.accountId,
          costBasisMinor: 0,
          factDate: currentDate,
          householdId: args.householdId,
          isEstimated: false,
          marketValueMinor: 0,
          missingPriceCount: 0,
          pricedPositionCount: 0,
          rebuiltAt: args.now.getTime(),
        };

        existingAccountValueFact.costBasisMinor +=
          pairState.anchorCostBasisMinor;

        if (quantity === 0n) {
          accountValueFactsByDateAndAccount.set(
            accountValueKey,
            existingAccountValueFact,
          );
          continue;
        }

        const price = findLatestPrice(
          pricesBySecurityId,
          pairState.securityId,
          currentDate,
        );

        if (price.priceMinor === null) {
          existingAccountValueFact.isEstimated = true;
          existingAccountValueFact.missingPriceCount += 1;
        } else {
          existingAccountValueFact.marketValueMinor +=
            multiplyScaledQuantityByMinor(quantity, price.priceMinor);
          existingAccountValueFact.pricedPositionCount += 1;
          existingAccountValueFact.isEstimated ||= price.isEstimated;
        }

        accountValueFactsByDateAndAccount.set(
          accountValueKey,
          existingAccountValueFact,
        );
      }

      quantity -= transactionEffects.get(currentDate) ?? 0n;
    }
  }

  const accountValueFacts = Array.from(
    accountValueFactsByDateAndAccount.values(),
  ).sort((left, right) => {
    if (left.factDate === right.factDate) {
      return left.accountId.localeCompare(right.accountId);
    }

    return left.factDate.localeCompare(right.factDate);
  });
  const netWorthFacts = listDates(effectiveStartDate, effectiveEndDate).flatMap(
    (factDate) => {
      const investmentFactsForDate = accountValueFacts.filter(
        (fact) => fact.factDate === factDate,
      );

      if (hasIncompleteAccountPriceCoverage(investmentFactsForDate)) {
        return [];
      }

      const investmentsMinor = investmentFactsForDate.reduce(
        (sum, fact) => sum + fact.marketValueMinor,
        0,
      );
      const investmentIsEstimated = investmentFactsForDate.some(
        (fact) => fact.isEstimated,
      );
      const snapshotCarryForward = buildSnapshotCarryForward(
        snapshotComponents,
        factDate,
      );
      const coverageMode = hasMixedCoverage
        ? "mixed_snapshot_and_backfill"
        : "investments_backfilled";
      const cashMinor = hasMixedCoverage ? snapshotCarryForward.cashMinor : 0;
      const liabilitiesMinor = hasMixedCoverage
        ? snapshotCarryForward.liabilitiesMinor
        : 0;

      return [
        {
          cashMinor,
          coverageMode,
          factDate,
          householdId: args.householdId,
          investmentsMinor,
          isEstimated:
            investmentIsEstimated || snapshotCarryForward.hasCoverageGap,
          liabilitiesMinor,
          netWorthMinor: cashMinor + liabilitiesMinor + investmentsMinor,
          rebuiltAt: args.now.getTime(),
        } satisfies NetWorthFact,
      ];
    },
  );

  await deleteExistingFacts({
    database: args.database,
    endDate: effectiveEndDate,
    householdId: args.householdId,
    startDate: effectiveStartDate,
  });
  await insertFacts(
    args.database,
    positionFacts,
    accountValueFacts,
    netWorthFacts,
  );

  return {
    accountValueFactCount: accountValueFacts.length,
    netWorthFactCount: netWorthFacts.length,
    positionFactCount: positionFacts.length,
  };
}
