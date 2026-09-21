import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { MONEY_ACCOUNTING_VERSION } from "@/lib/moneySupply/calculate";
import type { Bond } from "@/lib/db/types";
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

function historyRow(
  turn: number,
  depthToMarketCap: number,
  corporateNoHolderBondShare: number | null = 0.2
): VitalSignsHistoryRow {
  return {
    turn,
    depthToMarketCap,
    twoSidedListingShare: 0.5,
    activeTradedListingShare: 0.5,
    sovereignNoHolderBondShare: 0.1,
    corporateNoHolderBondShare,
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
      firmIncome: listings.map((listing, index) => ({
        corporationId: listing._id.toString(),
        // Deliberately disagree with the reconstructed listing sign: the
        // persisted same-turn result is authoritative for this metric.
        income: index === 0 ? -50 : index === 2 ? 0 : 50,
      })),
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
          accountingVersion: MONEY_ACCOUNTING_VERSION,
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
    expect(snapshot.firms.lossMakingShare.observations).toBe(4);
    expect(snapshot.firms.lossMakingShare.basis).toBe(
      "same_turn_listed_corporation_history_income"
    );
    expect(snapshot.securities.activeTradedListingShare.value).toBe(0.25);
    expect(snapshot.securities.noHolderBondShare.value).toBe(1);
    expect(snapshot.securities.bondSubscriptionRate.value).toBe(0);
    expect(snapshot.securities.sovereignMedianHolders.value).toBe(0);
    expect(snapshot.securities.sovereignSubscriptionRate.value).toBe(0);
    expect(snapshot.securities.sovereignMaturityHhi.value).toBe(10_000);
    expect(snapshot.securities.corporateMaturityHhi.value).toBeNull();
    expect(snapshot.securities.corporateMaturityHhi.observations).toBe(0);
    expect(snapshot.securities.sovereignMedianPriceToParSpreadPct.value).toBe(0);
    expect(snapshot.securities.sovereignIssuanceByCountry).toEqual([
      {
        countryId: "US",
        issueCount: 1,
        unheldIssueCount: 1,
        noHolderShare: 1,
        subscriptionRate: 0,
        medianHolders: 0,
        medianSpreadToParPct: 0,
        maturityHhi: 10_000,
        thinIssueCount: 1,
      },
    ]);
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
      publicFloat: 500,
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
    expect(snapshot.securities.corporateMedianPriceToParSpreadPct.value).toBeNull();
    expect(snapshot.securities.corporateMedianPriceToParSpreadPct.observations).toBe(0);
    expect(snapshot.securities.corporateMaturityHhi.value).toBeNull();
    expect(snapshot.securities.corporateMaturityHhi.observations).toBe(0);
  });

  it("prices corporate credit with the same spread basis as sovereign issues", () => {
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
        // 10pp discount, 5pp premium, par: median spread is 0.
        bond({ marketPrice: 0.9 }),
        bond({ marketPrice: 1.05 }),
        // Legacy corporate rows omit issuerType and still count as corporate.
        bond({ marketPrice: 1.0 }),
        bond({ issuerType: "sovereign", marketPrice: 0.8 }),
      ] as never,
    });

    expect(snapshot.securities.corporateMedianPriceToParSpreadPct.value).toBe(0);
    expect(snapshot.securities.corporateMedianPriceToParSpreadPct.observations).toBe(3);
    expect(snapshot.securities.corporateMedianPriceToParSpreadPct.basis).toBe(
      "unmatured_corporate_issue_count"
    );
    // The sovereign leg is excluded from the corporate read and priced on its own basis.
    expect(snapshot.securities.sovereignMedianPriceToParSpreadPct.value).toBeCloseTo(20, 10);
    expect(snapshot.securities.sovereignMedianPriceToParSpreadPct.observations).toBe(1);
  });

  it("medians an even corporate spread sample instead of picking a side", () => {
    const corpId = new ObjectId();
    const bond = (marketPrice: number) => ({
      _id: new ObjectId(),
      corporationId: corpId,
      faceValue: 1_000,
      couponRate: 4,
      maturityTurns: 96,
      issuedAtTurn: 1,
      maturityTurn: 97,
      marketPrice,
      totalIssued: 10_000,
      publicFloat: 0,
      holders: [],
      defaulted: false,
      defaultedAtTurn: null,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      bonds: [bond(0.9), bond(1.05)] as never,
    });

    // Spreads [10, -5] median to 2.5; a premium reads as a negative discount, not zero.
    expect(snapshot.securities.corporateMedianPriceToParSpreadPct.value).toBeCloseTo(2.5, 10);
    expect(snapshot.securities.corporateMedianPriceToParSpreadPct.observations).toBe(2);
  });

  it("narrows the corporate spread sample to finite prices, never to zero", () => {
    const corpId = new ObjectId();
    const bond = (marketPrice: number) => ({
      _id: new ObjectId(),
      corporationId: corpId,
      faceValue: 1_000,
      couponRate: 4,
      maturityTurns: 96,
      issuedAtTurn: 1,
      maturityTurn: 97,
      marketPrice,
      totalIssued: 10_000,
      publicFloat: 0,
      holders: [],
      defaulted: false,
      defaultedAtTurn: null,
      matured: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const partial = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      bonds: [bond(Number.NaN), bond(0.9)] as never,
    });

    expect(partial.securities.corporateMedianPriceToParSpreadPct.value).toBeCloseTo(10, 10);
    expect(partial.securities.corporateMedianPriceToParSpreadPct.observations).toBe(2);

    const unpriced = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      bonds: [bond(Number.NaN)] as never,
    });

    expect(unpriced.securities.corporateMedianPriceToParSpreadPct.value).toBeNull();
    expect(unpriced.securities.corporateMedianPriceToParSpreadPct.observations).toBe(1);
  });

  it("concentrates corporate refinancing by maturity turn, excluding sovereign face", () => {
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
    // Two equal corporate buckets across two maturity turns: HHI 5,000.
    // The sovereign leg shares a maturity turn but must not move the read.
    const split = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      bonds: [
        bond({ maturityTurn: 97, totalIssued: 10_000 }),
        bond({ maturityTurn: 98, totalIssued: 10_000 }),
        bond({ issuerType: "sovereign", maturityTurn: 97, totalIssued: 1_000_000 }),
      ] as never,
    });
    expect(split.securities.corporateMaturityHhi.value).toBe(5_000);
    expect(split.securities.corporateMaturityHhi.observations).toBe(2);
    expect(split.securities.corporateMaturityHhi.basis).toBe("corporate_face_by_maturity_turn");

    // One maturity turn holds all corporate face: a full refinancing cliff.
    const cliff = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      bonds: [
        bond({ maturityTurn: 97, totalIssued: 10_000 }),
        bond({ maturityTurn: 97, totalIssued: 30_000 }),
      ] as never,
    });
    expect(cliff.securities.corporateMaturityHhi.value).toBe(10_000);
    expect(cliff.securities.corporateMaturityHhi.observations).toBe(1);
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

  it("measures per-listing trade concentration from named counterparties", () => {
    const concentratedId = new ObjectId();
    const sharedId = new ObjectId();
    const alice = { characterId: new ObjectId(), name: "Alice" };
    const bob = { characterId: new ObjectId(), name: "Bob" };
    const carol = { characterId: new ObjectId(), name: "Carol" };
    const dave = { characterId: new ObjectId(), name: "Dave" };
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      globalExchange: {
        _id: "global",
        listings: [
          { _id: concentratedId, totalShares: 1_000, publicFloat: 500 },
          { _id: sharedId, totalShares: 1_000, publicFloat: 500 },
        ],
        updatedAt: new Date(),
      } as never,
      trades: [
        // Concentrated book: Alice takes 90 of 100 notional from the float.
        {
          _id: new ObjectId(),
          corporationId: concentratedId,
          kind: "market_buy",
          turn: 29,
          createdAt: new Date(),
          shares: 90,
          pricePerShareAnchor: 1,
          totalAnchor: 90,
          to: alice,
          from: null,
        },
        {
          _id: new ObjectId(),
          corporationId: concentratedId,
          kind: "market_buy",
          turn: 29,
          createdAt: new Date(),
          shares: 10,
          pricePerShareAnchor: 1,
          totalAnchor: 10,
          to: bob,
          from: null,
        },
        // Shared book: Carol and Dave split 100 evenly across one peer fill.
        {
          _id: new ObjectId(),
          corporationId: sharedId,
          kind: "peer_fill",
          turn: 29,
          createdAt: new Date(),
          shares: 100,
          pricePerShareAnchor: 1,
          totalAnchor: 100,
          to: dave,
          from: carol,
        },
        // Non-economic kinds never count toward inventory concentration.
        {
          _id: new ObjectId(),
          corporationId: sharedId,
          kind: "issuance",
          turn: 29,
          createdAt: new Date(),
          shares: 1_000,
          pricePerShareAnchor: 1,
          totalAnchor: 1_000,
          to: carol,
          from: null,
        },
      ],
    });

    // Top shares [0.9, 0.5]: median 0.7 across the two traded listings.
    expect(snapshot.securities.medianTopTraderNotionalShare48.value).toBeCloseTo(0.7, 10);
    expect(snapshot.securities.medianTopTraderNotionalShare48.observations).toBe(2);
    expect(snapshot.securities.medianTopTraderNotionalShare48.basis).toBe(
      "named_counterparty_share_of_listing_notional_48_turns"
    );
  });

  it("reports absent equity trade concentration as unknown, not as dispersed", () => {
    const corpId = new ObjectId();
    const floatOnly = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 30,
      globalExchange: {
        _id: "global",
        listings: [{ _id: corpId, totalShares: 1_000, publicFloat: 500 }],
        updatedAt: new Date(),
      } as never,
      trades: [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          kind: "market_buy",
          turn: 29,
          createdAt: new Date(),
          shares: 1,
          pricePerShareAnchor: 1,
          totalAnchor: 10,
          to: null,
          from: null,
        },
      ],
    });

    expect(floatOnly.securities.medianTopTraderNotionalShare48.value).toBeNull();
    expect(floatOnly.securities.medianTopTraderNotionalShare48.observations).toBe(0);

    const empty = computeEconomicVitalSigns({ ...emptyInput, turn: 30 });
    expect(empty.securities.medianTopTraderNotionalShare48.value).toBeNull();
    expect(empty.securities.medianTopTraderNotionalShare48.observations).toBe(0);
  });

  it("medians the corporate no-holder share so one spiky turn cannot anchor a baseline", () => {
    const history: VitalSignsHistoryRow[] = [];
    for (let turn = 19; turn <= 29; turn += 1) {
      // One turn where every corporate issue sits holderless; the rest sit at 0.4.
      history.push(historyRow(turn, 0.1, turn === 25 ? 1 : 0.4));
    }

    // No bonds this turn, so the median comes from the 11 history rows alone:
    // ten at 0.4 plus one spike at 1 medians to 0.4.
    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30, history });

    expect(snapshot.securitiesRecent12.corporateNoHolderBondShareMedian.value).toBe(0.4);
    expect(snapshot.securitiesRecent12.corporateNoHolderBondShareMedian.observations).toBe(11);
    expect(snapshot.securitiesRecent12.corporateNoHolderBondShareMedian.basis).toBe(
      "unmatured_corporate_issue_count_median_12"
    );
    // The sovereign leg keeps its own baseline from the same history rows.
    expect(snapshot.securitiesRecent12.sovereignNoHolderBondShareMedian.value).toBe(0.1);
  });

  it("reports an absent corporate no-holder baseline as unknown, not as zero", () => {
    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30 });

    expect(snapshot.securities.corporateNoHolderBondShare.value).toBeNull();
    expect(snapshot.securities.corporateNoHolderBondShare.observations).toBe(0);
    expect(snapshot.securitiesRecent12.corporateNoHolderBondShareMedian.value).toBeNull();
    expect(snapshot.securitiesRecent12.corporateNoHolderBondShareMedian.observations).toBe(0);
  });

  it("skips pre-field history rows instead of reading them as dispersed holders", () => {
    // Snapshots persisted before the corporate leg existed carry no value.
    const history: VitalSignsHistoryRow[] = [];
    for (let turn = 27; turn <= 29; turn += 1) {
      history.push(historyRow(turn, 0.1, turn === 29 ? 0.6 : null));
    }

    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30, history });

    // Only turn 29 contributes; the null rows narrow the sample instead of
    // reading as zero holderless issues.
    expect(snapshot.securitiesRecent12.corporateNoHolderBondShareMedian.value).toBe(0.6);
    expect(snapshot.securitiesRecent12.corporateNoHolderBondShareMedian.observations).toBe(1);
  });

  it("records a skipped stock versus flow check as unknown, not as zero divergences", () => {
    const reconciliation: LedgerReconciliation = {
      _id: new ObjectId(),
      turn: 30,
      generatedAt: new Date("2026-08-29T00:00:00.000Z"),
      bankingMode: null,
      status: "amber",
      entriesChecked: 0,
      trialBalance: { status: "green", unbalancedCount: 0, findings: [] },
      stockVsFlow: {
        status: "amber",
        skipped: true,
        divergentCount: null,
        findings: [],
        byKind: [],
      },
      moneySupply: { status: "green", findings: [] },
      unattributed: [],
    };

    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30, reconciliation });

    expect(snapshot.reconciliation.stockVsFlowDivergentCount).toBeNull();
    expect(snapshot.reconciliation.stockVsFlowSkipped).toBe(true);
    expect(snapshot.reconciliation.stockVsFlowByKind).toBeNull();
    expect(snapshot.measurement.reasons).toContain("stock_vs_flow_skipped");
  });

  it("publishes the pre-cap per-kind stock versus flow inventory in vital signs", () => {
    const reconciliation: LedgerReconciliation = {
      _id: new ObjectId(),
      turn: 30,
      generatedAt: new Date("2026-08-29T00:00:00.000Z"),
      bankingMode: null,
      status: "amber",
      entriesChecked: 12,
      trialBalance: { status: "green", unbalancedCount: 0, findings: [] },
      stockVsFlow: {
        status: "amber",
        skipped: false,
        divergentCount: 120,
        findings: [],
        byKind: [
          {
            kind: "corporation",
            divergentCount: 90,
            absDivergence: 9000,
            uninstrumentedCount: 90,
          },
          { kind: "character", divergentCount: 30, absDivergence: 300, uninstrumentedCount: 5 },
        ],
      },
      moneySupply: { status: "green", findings: [] },
      unattributed: [],
    };

    const snapshot = computeEconomicVitalSigns({ ...emptyInput, turn: 30, reconciliation });

    expect(snapshot.reconciliation.stockVsFlowDivergentCount).toBe(120);
    expect(snapshot.reconciliation.stockVsFlowByKind).toEqual(reconciliation.stockVsFlow.byKind);
  });
});

describe("sovereign demand gaps", () => {
  const gapBonds = (): Bond[] => [
    {
      _id: new ObjectId(),
      issuerType: "sovereign",
      countryId: "US",
      corporationId: new ObjectId(),
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
      currencyCode: "USD",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  it("attaches demandGapByReason when sovereign demand inputs are present", () => {
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      bonds: gapBonds(),
      sovereignDemand: {
        funds: [],
        fundIdToKey: new Map(),
        tradableCurrencies: ["USD"],
        controlledCurrencies: [],
        ratingByCountry: new Map(),
        crossBorderEnabled: false,
      },
    });
    expect(snapshot.securities.sovereignIssuanceByCountry).toEqual([
      expect.objectContaining({
        countryId: "US",
        unheldIssueCount: 1,
        demandGapByReason: { no_domestic_fund: 1 },
      }),
    ]);
  });

  it("omits demandGapByReason without sovereign demand inputs", () => {
    const snapshot = computeEconomicVitalSigns({ ...emptyInput, bonds: gapBonds() });
    expect(snapshot.securities.sovereignIssuanceByCountry).toEqual([
      expect.objectContaining({ countryId: "US", unheldIssueCount: 1 }),
    ]);
    expect(snapshot.securities.sovereignIssuanceByCountry?.[0]?.demandGapByReason).toBeUndefined();
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
    money: [
      money,
      {
        ...money,
        _id: "new",
        accountingVersion: MONEY_ACCOUNTING_VERSION,
        annualizedM2GrowthPct: 4,
      },
    ],
  });
  expect(snapshot.money.medianAnnualizedM2GrowthPct.value).toBe(4);
});

it("reports the bond-pool exclusion with per-currency observation versions", () => {
  const row = (overrides: Record<string, unknown>) => ({
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
    annualizedM2GrowthPct: null,
    netMoneyCreatedLifetime: 0,
    createdAt: new Date(),
    ...overrides,
  });
  const snapshot = computeEconomicVitalSigns({
    ...emptyInput,
    money: [
      row({
        _id: "usd",
        accountingVersion: MONEY_ACCOUNTING_VERSION,
        annualizedM2GrowthPct: 4,
        excludedBondPoolCash: 100,
      }),
      // Current method but still warming up: no comparable growth yet.
      row({
        _id: "huf",
        countryId: "HU" as const,
        currencyCode: "HUF" as const,
        accountingVersion: MONEY_ACCOUNTING_VERSION,
        excludedBondPoolCash: 4_700_000_000,
      }),
      // Legacy v2 row: keeps its level, never feeds growth, contributes no exclusion.
      row({
        _id: "plz",
        countryId: "PL" as const,
        currencyCode: "PLZ" as const,
        accountingVersion: 2,
        annualizedM2GrowthPct: 500,
      }),
    ],
  });
  expect(snapshot.money.excludedBondPoolCash.value).toBe(4_700_000_100);
  expect(snapshot.money.currentAccountingCurrencies).toBe(2);
  expect(snapshot.money.comparableGrowthCurrencies).toBe(1);
  expect(snapshot.money.medianAnnualizedM2GrowthPct.value).toBe(4);
  expect(snapshot.money.observationVersions).toEqual({
    USD: MONEY_ACCOUNTING_VERSION,
    HUF: MONEY_ACCOUNTING_VERSION,
    PLZ: 2,
  });
  expect(snapshot.money.observationConfidence).toEqual({ USD: "high", HUF: "medium", PLZ: "low" });
  expect(snapshot.measurement.reasons).toContain("money_observation_version_transition");
  expect(snapshot.measurement.reasons).toContain("money_growth_awaiting_comparable_window");
});

describe("ring-fenced bank and escrow money", () => {
  const balanceSnapshot = {
    _id: new ObjectId(),
    turn: 100,
    createdAt: new Date(),
    balances: {
      "character:active:USD": 40,
      "character:dormant:USD": 60,
      "corporation:active:USD": 100,
    },
  };

  it("reports active-charter reserves and escrow in anchor with FX conversion", () => {
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      balanceSnapshot,
      anchorRates: { USD: 1, EUR: 2 },
      ringFenced: [
        {
          charterActive: true,
          charterCurrency: "USD",
          cashReserves: 100,
          liquidCurrency: "USD",
          escrowBalance: 50,
        },
        {
          charterActive: true,
          charterCurrency: "EUR",
          cashReserves: 200,
          liquidCurrency: "EUR",
          escrowBalance: undefined,
        },
        {
          charterActive: false,
          charterCurrency: "USD",
          cashReserves: 500,
          liquidCurrency: "USD",
          escrowBalance: undefined,
        },
        {
          charterActive: false,
          charterCurrency: "USD",
          cashReserves: undefined,
          liquidCurrency: "USD",
          escrowBalance: -30,
        },
      ],
    });

    // 100 USD + 200 EUR / 2; the failed charter and the buyback debt are excluded.
    expect(snapshot.money.bankCashReservesAnchor.value).toBe(200);
    expect(snapshot.money.bankCashReservesAnchor.observations).toBe(2);
    expect(snapshot.money.escrowCashAnchor.value).toBe(50);
    expect(snapshot.money.escrowCashAnchor.observations).toBe(1);
    // (200 + 50) / (200 modeled + 200 + 50).
    expect(snapshot.money.ringFencedShareOfLiquid.value).toBeCloseTo(250 / 450);
    expect(snapshot.measurement.reasons).not.toContainEqual(
      expect.stringMatching(/^bank_cash_incomplete_/)
    );
  });

  it("flags incomplete bank classification and fails the share closed", () => {
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      balanceSnapshot,
      anchorRates: { USD: 1 },
      ringFenced: [
        {
          charterActive: true,
          charterCurrency: "USD",
          cashReserves: 100,
          liquidCurrency: "USD",
          escrowBalance: undefined,
        },
        {
          charterActive: true,
          charterCurrency: "USD",
          cashReserves: undefined,
          liquidCurrency: "USD",
          escrowBalance: undefined,
        },
      ],
    });

    expect(snapshot.money.bankCashReservesAnchor.value).toBe(100);
    expect(snapshot.money.bankCashReservesAnchor.observations).toBe(1);
    expect(snapshot.money.ringFencedShareOfLiquid.value).toBeNull();
    expect(snapshot.measurement.reasons).toContain("bank_cash_incomplete_1_of_2_reporting");
  });

  it("reports unknown bank stock and share when no active charter reports", () => {
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      balanceSnapshot,
      anchorRates: { USD: 1 },
      ringFenced: [
        {
          charterActive: true,
          charterCurrency: "USD",
          cashReserves: undefined,
          liquidCurrency: "USD",
          escrowBalance: undefined,
        },
      ],
    });

    expect(snapshot.money.bankCashReservesAnchor.value).toBeNull();
    expect(snapshot.money.ringFencedShareOfLiquid.value).toBeNull();
    expect(snapshot.measurement.reasons).toContain("bank_cash_incomplete_0_of_1_reporting");
  });

  it("fails the share closed without a balance snapshot and leaves a null velocity seam", () => {
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      balanceSnapshot: null,
      anchorRates: { USD: 1 },
      ringFenced: [
        {
          charterActive: true,
          charterCurrency: "USD",
          cashReserves: 100,
          liquidCurrency: "USD",
          escrowBalance: undefined,
        },
      ],
    });

    expect(snapshot.money.bankCashReservesAnchor.value).toBe(100);
    expect(snapshot.money.ringFencedShareOfLiquid.value).toBeNull();
    // No ledger turnover feed covers bank accounts, so velocity stays an
    // explicit null seam instead of an estimate from unrelated flows.
    expect(snapshot.money.bankGrossVelocity48.value).toBeNull();
    expect(snapshot.money.bankGrossVelocity48.observations).toBe(0);
    expect(snapshot.money.bankGrossVelocity48.basis).toBe("bank_turnover_not_in_ledger");
  });

  it("reports honest zeros when no bank or escrow money exists", () => {
    const snapshot = computeEconomicVitalSigns({ ...emptyInput, balanceSnapshot, ringFenced: [] });

    expect(snapshot.money.bankCashReservesAnchor.value).toBe(0);
    expect(snapshot.money.bankCashReservesAnchor.observations).toBe(0);
    expect(snapshot.money.escrowCashAnchor.value).toBe(0);
    expect(snapshot.money.ringFencedShareOfLiquid.value).toBe(0);
    expect(snapshot.measurement.reasons).not.toContainEqual(
      expect.stringMatching(/^bank_cash_incomplete_/)
    );
  });
  it("measures securities breadth over tradable listings, intersecting the trade window", () => {
    // Mixed snapshot (#2033): three ordinary public corporations, two
    // zero-share/zero-float state enterprises, and a retained-window trade for
    // a dissolved corporation that is no longer listed at all.
    const tradableIds = [new ObjectId(), new ObjectId(), new ObjectId()];
    const soeIds = [new ObjectId(), new ObjectId()];
    const dissolvedId = new ObjectId();
    const listing = (id: ObjectId, overrides: object) => ({
      _id: id,
      sequentialId: 1,
      name: `Firm ${id.toString()}`,
      type: "manufacturing",
      sharePrice: 10,
      sharePriceAnchor: 10,
      totalShares: 1000,
      publicFloat: 500,
      marketCapAnchor: 10000,
      priceChange48h: 0,
      ...overrides,
    });
    const listings = [
      listing(tradableIds[0]!, {}),
      listing(tradableIds[1]!, {}),
      listing(tradableIds[2]!, {}),
      listing(soeIds[0]!, { totalShares: 0, publicFloat: 0, isNatcorp: true }),
      listing(soeIds[1]!, { totalShares: 1000, publicFloat: 0, isNatcorp: true }),
    ];
    const trade = (corporationId: ObjectId) =>
      ({
        _id: new ObjectId(),
        corporationId,
        kind: "market_buy",
        turn: 99,
        createdAt: new Date(),
        shares: 2,
        pricePerShareAnchor: 5,
        totalAnchor: 10,
        to: null,
        from: null,
      }) as never;
    const order = (corporationId: ObjectId, type: "buy" | "sell") =>
      ({
        _id: new ObjectId(),
        corporationId,
        characterId: new ObjectId(),
        type,
        shares: 10,
        sharesRemaining: 10,
        pricePerShare: type === "buy" ? 9 : 11,
        escrowAmount: 0,
        status: "open" as const,
        createdAt: new Date("2026-08-29T00:00:00.000Z"),
        updatedAt: new Date("2026-08-29T00:00:00.000Z"),
      }) as never;

    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 100,
      globalExchange: { _id: "global", listings } as never,
      // Two eligible listings traded; the SOE trade and the dissolved-corp
      // trade sit in the retained window but must not enter the numerator.
      trades: [
        trade(tradableIds[0]!),
        trade(tradableIds[1]!),
        trade(soeIds[0]!),
        trade(dissolvedId),
      ],
      shareOrders: [
        // Only the first eligible listing has both sides of the book. The
        // zero-share SOE also carries a two-sided book, which must not count.
        order(tradableIds[0]!, "buy"),
        order(tradableIds[0]!, "sell"),
        order(tradableIds[1]!, "buy"),
        order(soeIds[0]!, "buy"),
        order(soeIds[0]!, "sell"),
      ],
    });

    // Denominator 3 (eligible), numerator 2 (eligible traded): 2/3, not 4/5
    // and not the stale 3-or-4 over 5.
    expect(snapshot.securities.activeTradedListingShare.value).toBeCloseTo(2 / 3, 10);
    expect(snapshot.securities.activeTradedListingShare.observations).toBe(3);
    expect(snapshot.securities.twoSidedListingShare.value).toBeCloseTo(1 / 3, 10);
    expect(snapshot.securities.twoSidedListingShare.observations).toBe(3);
    expect(snapshot.securities.organicTwoSidedListingShare.value).toBeCloseTo(1 / 3, 10);
    // Rolling medians use the same eligible denominator with empty history.
    expect(snapshot.securitiesRecent12.activeTradedListingShareMedian.value).toBeCloseTo(2 / 3, 10);
    expect(snapshot.securitiesRecent12.twoSidedListingShareMedian.value).toBeCloseTo(1 / 3, 10);
    for (const metric of [
      snapshot.securities.activeTradedListingShare,
      snapshot.securities.twoSidedListingShare,
      snapshot.securities.organicTwoSidedListingShare,
    ]) {
      expect(metric.value).toBeGreaterThanOrEqual(0);
      expect(metric.value).toBeLessThanOrEqual(1);
    }
  });

  it("reports unknown breadth when no listing is tradable", () => {
    const id = new ObjectId();
    const snapshot = computeEconomicVitalSigns({
      ...emptyInput,
      turn: 100,
      globalExchange: {
        _id: "global",
        listings: [
          {
            _id: id,
            sequentialId: 1,
            name: "SoE",
            type: "manufacturing",
            sharePrice: 10,
            totalShares: 0,
            publicFloat: 0,
            marketCapAnchor: 0,
            priceChange48h: 0,
          },
        ],
      } as never,
      trades: [],
      shareOrders: [],
    });

    expect(snapshot.securities.activeTradedListingShare.value).toBeNull();
    expect(snapshot.securities.twoSidedListingShare.value).toBeNull();
    expect(snapshot.securities.organicTwoSidedListingShare.value).toBeNull();
  });
});
