import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { processBrettonWoodsTurn } from "./brettonWoodsTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

function rateDoc(countryId: string, currencyCode: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: countryId,
    countryId,
    currencyCode,
    rate: 1,
    baseRate: 1,
    macroTarget: 1,
    rateHistory: [],
    ...overrides,
  };
}

function bankDoc(countryId: string, overrides: Record<string, unknown> = {}) {
  return { _id: countryId, countryId, ...overrides };
}

function seed(opts: {
  flag?: boolean;
  commandEconomyEnabled?: boolean;
  rates?: Record<string, unknown>[];
  banks?: Record<string, unknown>[];
  usInflation?: number | null;
}) {
  db.collection("gameConfig");
  db.collectionMocks.gameConfig.findOne.mockResolvedValue(
    opts.flag === true
      ? {
          _id: "default",
          brettonWoodsExitEnabled: true,
          ...(opts.commandEconomyEnabled === true ? { commandEconomyEnabled: true } : {}),
        }
      : { _id: "default" }
  );
  db.collection("exchangeRates");
  db.collectionMocks.exchangeRates.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(opts.rates ?? []),
  });
  db.collection("centralBanks");
  db.collectionMocks.centralBanks.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(opts.banks ?? []),
  });
  db.collection("federalBudget");
  db.collectionMocks.federalBudget.findOne.mockResolvedValue(
    opts.usInflation == null
      ? null
      : { _id: "federal", economicFactors: { inflationRate: opts.usInflation } }
  );
}

const calmRates = () => [rateDoc("US", "USD"), rateDoc("UK", "GBP"), rateDoc("JP", "JPY")];

// A calm US reserve position with small foreign claims: the cover drain reads
// no pressure, so cover holds at full.
const calmBanks = () => [
  bankDoc("US", { reserveBalance: 100, forexRevenue: 0 }),
  bankDoc("UK", { spreadFeeReserveBalances: { USD: 10 } }),
];

function regimeWrites() {
  const calls = db.collectionMocks.exchangeRates.bulkWrite.mock.calls;
  if (calls.length === 0) return [];
  const ops = calls[0][0] as Array<{
    updateOne: { filter: unknown; update: { $set: Record<string, unknown> } };
  }>;
  return ops.filter((op) => "monetaryRegime" in op.updateOne.update.$set);
}

beforeEach(() => {
  db = createMockDb();
});

describe("processBrettonWoodsTurn gate", () => {
  it("flag off: single config read, zero writes, disabled result", async () => {
    db.collection("gameConfig");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({ _id: "default" });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res).toEqual({
      enabled: false,
      goldCover: null,
      suspended: [],
      floated: [],
      currenciesProcessed: 0,
    });
    // Nothing past gameConfig was even loaded, let alone written.
    expect(db.collectionMocks["centralBanks"]).toBeUndefined();
    expect(db.collectionMocks["federalBudget"]).toBeUndefined();
    expect(db.collectionMocks["exchangeRates"]).toBeUndefined();
  });

  it("absent flag behaves as off", async () => {
    db.collection("gameConfig");
    db.collectionMocks.gameConfig.findOne.mockResolvedValue(null);
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res.enabled).toBe(false);
    expect(db.collectionMocks["exchangeRates"]).toBeUndefined();
  });

  it("flag on with no exchange rows: enabled, null cover, no writes", async () => {
    seed({ flag: true, rates: [] });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res).toEqual({
      enabled: true,
      goldCover: null,
      suspended: [],
      floated: [],
      currenciesProcessed: 0,
    });
    expect(db.collectionMocks.exchangeRates.bulkWrite).not.toHaveBeenCalled();
  });
});

describe("gold cover tracking", () => {
  it("holds full cover in a calm world and re-persists it on the USD row", async () => {
    seed({ flag: true, rates: calmRates(), banks: calmBanks(), usInflation: null });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res.enabled).toBe(true);
    expect(res.goldCover).toBe(1);
    expect(res.suspended).toEqual([]);
    expect(res.currenciesProcessed).toBe(3);
    expect(db.collectionMocks.exchangeRates.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("drains cover under sustained foreign-claims pressure", async () => {
    seed({
      flag: true,
      rates: calmRates(),
      banks: [
        bankDoc("US", { reserveBalance: 100, forexRevenue: 0 }),
        bankDoc("UK", { spreadFeeReserveBalances: { USD: 500 } }),
      ],
      usInflation: null,
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res.goldCover).not.toBeNull();
    expect(res.goldCover as number).toBeLessThan(1);
  });
});

describe("suspend and float transitions", () => {
  it("suspends every participating currency once eligible with exhausted cover", async () => {
    seed({
      flag: true,
      rates: [rateDoc("US", "USD", { goldCover: 0.2 }), rateDoc("UK", "GBP"), rateDoc("JP", "JPY")],
      banks: calmBanks(),
      usInflation: null,
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 900, 1971);
    expect(res.suspended).toEqual(["JP", "UK", "US"]);
    expect(res.floated).toEqual([]);
    const writes = regimeWrites();
    expect(writes).toHaveLength(3);
    for (const op of writes) {
      expect(op.updateOne.update.$set["monetaryRegime"]).toBe("suspended");
      expect(op.updateOne.update.$set["monetaryRegimeSetAtTurn"]).toBe(900);
    }
  });

  it("does not suspend before the era window even with cover exhausted", async () => {
    seed({
      flag: true,
      rates: [rateDoc("US", "USD", { goldCover: 0.1 }), rateDoc("UK", "GBP")],
      banks: calmBanks(),
      usInflation: null,
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 100, 1960);
    expect(res.suspended).toEqual([]);
    expect(regimeWrites()).toEqual([]);
  });

  it("floats suspended currencies after the transition and never re-suspends", async () => {
    seed({
      flag: true,
      rates: [
        rateDoc("US", "USD", {
          goldCover: 0.1,
          monetaryRegime: "suspended",
          monetaryRegimeSetAtTurn: 900,
        }),
        rateDoc("UK", "GBP", { monetaryRegime: "suspended", monetaryRegimeSetAtTurn: 900 }),
        rateDoc("JP", "JPY", { monetaryRegime: "suspended", monetaryRegimeSetAtTurn: 900 }),
      ],
      banks: calmBanks(),
      usInflation: null,
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 990, 1973);
    expect(res.suspended).toEqual([]);
    expect(res.floated).toEqual(["JP", "UK", "US"]);
    const writes = regimeWrites();
    expect(writes).toHaveLength(3);
    for (const op of writes) {
      expect(op.updateOne.update.$set["monetaryRegime"]).toBe("floating");
    }
  });

  it("a floating world writes no transitions (idempotent re-run)", async () => {
    seed({
      flag: true,
      rates: [
        rateDoc("US", "USD", {
          goldCover: 0.1,
          monetaryRegime: "floating",
          monetaryRegimeSetAtTurn: 990,
        }),
        rateDoc("UK", "GBP", { monetaryRegime: "floating", monetaryRegimeSetAtTurn: 990 }),
      ],
      banks: calmBanks(),
      usInflation: null,
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 991, 1973);
    expect(res.suspended).toEqual([]);
    expect(res.floated).toEqual([]);
    expect(regimeWrites()).toEqual([]);
    // The stepped cover still re-persists on the USD row.
    expect(db.collectionMocks.exchangeRates.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("never drags command economies into the float", async () => {
    seed({
      flag: true,
      commandEconomyEnabled: true,
      rates: [rateDoc("US", "USD", { goldCover: 0.2 }), rateDoc("UK", "GBP"), rateDoc("RU", "RUB")],
      banks: calmBanks(),
      usInflation: null,
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 900, 1971);
    expect(res.suspended).toEqual(["UK", "US"]);
    expect(res.suspended).not.toContain("RU");
  });

  it("no USD row and no transitions: nothing to persist, no write call", async () => {
    seed({
      flag: true,
      rates: [rateDoc("UK", "GBP"), rateDoc("JP", "JPY")],
      banks: [],
      usInflation: null,
    });
    const res = await processBrettonWoodsTurn(db as unknown as Db, 720, 1960);
    expect(res.enabled).toBe(true);
    expect(res.goldCover).toBeNull();
    expect(res.currenciesProcessed).toBe(2);
    expect(db.collectionMocks.exchangeRates.bulkWrite).not.toHaveBeenCalled();
  });
});
