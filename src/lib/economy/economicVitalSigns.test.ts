import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { computeEconomicVitalSigns, summarizeLedgerTurnover } from "./economicVitalSigns";
import type { VitalSignsHistoryRow } from "./economicVitalSigns";
import type { LedgerReconciliation } from "@/lib/ledger/types";

const emptyInput = {
  turn: 1,
  now: new Date("2026-08-29T00:00:00.000Z"),
  currentFlows: [],
  flowHistory: [],
  prices: [],
  sourcing: [],
  sectors: [],
  globalExchange: null,
  trades: [],
  shareOrders: [],
  bonds: [],
  globalWealth: null,
  money: [],
  health: null,
  reconciliation: null,
  balanceSnapshot: null,
  ledgerTurnover: [],
  ledgerEntryCount: 0,
  commodityParticipants: [],
};

function historyRow(turn: number, depthToMarketCap: number): VitalSignsHistoryRow {
  return {
    turn,
    depthToMarketCap,
    twoSidedListingShare: 0.5,
    activeTradedListingShare: 0.5,
    sovereignNoHolderBondShare: 0.1,
  };
}

describe("computeEconomicVitalSigns", () => {
  it("keeps pooled, scoped, and buyer-intent denominators separate", () => {
    const snapshot = computeEconomicVitalSigns({
      turn: 100,
      now: new Date("2026-08-27T00:00:00.000Z"),
      currentFlows: [
        {
          basis: "ledger_aggregate",
          clearingBasis: "global_pooled_availability",
          commodity: "steel",
          turn: 100,
          supplyUnits: 50,
          demandUnits: 100,
          demandUnitsLedger: 100,
          clearedUnits: 50,
          clearedUnitsPooled: 50,
          unmetDemandUnits: 50,
          unmetDemandUnitsPooled: 50,
          surplusUnits: 0,
          surplusUnitsPooled: 0,
          price: 20,
          stockUnits: 0,
          coverTurns: 0,
          spoiledUnits: 0,
          byCountry: {
            US: {
              basis: "country_scoped_ledger",
              supply: 40,
              demand: 80,
              cleared: 40,
              clearedUnitsScoped: 40,
              price: 20,
            },
          },
          createdAt: new Date(),
        },
      ],
      flowHistory: [],
      prices: [
        {
          commodity: "steel",
          basePrice: 10,
          globalPrice: 20,
          globalSupply: 50,
          globalDemand: 100,
          statePrices: {},
          stateSupply: {},
          stateDemand: {},
          turn: 100,
          updatedAt: new Date(),
        },
      ],
      sourcing: [
        {
          basis: "buyer_intent_sourcing",
          commodity: "steel",
          turn: 100,
          demandUnitsIntent: 100,
          intraStateUnits: 30,
          interStateUnits: 10,
          importUnits: 10,
          tariffPaid: 0,
          unmetUnits: 50,
          toleranceBoundUnits: 40,
          capacityBoundUnits: 10,
          shortageResponsiveUnits: 5,
          flows: [],
          itemizedFlowCount: 0,
          totalFlowCount: 0,
          createdAt: new Date(),
        },
      ],
      sectors: [],
      globalExchange: null,
      trades: [],
      shareOrders: [],
      bonds: [],
      globalWealth: null,
      money: [],
      health: null,
      reconciliation: null,
      balanceSnapshot: null,
      ledgerTurnover: [],
      ledgerEntryCount: 0,
      commodityParticipants: [
        {
          commodity: "steel",
          corporationId: "seller-a",
          ownershipRootId: "group-a",
          sellerUnits: 60,
          buyerUnits: 0,
        },
        {
          commodity: "steel",
          corporationId: "seller-b",
          ownershipRootId: "group-a",
          sellerUnits: 20,
          buyerUnits: 0,
        },
        {
          commodity: "steel",
          corporationId: "seller-c",
          ownershipRootId: "seller-c",
          sellerUnits: 20,
          buyerUnits: 0,
        },
      ],
    });

    expect(snapshot.goods.pooledFillRate.value).toBe(0.5);
    expect(snapshot.goods.countryScopedFillRate.value).toBe(0.5);
    expect(snapshot.goods.medianPriceMultiple.value).toBe(2);
    expect(snapshot.trade.intentFulfillmentRate.value).toBe(0.5);
    expect(snapshot.trade.localShare.value).toBe(0.6);
    expect(snapshot.trade.toleranceBoundShareOfUnmet.value).toBe(0.8);
    expect(snapshot.trade.shortageResponsiveShareOfFulfillment.value).toBe(0.1);
    expect(snapshot.competition.markets[0]).toMatchObject({
      commodity: "steel",
      sellerCount: 3,
      sellerHhi: 4400,
      ownershipAdjustedSellerHhi: 6800,
      largestOwnershipAdjustedSellerShare: 0.8,
      largestOwnershipAdjustedSellerUnits: 80,
      highConcentrationLowFill: true,
    });
    expect(snapshot.competition.highConcentrationLowFillShare.value).toBe(1);
    expect(snapshot.goods.pooledFillRate.basis).not.toBe(
      snapshot.trade.intentFulfillmentRate.basis
    );
  });

  it("computes concentration, liquidity, distribution, money, and reconciliation measures", () => {
    const listings = [60, 20, 10, 10].map((marketCapAnchor, index) => ({
      _id: new ObjectId(),
      sequentialId: index + 1,
      name: `Firm ${index}`,
      type: "manufacturing",
      typeLabel: "Manufacturing",
      headquartersState: "NY",
      headquartersStateName: "New York",
      dividendRate: 0,
      sharePrice: 1,
      totalShares: marketCapAnchor,
      marketCap: marketCapAnchor,
      marketCapAnchor,
      totalRevenue: 10,
      totalRevenueAnchor: 10,
      income: index === 3 ? -1 : 1,
      incomeAnchor: index === 3 ? -1 : 1,
      priceChange1h: 0,
      priceChange24h: 0,
      priceChange48h: 0,
      avgSectorGrowth: 0,
      publicFloat: 1,
      exchange: "NYSE",
      isNatcorp: false,
      ceo: null,
    }));
    const corpId = listings[0]!._id;
    const snapshot = computeEconomicVitalSigns({
      turn: 100,
      now: new Date(),
      currentFlows: [],
      flowHistory: [],
      prices: [],
      sourcing: [],
      sectors: [],
      globalExchange: {
        _id: "global",
        turn: 100,
        exchangeName: "Global",
        listings,
        createdAt: new Date(),
      },
      trades: [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          kind: "market_buy",
          turn: 99,
          createdAt: new Date(),
          shares: 2,
          pricePerShareAnchor: 5,
          totalAnchor: 10,
          to: null,
          from: null,
        },
      ],
      shareOrders: [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          characterId: new ObjectId(),
          type: "buy",
          shares: 5,
          sharesRemaining: 5,
          pricePerShare: 4,
          escrowAmount: 20,
          status: "open",
          createdAt: new Date("2026-08-26T00:00:00.000Z"),
          updatedAt: new Date("2026-08-26T00:00:00.000Z"),
        },
        {
          _id: new ObjectId(),
          corporationId: corpId,
          characterId: new ObjectId(),
          type: "sell",
          shares: 5,
          sharesRemaining: 5,
          pricePerShare: 6,
          escrowAmount: 0,
          status: "open",
          createdAt: new Date("2026-08-26T00:00:00.000Z"),
          updatedAt: new Date("2026-08-26T00:00:00.000Z"),
        },
        {
          _id: new ObjectId(),
          corporationId: corpId,
          characterId: new ObjectId(),
          type: "buy",
          shares: 1,
          sharesRemaining: 0,
          pricePerShare: 5,
          escrowAmount: 0,
          status: "filled",
          createdAt: new Date("2026-08-26T00:00:00.000Z"),
          updatedAt: new Date("2026-08-26T06:00:00.000Z"),
        },
      ],
      bonds: [
        {
          _id: new ObjectId(),
          issuerType: "sovereign",
          countryId: "US",
          corporationId: corpId,
          faceValue: 1_000,
          couponRate: 4,
          maturityTurns: 96,
          issuedAtTurn: 1,
          maturityTurn: 97,
          marketPrice: 1,
          totalIssued: 10_000,
          publicFloat: 10,
          holders: [],
          defaulted: false,
          defaultedAtTurn: null,
          matured: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      globalWealth: {
        _id: "global",
        turn: 100,
        entries: [1, 1, 1, 97].map((totalWealth, index) => ({
          characterId: String(index),
          sequentialId: index,
          name: "redacted in aggregate",
          avatarUrl: null,
          state: "NY",
          country: "US",
          corporation: null,
          stockValue: 0,
          bondValue: 0,
          portfolioValue: 0,
          cashValue: totalWealth,
          totalWealth,
          rank: index + 1,
        })),
        createdAt: new Date(),
      },
      money: [
        {
          _id: "100:USD",
          turn: 100,
          countryId: "US",
          bankId: "US",
          currencyCode: "USD",
          m1: 50,
          m2: 100,
          externalBroadMoney: 0,
          householdLiquid: 0,
          householdSavings: 0,
          campaignLiquid: 0,
          nppLiquid: 0,
          corporateLiquid: 0,
          partyLiquid: 0,
          governmentLiquid: 0,
          fundLiquid: 0,
          organizationLiquid: 0,
          bankDeposits: 0,
          bankReserves: 0,
          creditOutstanding: 25,
          sovereignBondsOutstanding: 0,
          centralBankBondHoldings: 0,
          bondPoolCash: 0,
          annualizedM2GrowthPct: 5,
          accountingVersion: 2,
          netMoneyCreatedLifetime: 0,
          createdAt: new Date(),
        },
      ],
      health: {
        _id: new ObjectId(),
        turn: 100,
        year: 1955,
        timestamp: new Date(),
        turnProcessing: {
          durationMs: 1,
          success: true,
          phaseCount: 1,
          phasesSkipped: 0,
          warningCount: 0,
          errorCount: 0,
          warnings: [],
          errors: [],
          phaseStatuses: {},
        },
        dataIntegrity: null,
        population: {
          activePlayers: 0,
          totalCharacters: 0,
          totalNPPs: 0,
          emptySeats: 0,
          totalSeats: 0,
          partiesCount: 0,
          activeElections: 0,
          averagePartySize: 0,
          byCountry: {},
        },
        economy: {
          byCountry: {
            US: {
              gdpGrowth: 2,
              gdp: 1,
              inflation: 3,
              interestRate: 4,
              bondDefaultRate: 0,
              totalCorporationRevenue: 0,
              averagePlayerFunds: 0,
              fundCirculation: 0,
            },
          },
        },
      },
      reconciliation: null,
      balanceSnapshot: {
        _id: new ObjectId(),
        turn: 100,
        createdAt: new Date(),
        balances: {
          "character:active:USD": 40,
          "character:dormant:USD": 60,
          "corporation:active:USD": 100,
        },
      },
      // Built from real legs so this still exercises the leg-selection rule
      // (primary legs only) that production now applies in Mongo.
      ledgerTurnover: summarizeLedgerTurnover([
        {
          _id: new ObjectId(),
          turn: 99,
          createdAt: new Date(),
          txType: "fund_credit",
          emitSite: "test",
          balanced: true,
          legs: [
            {
              account: "character:active:USD",
              amount: 20,
              anchorAmount: 20,
              currencyCode: "USD",
              role: "primary",
            },
            {
              account: "mint:test:USD",
              amount: -20,
              anchorAmount: -20,
              currencyCode: "USD",
              role: "contra",
            },
            {
              account: "corporation:active:USD",
              amount: -50,
              anchorAmount: -50,
              currencyCode: "USD",
              role: "primary",
            },
            {
              account: "sink:test:USD",
              amount: 50,
              anchorAmount: 50,
              currencyCode: "USD",
              role: "contra",
            },
          ],
        },
      ]),
      ledgerEntryCount: 1,
      commodityParticipants: [],
    });

    expect(snapshot.firms.marketCapHhi.value).toBe(4200);
    expect(snapshot.firms.lossMakingShare.value).toBe(0.25);
    expect(snapshot.securities.activeTradedListingShare.value).toBe(0.25);
    expect(snapshot.securities.noHolderBondShare.value).toBe(1);
    expect(snapshot.securities.bondSubscriptionRate.value).toBe(0);
    expect(snapshot.securities.sovereignMedianHolders.value).toBe(0);
    expect(snapshot.securities.sovereignSubscriptionRate.value).toBe(0);
    expect(snapshot.securities.sovereignMaturityHhi.value).toBe(10_000);
    expect(snapshot.securities.sovereignMedianPriceToParSpreadPct.value).toBe(0);
    expect(snapshot.securities.twoSidedListingShare.value).toBe(0.25);
    expect(snapshot.securities.medianQuotedSpreadPct.value).toBe(40);
    expect(snapshot.securities.openOrderDepthAnchor).toBe(50);
    expect(snapshot.securities.medianFilledOrderExecutionHours.value).toBe(6);
    expect(snapshot.households.topTenWealthShare.value).toBe(1);
    expect(snapshot.households.wealthGini.value).toBeCloseTo(0.72);
    expect(snapshot.money.creditToM2.value).toBe(0.25);
    expect(snapshot.money.transactionalMoneyShare.value).toBe(0.5);
    expect(snapshot.money.activeModeledBalanceShare48.value).toBe(0.7);
    expect(snapshot.money.dormantModeledBalanceShare48.value).toBe(0.3);
    expect(snapshot.money.modeledGrossVelocity48.value).toBe(0.35);
    expect(snapshot.reconciliation.status).toBe("unavailable");
  });

  it("treats a series younger than the window as fully covered", () => {
    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 3 });

    expect(snapshot.coverage.coverageStartTurn).toBe(3);
    expect(snapshot.coverage.windowTurnsExpected).toBe(1);
    expect(snapshot.coverage.windowTurnsObserved).toBe(1);
    expect(snapshot.coverage.missingTurns).toEqual([]);
    expect(snapshot.coverage.windowCoverageShare).toBe(1);
    expect(snapshot.measurement.reasons).not.toContain("window_missing_0_turns");
  });

  it("marks the turns that produced no snapshot without counting pre-series turns", () => {
    const history: VitalSignsHistoryRow[] = [];
    for (let turn = 5; turn <= 19; turn += 1) {
      if (turn === 17 || turn === 18) continue;
      history.push(historyRow(turn, 0.1));
    }

    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 20, history });

    // Turns 1 to 4 predate the series and are not gaps. Turns 17 and 18 are.
    expect(snapshot.coverage.coverageStartTurn).toBe(5);
    expect(snapshot.coverage.missingTurns).toEqual([17, 18]);
    expect(snapshot.coverage.windowTurnsObserved).toBe(14);
    expect(snapshot.coverage.windowTurnsExpected).toBe(16);
    expect(snapshot.coverage.windowCoverageShare).toBe(14 / 16);
    expect(snapshot.measurement.reasons).toContain("window_missing_2_turns");
  });

  it("medians the securities window so one spiky turn cannot anchor a baseline", () => {
    const history: VitalSignsHistoryRow[] = [];
    for (let turn = 19; turn <= 29; turn += 1) {
      history.push(historyRow(turn, turn === 25 ? 0.9 : 0.002));
    }

    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30, history });

    expect(snapshot.securitiesRecent12.depthToMarketCapMedian.value).toBe(0.002);
    expect(snapshot.securitiesRecent12.depthToMarketCapMedian.observations).toBe(11);
  });

  it("separates facility quotes from organic participation in the equity book", () => {
    const corporationId = new ObjectId();
    const listing = {
      _id: corporationId,
      sequentialId: 1,
      name: "Firm",
      type: "manufacturing",
      countryId: "US",
      sharePrice: 10,
      sharePriceAnchor: 10,
      totalShares: 1000,
      marketCapAnchor: 10000,
      priceChange48h: 0,
    };
    const order = (type: "buy" | "sell", liquidityProvider: boolean) => ({
      _id: new ObjectId(),
      corporationId,
      characterId: new ObjectId(),
      type,
      shares: 10,
      sharesRemaining: 10,
      pricePerShare: type === "buy" ? 9 : 11,
      escrowAmount: 0,
      status: "open" as const,
      liquidityProvider,
      createdAt: new Date("2026-08-29T00:00:00.000Z"),
      updatedAt: new Date("2026-08-29T00:00:00.000Z"),
    });

    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      // The facility quotes both sides. The only organic order is a buy, so the book
      // is two-sided on paper and one-sided in fact.
      globalExchange: { _id: "global", listings: [listing], updatedAt: new Date() } as never,
      shareOrders: [order("buy", true), order("sell", true), order("buy", false)] as never,
    });

    expect(snapshot.securities.twoSidedListingShare.value).toBe(1);
    expect(snapshot.securities.organicTwoSidedListingShare.value).toBe(0);
    expect(snapshot.securities.facilityQuotedListings).toBe(1);
    expect(snapshot.securities.organicDepthToMarketCap.value).toBeLessThan(
      snapshot.securities.depthToMarketCap.value!
    );
  });

  it("measures pooled-vehicle velocity separately, and as unknown when absent", () => {
    const funded = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      balanceSnapshot: {
        _id: new ObjectId(),
        turn: 30,
        createdAt: new Date(),
        balances: {
          "fund:cash:USD": 100,
          "npp:polis:USD": 300,
          "character:a:USD": 600,
        },
      },
      ledgerTurnover: [
        { account: "fund:cash:USD", turnover: 50 },
        { account: "npp:polis:USD", turnover: 150 },
        { account: "character:a:USD", turnover: 600 },
        // System legs never reach the classifier.
        { account: "mint:reason:USD", turnover: 10_000 },
      ],
      ledgerEntryCount: 4,
    });

    // (50 + 150) / (100 + 300) from pooled vehicles only.
    expect(funded.money.intermediatedGrossVelocity48.value).toBe(0.5);
    expect(funded.money.intermediatedGrossVelocity48.basis).toBe(
      "fund_org_npp_primary_ledger_flow_to_closing_balance"
    );
    // Gross still covers every real account: (50 + 150 + 600) / 1000.
    expect(funded.money.modeledGrossVelocity48.value).toBe(0.8);
    // Household velocity is untouched by pooled-vehicle flow.
    expect(funded.money.householdGrossVelocity48.value).toBe(1);

    const noVehicles = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      balanceSnapshot: {
        _id: new ObjectId(),
        turn: 30,
        createdAt: new Date(),
        balances: { "character:a:USD": 600 },
      },
      ledgerTurnover: [{ account: "character:a:USD", turnover: 600 }],
      ledgerEntryCount: 1,
    });

    // No pooled-vehicle stock: unknown, not zero.
    expect(noVehicles.money.intermediatedGrossVelocity48.value).toBeNull();
    expect(noVehicles.money.householdGrossVelocity48.value).toBe(1);
  });

  it("covers corporate bond holders with the same depth as sovereign issues", () => {
    const corpId = new ObjectId();
    const bond = (overrides: object) => ({
      _id: new ObjectId(),
      corporationId: corpId,
      faceValue: 1_000,
      couponRate: 4,
      maturityTurns: 96,
      issuedAtTurn: 1,
      maturityTurn: 97,
      marketPrice: 1,
      totalIssued: 10_000,
      publicFloat: 0,
      holders: [],
      defaulted: false,
      defaultedAtTurn: null,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      bonds: [
        bond({
          holders: [{ corporationId: corpId, units: 30 }, { units: 10 }],
          publicFloat: 60,
        }),
        // Legacy corporate rows omit issuerType and still count as corporate.
        bond({ holders: [], publicFloat: 0 }),
        bond({ issuerType: "sovereign", holders: [{ units: 5 }], publicFloat: 5 }),
      ] as never,
    });

    // Holder counts [2, 0]: median 1 across the two corporate issues.
    expect(snapshot.securities.corporateMedianHolders.value).toBe(1);
    expect(snapshot.securities.corporateMedianHolders.observations).toBe(2);
    expect(snapshot.securities.corporateMedianHolders.basis).toBe(
      "unmatured_corporate_issue_count"
    );
    // Held 40 of 100 outstanding corporate units; the sovereign leg is excluded.
    expect(snapshot.securities.corporateSubscriptionRate.value).toBe(0.4);
    expect(snapshot.securities.corporateSubscriptionRate.observations).toBe(2);
    expect(snapshot.securities.corporateSubscriptionRate.basis).toBe("unmatured_corporate_units");
    expect(snapshot.securities.corporateNoHolderBondShare.value).toBe(0.5);
    expect(snapshot.securities.sovereignSubscriptionRate.value).toBe(0.5);
  });

  it("reports absent corporate bond coverage as unknown, not as zero holders", () => {
    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30 });

    expect(snapshot.securities.corporateMedianHolders.value).toBeNull();
    expect(snapshot.securities.corporateMedianHolders.observations).toBe(0);
    expect(snapshot.securities.corporateSubscriptionRate.value).toBeNull();
    expect(snapshot.securities.corporateSubscriptionRate.observations).toBe(0);
  });

  it("splits household velocity into transactional and savings activity", () => {
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      balanceSnapshot: {
        _id: new ObjectId(),
        turn: 30,
        createdAt: new Date(),
        balances: {
          "character:a:USD": 600,
          "character_savings:a:USD": 400,
        },
      },
      ledgerTurnover: [
        { account: "character:a:USD", turnover: 600 },
        { account: "character_savings:a:USD", turnover: 40 },
        // System legs never reach the classifier.
        { account: "mint:reason:USD", turnover: 10_000 },
      ],
      ledgerEntryCount: 3,
    });

    // Wallet turnover over wallet stock only: 600 / 600.
    expect(snapshot.money.householdTransactionalVelocity48.value).toBe(1);
    expect(snapshot.money.householdTransactionalVelocity48.basis).toBe(
      "character_primary_ledger_flow_to_closing_balance"
    );
    // Savings turnover over savings stock only: 40 / 400.
    expect(snapshot.money.householdSavingsVelocity48.value).toBe(0.1);
    expect(snapshot.money.householdSavingsVelocity48.basis).toBe(
      "character_savings_primary_ledger_flow_to_closing_balance"
    );
    // Savings share of household closing stock: 400 / (600 + 400).
    expect(snapshot.money.savingsShareOfHouseholdBalances.value).toBe(0.4);
    expect(snapshot.money.savingsShareOfHouseholdBalances.observations).toBe(2);
    expect(snapshot.money.savingsShareOfHouseholdBalances.basis).toBe(
      "character_savings_share_of_household_closing_balance"
    );
    // The lumped household velocity still covers both classes: 640 / 1000.
    expect(snapshot.money.householdGrossVelocity48.value).toBe(0.64);
  });

  it("reports absent household balances as unknown, not as zero velocity", () => {
    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30 });

    expect(snapshot.money.householdTransactionalVelocity48.value).toBeNull();
    expect(snapshot.money.householdTransactionalVelocity48.observations).toBe(0);
    expect(snapshot.money.householdSavingsVelocity48.value).toBeNull();
    expect(snapshot.money.householdSavingsVelocity48.observations).toBe(0);
    expect(snapshot.money.savingsShareOfHouseholdBalances.value).toBeNull();
    expect(snapshot.money.savingsShareOfHouseholdBalances.observations).toBe(0);
  });

  it("reports a missing savings class as unknown without moving the wallet read", () => {
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      balanceSnapshot: {
        _id: new ObjectId(),
        turn: 30,
        createdAt: new Date(),
        balances: { "character:a:USD": 600 },
      },
      ledgerTurnover: [{ account: "character:a:USD", turnover: 600 }],
      ledgerEntryCount: 1,
    });

    expect(snapshot.money.householdTransactionalVelocity48.value).toBe(1);
    // No savings stock: unknown, not zero, and the share is unknown too.
    expect(snapshot.money.householdSavingsVelocity48.value).toBeNull();
    expect(snapshot.money.savingsShareOfHouseholdBalances.value).toBeNull();
    expect(snapshot.money.savingsShareOfHouseholdBalances.observations).toBe(1);
  });

  it("records a skipped stock versus flow check as unknown, not as zero divergences", () => {
    const reconciliation: LedgerReconciliation = {
      _id: new ObjectId(),
      turn: 30,
      generatedAt: new Date("2026-08-29T00:00:00.000Z"),
      status: "amber",
      entriesChecked: 0,
      trialBalance: { status: "green", unbalancedCount: 0, findings: [] },
      stockVsFlow: { status: "amber", skipped: true, divergentCount: null, findings: [] },
      moneySupply: { status: "green", findings: [] },
      unattributed: [],
    };

    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30, reconciliation });

    expect(snapshot.reconciliation.stockVsFlowDivergentCount).toBeNull();
    expect(snapshot.reconciliation.stockVsFlowSkipped).toBe(true);
    expect(snapshot.measurement.reasons).toContain("stock_vs_flow_skipped");
  });
});

describe("summarizeLedgerTurnover", () => {
  /**
   * Production computes this with a Mongo $group instead, to avoid loading
   * 61,398 entries for a 1,389-row answer. These pin the rules that both
   * paths have to agree on: which legs count, and how they combine.
   */
  const entry = (legs: { account: string; anchorAmount: number; role: string }[]) => ({
    _id: new ObjectId(),
    turn: 1,
    createdAt: new Date(),
    txType: "test",
    emitSite: "test",
    balanced: true,
    legs: legs.map((l) => ({
      account: l.account,
      amount: l.anchorAmount,
      anchorAmount: l.anchorAmount,
      currencyCode: "USD",
      role: l.role,
    })),
  });

  it("counts primary legs and ignores every other role", () => {
    const rows = summarizeLedgerTurnover([
      entry([
        { account: "character:a:USD", anchorAmount: 20, role: "primary" },
        { account: "mint:x:USD", anchorAmount: -20, role: "contra" },
      ]),
    ] as never);

    expect(rows).toEqual([{ account: "character:a:USD", turnover: 20 }]);
  });

  it("uses absolute amounts, so inflows and outflows both count as turnover", () => {
    const rows = summarizeLedgerTurnover([
      entry([{ account: "character:a:USD", anchorAmount: -75, role: "primary" }]),
    ] as never);

    expect(rows).toEqual([{ account: "character:a:USD", turnover: 75 }]);
  });

  it("sums across entries and across legs of the same account", () => {
    const rows = summarizeLedgerTurnover([
      entry([
        { account: "character:a:USD", anchorAmount: 10, role: "primary" },
        { account: "character:a:USD", anchorAmount: -5, role: "primary" },
      ]),
      entry([{ account: "character:a:USD", anchorAmount: 2.5, role: "primary" }]),
    ] as never);

    expect(rows).toEqual([{ account: "character:a:USD", turnover: 17.5 }]);
  });

  it("keeps accounts separate and does not classify them", () => {
    const rows = summarizeLedgerTurnover([
      entry([
        { account: "character:a:USD", anchorAmount: 10, role: "primary" },
        { account: "corporation:b:USD", anchorAmount: 30, role: "primary" },
        // Not a real account. Classification is monetaryActivity's job, not
        // this function's, so it must survive the roll-up.
        { account: "mint:c:USD", anchorAmount: 40, role: "primary" },
      ]),
    ] as never);

    expect(new Map(rows.map((r) => [r.account, r.turnover]))).toEqual(
      new Map([
        ["character:a:USD", 10],
        ["corporation:b:USD", 30],
        ["mint:c:USD", 40],
      ])
    );
  });

  it("returns nothing for an empty ledger", () => {
    expect(summarizeLedgerTurnover([])).toEqual([]);
  });
});

it("does not mix legacy money growth into the current median", () => {
  const money = {
    _id: "money",
    turn: 100,
    countryId: "US" as const,
    bankId: "US",
    currencyCode: "USD" as const,
    m1: 50,
    m2: 100,
    householdLiquid: 50,
    campaignLiquid: 0,
    nppLiquid: 0,
    corporateLiquid: 0,
    partyLiquid: 0,
    governmentLiquid: 0,
    fundLiquid: 0,
    organizationLiquid: 0,
    householdSavings: 0,
    externalBroadMoney: 50,
    bankDeposits: 0,
    bankReserves: 0,
    creditOutstanding: 0,
    sovereignBondsOutstanding: 0,
    centralBankBondHoldings: 0,
    bondPoolCash: 0,
    annualizedM2GrowthPct: 500,
    netMoneyCreatedLifetime: 0,
    createdAt: new Date(),
  };
  const snapshot = computeEconomicVitalSigns({
    ...emptyInput,
    money: [money, { ...money, _id: "new", accountingVersion: 2, annualizedM2GrowthPct: 4 }],
  });
  expect(snapshot.money.medianAnnualizedM2GrowthPct.value).toBe(4);
});
