import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { LongHorizonContext } from "@/lib/telemetry/longHorizon/telemetry";
import { appendCountryTurnTelemetry, buildCountryTurnRows } from "./countryTurn";
import { appendSecurityTelemetry, buildSecurityTelemetryRowForTurn } from "./securities";
import { runResearchExport } from "./export";
import { calculateObjectSize } from "bson";
import { parseResearchQuery, RESEARCH_MAX_SECURITIES_PER_ROW } from "./rules";

const ctx = {
  worldId: "1991:iteration-1",
  sourceClass: "sandbox",
  runId: "run-9",
  seed: "seed-9",
  codeVersion: "deadbeef",
  preset: "1991",
  startingYear: 1991,
  year: 1992,
  foundingTurn: false,
  clock: {},
  governingByCountry: new Map(),
} as unknown as LongHorizonContext;

const observedAt = new Date("2026-10-02T00:00:00Z");

function seed(db: MockDb, name: string, docs: unknown[]) {
  db.collection(name).find().toArray.mockResolvedValue(docs);
}

function seedCountryWorld(db: MockDb) {
  seed(db, "centralBanks", [
    {
      _id: "US",
      countryId: "US",
      primeRate: 5.25,
      primeRateSmoothed: 5,
      lastRateChangeTurn: 100,
      chairMode: "npp",
      chairCharacterId: null,
      rateHistory: [
        {
          previousRate: 5,
          newRate: 5.25,
          changedBy: new ObjectId("000000000000000000000000"),
        },
      ],
    },
  ]);
  seed(db, "federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      fiscalYear: 3,
      revenue: { total: 1000, incomeTax: 600, tariffs: 40 },
      spending: { byCategory: { defense: 300 }, stateGrants: 100, debtInterest: 50, total: 950 },
      surplus: 50,
      gdp: 20000,
      gdpSmoothed: 19000,
      debtToGdpRatio: 0.5,
      creditRating: "AA",
      treasuryBalance: 75,
      debt: { principal: 9500, interestRate: 4 },
      economicFactors: { inflationRate: 3.1, wageGrowth: 2.5, tradeGrowth: 1.2, gdpGrowth: 2 },
    },
  ]);
  seed(db, "exchangeRates", [{ _id: "US", countryId: "US", currencyCode: "USD", rate: 1 }]);
  const ca = new ObjectId();
  const tx = new ObjectId();
  seed(db, "states", [
    { _id: ca, countryId: "US", gdp: 3, population: 40, outputGap: 1 },
    { _id: tx, countryId: "US", gdp: 1, population: 20, outputGap: -1 },
  ]);
  seed(db, "macroMetrics", [
    {
      _id: String(ca),
      economic: { unemploymentRate: { value: 6 }, gdpGrowth: { value: 2 } },
    },
    {
      _id: String(tx),
      economic: { unemploymentRate: { value: 9 }, gdpGrowth: { value: 4 } },
    },
  ]);
  seed(db, "bonds", [
    { countryId: "US", totalIssued: 1000, couponRate: 4.8, issuedAtTurn: 100 },
    { countryId: "US", totalIssued: 8500, couponRate: 4.8, issuedAtTurn: 50 },
  ]);
  seed(db, "conflicts", [
    { _id: "c1", sideA: { countries: ["US"] }, sideB: { countries: ["UK"] }, status: "active" },
  ]);
}

describe("buildCountryTurnRows", () => {
  it("assembles an aligned macro, monetary and fiscal row from one pass", async () => {
    const db = createMockDb();
    seedCountryWorld(db);
    const rows = await buildCountryTurnRows(db as unknown as Db, ctx, 100, observedAt);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      worldId: "1991:iteration-1",
      runId: "run-9",
      seed: "seed-9",
      codeVersion: "deadbeef",
      country: "US",
      turn: 100,
      year: 1992,
      currencyCode: "USD",
    });
    expect(row.macro).toMatchObject({
      inflationRate: 3.1,
      primeRate: 5.25,
      effectiveRate: 5,
      wageGrowth: 2.5,
      gdp: 20000,
    });
    // Population-weighted unemployment: (6 * 40 + 9 * 20) / 60 = 7.
    expect(row.macro.unemploymentRate).toBeCloseTo(7, 9);
    // GDP-weighted output gap: (1 * 3 + -1 * 1) / 4 = 0.5.
    expect(row.macro.outputGap).toBeCloseTo(0.5, 9);
    expect(row.monetary).toMatchObject({
      authority: "autonomous-chair",
      decision: "hike",
      rateChange: 0.25,
      rateChangeActor: "system",
    });
    expect(row.fiscal).toMatchObject({
      debtPrincipal: 9500,
      sovereignIssuedFace: 1000,
      primaryBalance: 100,
      debtToGdpDenominator: "gdpSmoothed",
      debtToGdpDenominatorValue: 19000,
    });
    expect(row.events).toEqual({ atWar: true, conflictIds: ["c1"] });
  });

  it("writes the rows by coordinate so a replayed turn does not duplicate", async () => {
    const db = createMockDb();
    seedCountryWorld(db);
    const written = await appendCountryTurnTelemetry(db as unknown as Db, ctx, 100, observedAt);
    expect(written).toBe(1);
    const [ops] = db.collectionMocks.countryTurnTelemetry.bulkWrite.mock.calls[0];
    expect(ops[0].replaceOne.filter).toEqual({
      worldId: "1991:iteration-1",
      country: "US",
      turn: 100,
    });
    expect(ops[0].replaceOne.upsert).toBe(true);
  });

  it("skips countries merged into a successor and writes nothing when none remain", async () => {
    const db = createMockDb();
    seed(db, "federalBudget", []);
    expect(await appendCountryTurnTelemetry(db as unknown as Db, ctx, 5, observedAt)).toBe(0);
    expect(db.collectionMocks.countryTurnTelemetry).toBeUndefined();
  });
});

describe("buildSecurityTelemetryRowForTurn", () => {
  const corpA = new ObjectId();
  const corpB = new ObjectId();
  const bondId = new ObjectId();

  function seedMarket(db: MockDb) {
    seed(db, "corporations", [
      {
        _id: corpA,
        countryId: "US",
        sharePrice: 50,
        totalShares: 1000,
        publicFloat: 100,
        liquidCurrencyCode: "USD",
        liquidCapital: 5000,
      },
      {
        _id: corpB,
        countryId: "UK",
        sharePrice: 20,
        totalShares: 500,
        publicFloat: 50,
        liquidCurrencyCode: "XXX",
        liquidCapital: 100,
      },
    ]);
    seed(db, "corporationHistory", [
      { corporationId: corpA, revenue: 900, income: 80, dividendPaidPerTurn: 100 },
    ]);
    seed(db, "shareTradeHistory", [
      { corporationId: corpA, shares: 10, totalAnchor: 520 },
      { corporationId: corpA, shares: 10, totalAnchor: 500 },
    ]);
    seed(db, "shareOrders", [
      { corporationId: corpA, type: "buy", pricePerShare: 49, sharesRemaining: 5 },
      {
        corporationId: corpA,
        type: "sell",
        pricePerShare: 51,
        sharesRemaining: 5,
        liquidityProvider: true,
      },
    ]);
    seed(db, "bonds", [
      {
        _id: bondId,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        couponRate: 4.8,
        maturityTurn: 500,
        marketPrice: 0.97,
        totalIssued: 10000,
        publicFloat: 4,
        defaulted: false,
        matured: false,
        holders: [{ units: 3, fundId: new ObjectId() }],
      },
    ]);
    seed(db, "bondMarketPools", [{ _id: "USD", cashLocal: 10, targetCashLocal: 12 }]);
    seed(db, "exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  }

  it("labels executed versus modeled prices and keeps missing FX explicit", async () => {
    const db = createMockDb();
    seedMarket(db);
    const row = await buildSecurityTelemetryRowForTurn(db as unknown as Db, ctx, 100, observedAt);
    const a = row.securities.find((s) => s.securityId === `equity:${corpA}`);
    const b = row.securities.find((s) => s.securityId === `equity:${corpB}`);
    expect(a).toMatchObject({
      priceBasis: "executed",
      fxStatus: "converted",
      executions: { count: 2, units: 20, vwapAnchor: 51 },
      distributionPerUnit: 0.1,
      modelPrice: 50,
    });
    expect(a?.price).toBe(51);
    expect(a?.book).toMatchObject({ twoSided: true, facilityQuoted: true });
    expect(a?.fundamentals).toMatchObject({ revenue: 900, income: 80, liquidCapital: 5000 });
    expect(b).toMatchObject({
      priceBasis: "model",
      fxStatus: "missing-fx",
      fxRate: null,
      price: 20,
      lastExecutedPriceAnchor: null,
    });
    expect(b?.distributionPerUnit).toBeNull();
  });

  it("records bonds as model marks with class-level holders only", async () => {
    const db = createMockDb();
    seedMarket(db);
    const row = await buildSecurityTelemetryRowForTurn(db as unknown as Db, ctx, 100, observedAt);
    const bond = row.securities.find((s) => s.assetClass === "bond");
    expect(bond).toMatchObject({
      priceBasis: "model",
      issuerType: "sovereign",
      issuerCountry: "US",
      unitsOutstanding: 10,
    });
    expect(bond?.price).toBeCloseTo(970, 6);
    expect(bond?.bond?.unitsByHolderClass).toEqual({ fund: 3, market_pool: 4 });
    expect(bond?.bond?.hasHolders).toBe(true);
    expect(JSON.stringify(bond)).not.toContain('holders":[');
    expect(row.pools).toEqual([
      { pool: "bond", currencyCode: "USD", cashLocal: 10, targetCashLocal: 12 },
    ]);
  });

  it("upserts one row per world and turn", async () => {
    const db = createMockDb();
    seedMarket(db);
    const count = await appendSecurityTelemetry(db as unknown as Db, ctx, 100, observedAt);
    expect(count).toBe(3);
    const [filter, , options] = db.collectionMocks.securityTelemetry.replaceOne.mock.calls[0];
    expect(filter).toEqual({ worldId: "1991:iteration-1", turn: 100 });
    expect(options).toEqual({ upsert: true });
  });
});

describe("runResearchExport", () => {
  function parse(params: Record<string, string>) {
    const parsed = parseResearchQuery(params, 100);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.query;
  }

  it("pages country-turn rows with a keyset cursor", async () => {
    const db = createMockDb();
    const rows = ["AA", "BB", "CC"].map((country) => ({ country, turn: 7 }));
    seed(db, "countryTurnTelemetry", rows);
    const out = await runResearchExport(
      db as unknown as Db,
      parse({ panel: "country-turn", limit: "2", fromTurn: "1", toTurn: "100" }),
      ctx
    );
    expect(out.rows).toHaveLength(2);
    expect(out.nextCursor).toBe("7:BB");
    expect(out.observedTurns).toEqual({ first: 7, last: 7, count: 1 });
    expect(out.units.missing).toContain("null");
    expect(out.provenance).toMatchObject({
      runId: "run-9",
      seed: "seed-9",
      codeVersion: "deadbeef",
    });
    expect(out.retention).toContain("world-raw-full");
    const filter = db.collectionMocks.countryTurnTelemetry.find.mock.calls.at(-1)?.[0];
    expect(filter.worldId).toBe("1991:iteration-1");
  });

  it("expands sourcing documents into explicit pair rows with observer metrics", async () => {
    const db = createMockDb();
    seed(db, "commoditySourcingFlows", [
      {
        commodity: "oil",
        turn: 60,
        createdAt: observedAt,
        demandUnitsIntent: 100,
        intraStateUnits: 50,
        interStateUnits: 10,
        importUnits: 20,
        unmetUnits: 20,
        toleranceBoundUnits: 5,
        capacityBoundUnits: 15,
        countryPairs: [
          {
            exporter: "US",
            importer: "UK",
            deliveredUnits: 20,
            dispatchedUnits: 20,
            askValue: 200,
            freightPaid: 10,
            tariffPaid: 4,
            landedValue: 214,
            tariffRateUnits: 40,
            legs: 1,
          },
        ],
        destinations: [
          {
            country: "UK",
            demandUnits: 60,
            supplyUnits: 10,
            foreignOfferUnits: 30,
            localUnits: 20,
            interStateUnits: 5,
            importUnits: 20,
            unmetUnits: 15,
            toleranceBoundUnits: 5,
            capacityBoundUnits: 10,
          },
          {
            country: "US",
            demandUnits: 40,
            supplyUnits: 80,
            foreignOfferUnits: 0,
            localUnits: 30,
            interStateUnits: 5,
            importUnits: 0,
            unmetUnits: 5,
            toleranceBoundUnits: 0,
            capacityBoundUnits: 5,
          },
        ],
      },
    ]);
    const out = await runResearchExport(
      db as unknown as Db,
      parse({ panel: "trade", fromTurn: "1", toTurn: "100" }),
      ctx
    );
    const rows = out.rows as Array<{
      exporter: string;
      importer: string;
      traded: boolean;
      turn: number;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.exporter === "UK" && r.importer === "US")?.traded).toBe(false);
    expect(rows.find((r) => r.exporter === "US" && r.importer === "UK")?.traded).toBe(true);
    expect(out.metrics).toMatchObject({ intentFulfillmentRate: 0.8 });
    expect(out.nextCursor).toBeNull();
  });

  it("builds annual fiscal rows from the window without paging", async () => {
    const db = createMockDb();
    seed(db, "countryTurnTelemetry", []);
    const out = await runResearchExport(
      db as unknown as Db,
      parse({ panel: "annual-fiscal" }),
      ctx
    );
    expect(out.rows).toEqual([]);
    expect(out.observedTurns.count).toBe(0);
    expect(out.nextCursor).toBeNull();
  });
});

describe("securities capture cost", () => {
  const BSON_LIMIT = 16 * 1024 * 1024;

  function seedScaled(db: MockDb, n: number) {
    const ids = Array.from({ length: n }, () => new ObjectId());
    const set = (name: string, docs: unknown[]) =>
      db.collection(name).find().toArray.mockResolvedValue(docs);
    set(
      "corporations",
      ids.map((_id) => ({
        _id,
        countryId: "US",
        sharePrice: 50.123456789,
        fundamentalSharePrice: 49.1,
        totalShares: 1_000_000,
        publicFloat: 1234,
        liquidCurrencyCode: "USD",
        liquidCapital: 5_000_000.123,
      }))
    );
    set(
      "corporationHistory",
      ids.map((corporationId) => ({
        corporationId,
        revenue: 9_000_000.1,
        income: 80_000.2,
        dividendPaidPerTurn: 100.5,
      }))
    );
    set(
      "shareTradeHistory",
      ids.flatMap((corporationId) => [
        { corporationId, shares: 10, totalAnchor: 520 },
        { corporationId, shares: 10, totalAnchor: 500 },
      ])
    );
    set(
      "shareOrders",
      ids.flatMap((corporationId) => [
        { corporationId, type: "buy", pricePerShare: 49, sharesRemaining: 5 },
        { corporationId, type: "sell", pricePerShare: 51, sharesRemaining: 5 },
      ])
    );
    set(
      "bonds",
      ids.map((_id) => ({
        _id,
        issuerType: "sovereign",
        countryId: "US",
        currencyCode: "USD",
        couponRate: 4.8,
        maturityTurn: 500,
        marketPrice: 0.97,
        totalIssued: 10_000,
        publicFloat: 4,
        holders: [{ units: 3, fundId: new ObjectId() }],
      }))
    );
    set("bondMarketPools", []);
    set("exchangeRates", [{ currencyCode: "USD", rate: 1 }]);
  }

  it("uses the same bounded number of reads and one write at any world size", async () => {
    const counts: number[] = [];
    for (const n of [5, 400]) {
      const db = createMockDb();
      seedScaled(db, n);
      for (const c of Object.values(db.collectionMocks)) c.find.mockClear();
      await appendSecurityTelemetry(db as unknown as Db, ctx, 100, observedAt);
      const reads = Object.values(db.collectionMocks).reduce(
        (a, c) => a + c.find.mock.calls.length,
        0
      );
      const writes = Object.values(db.collectionMocks).reduce(
        (a, c) => a + c.replaceOne.mock.calls.length + c.insertOne.mock.calls.length,
        0
      );
      const other = Object.values(db.collectionMocks).reduce(
        (a, c) =>
          a +
          c.findOne.mock.calls.length +
          c.countDocuments.mock.calls.length +
          c.aggregate.mock.calls.length +
          c.updateOne.mock.calls.length,
        0
      );
      expect(other).toBe(0);
      expect(writes).toBe(1);
      counts.push(reads);
    }
    expect(counts[0]).toBe(counts[1]);
    expect(counts[0]).toBe(7);
  });

  it("keeps a 5000-equity plus 5000-bond row far under the BSON document limit", async () => {
    const db = createMockDb();
    seedScaled(db, 5000);
    const row = await buildSecurityTelemetryRowForTurn(db as unknown as Db, ctx, 100, observedAt);
    expect(row.securities).toHaveLength(10_000);
    const bytes = calculateObjectSize(row as never);
    expect(bytes).toBeLessThan(BSON_LIMIT / 2);
    expect(RESEARCH_MAX_SECURITIES_PER_ROW * (bytes / 10_000)).toBeLessThan(BSON_LIMIT);
  });

  it("fails loudly above the per-document ceiling", async () => {
    const db = createMockDb();
    seedScaled(db, RESEARCH_MAX_SECURITIES_PER_ROW / 2 + 1);
    await expect(
      buildSecurityTelemetryRowForTurn(db as unknown as Db, ctx, 100, observedAt)
    ).rejects.toThrow(/per-document ceiling/);
  });
});
