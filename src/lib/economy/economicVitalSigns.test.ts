import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { computeEconomicVitalSigns } from "./economicVitalSigns";

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
          flows: [],
          itemizedFlowCount: 0,
          totalFlowCount: 0,
          createdAt: new Date(),
        },
      ],
      sectors: [],
      globalExchange: null,
      trades: [],
      bonds: [],
      globalWealth: null,
      money: [],
      health: null,
      reconciliation: null,
    });

    expect(snapshot.goods.pooledFillRate.value).toBe(0.5);
    expect(snapshot.goods.countryScopedFillRate.value).toBe(0.5);
    expect(snapshot.goods.medianPriceMultiple.value).toBe(2);
    expect(snapshot.trade.intentFulfillmentRate.value).toBe(0.5);
    expect(snapshot.trade.localShare.value).toBe(0.6);
    expect(snapshot.trade.toleranceBoundShareOfUnmet.value).toBe(0.8);
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
      bonds: [
        {
          _id: new ObjectId(),
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
          annualizedM2GrowthPct: 5,
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
    });

    expect(snapshot.firms.marketCapHhi.value).toBe(4200);
    expect(snapshot.firms.lossMakingShare.value).toBe(0.25);
    expect(snapshot.securities.activeTradedListingShare.value).toBe(0.25);
    expect(snapshot.securities.noHolderBondShare.value).toBe(1);
    expect(snapshot.households.topTenWealthShare.value).toBe(1);
    expect(snapshot.households.wealthGini.value).toBeCloseTo(0.72);
    expect(snapshot.money.creditToM2.value).toBe(0.25);
    expect(snapshot.reconciliation.status).toBe("unavailable");
  });
});
