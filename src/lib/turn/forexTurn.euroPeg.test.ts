import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { processForexTurn } from "./forexTurn";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// Match forexTurn.test.ts: avoid second-order DB mocking.
vi.mock("@/lib/currency/volumeTracker", () => ({
  computeCurrencyVolumes: vi.fn().mockResolvedValue({
    USD: { buyVolume24: 0, sellVolume24: 0 },
    GBP: { buyVolume24: 0, sellVolume24: 0 },
    JPY: { buyVolume24: 0, sellVolume24: 0 },
    EUR: { buyVolume24: 0, sellVolume24: 0 },
  }),
}));

let db: MockDb;

function makeCentralBank(countryId: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: countryId,
    countryId,
    primeRate: 2.5,
    inflationHistory: [{ turn: 49, rate: 2.0 }],
    gdpGrowthHistory: [{ turn: 49, rate: 2.5 }],
    tradeGrowth: 0,
    forexRevenue: 0,
    reserveBalance: 0,
    ...overrides,
  };
}

function makeExchangeRate(
  countryId: string,
  currencyCode: string,
  rate: number,
  baseRate: number,
  overrides: Record<string, unknown> = {}
) {
  return {
    _id: countryId,
    countryId,
    currencyCode,
    rate,
    baseRate,
    macroTarget: rate,
    rateHistory: [],
    buyVolume24: 0,
    sellVolume24: 0,
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockEuroBanksAndRates(options: { frCode?: string; itCode?: string } = {}) {
  const { frCode = "EUR", itCode = "EUR" } = options;
  const banks = [makeCentralBank("DE"), makeCentralBank("FR"), makeCentralBank("IT")];
  db.collectionMocks.centralBanks.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(banks),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
  // Followers start drifted off the anchor to prove the peg pulls them back.
  db.collectionMocks.exchangeRates.find.mockReturnValue({
    toArray: vi
      .fn()
      .mockResolvedValue([
        makeExchangeRate("DE", "EUR", 0.92, 0.92),
        makeExchangeRate("FR", frCode, 1.5, frCode === "EUR" ? 0.92 : 4.2),
        makeExchangeRate("IT", itCode, 0.5, itCode === "EUR" ? 0.92 : 833),
      ]),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
}

function rateUpdateFor(countryId: string) {
  const call = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
    (c: Array<{ _id: string }>) => c[0]._id === countryId
  );
  return call?.[1].$set as Record<string, unknown> | undefined;
}

beforeEach(() => {
  db = createMockDb();
  db.collection("centralBanks");
  db.collection("exchangeRates");
  db.collection("currencyOrders");
  db.collection("tradeHistory");
  db.collection("characters");

  db.collectionMocks.currencyOrders.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
    sort: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    }),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
});

describe("euro follower live peg", () => {
  it("publishes DE's post-update rate and macro target on every 2027 follower", async () => {
    mockEuroBanksAndRates();
    const result = await processForexTurn(db as unknown as Db, 50, "2027-default");

    expect(result.countriesUpdated).toBe(3);
    const de = rateUpdateFor("DE");
    const fr = rateUpdateFor("FR");
    const it = rateUpdateFor("IT");
    expect(de).toBeDefined();
    expect(fr?.rate).toBe(de?.rate);
    expect(it?.rate).toBe(de?.rate);
    expect(fr?.macroTarget).toBe(de?.macroTarget);
    expect(it?.macroTarget).toBe(de?.macroTarget);
    // Already-EUR rows are not rewritten.
    expect(fr).not.toHaveProperty("currencyCode");
  });

  it("heals a pre-fix legacy code on the same write that pegs the rate", async () => {
    mockEuroBanksAndRates({ frCode: "EUR", itCode: "ITL" });
    await processForexTurn(db as unknown as Db, 50, "2027-default");

    const de = rateUpdateFor("DE");
    const it = rateUpdateFor("IT");
    expect(it?.rate).toBe(de?.rate);
    expect(it?.currencyCode).toBe("EUR");
  });

  it("skips intervention side effects for pegged followers, even breached", async () => {
    mockEuroBanksAndRates();
    // Breach FR's band hard: the pegged rate (~0.92) sits far outside it.
    const frDoc = {
      ...makeExchangeRate("FR", "EUR", 1.5, 0.92),
      interventionPolicy: {
        floor: 100,
        ceiling: 200,
        setByCharacterId: new ObjectId(),
        setByCharacterName: "chair",
        setAtTurn: 1,
        lastAdjustedAtTurn: 1,
        recentInterventions: [],
      },
    };
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          makeExchangeRate("DE", "EUR", 0.92, 0.92),
          frDoc,
          makeExchangeRate("IT", "EUR", 0.5, 0.92),
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    // Give FR a seated chair with no reserves: had intervention run, it would
    // have charged failure infamy (centralBanks.updateOne + chair mail).
    const banks = [
      makeCentralBank("DE"),
      makeCentralBank("FR", { chairCharacterId: new ObjectId(), chairInfamy: 0 }),
      makeCentralBank("IT"),
    ];
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(banks),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processForexTurn(db as unknown as Db, 50, "2027-default");

    expect(db.collectionMocks.centralBanks.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.findOne).not.toHaveBeenCalled();
    // Still pegged despite the breached band.
    expect(rateUpdateFor("FR")?.rate).toBe(rateUpdateFor("DE")?.rate);
  });

  it("1991 worlds keep independent floats: no peg, no code rewrite", async () => {
    mockEuroBanksAndRates({ frCode: "FRF", itCode: "ITL" });
    await processForexTurn(db as unknown as Db, 50, "1991-default");

    const de = rateUpdateFor("DE");
    const fr = rateUpdateFor("FR");
    const it = rateUpdateFor("IT");
    expect(fr?.rate).not.toBe(de?.rate);
    expect(it?.rate).not.toBe(de?.rate);
    expect(fr).not.toHaveProperty("currencyCode");
    expect(it).not.toHaveProperty("currencyCode");
  });

  it("adds zero DB round trips: no gameState read, one pre-fetch per collection", async () => {
    mockEuroBanksAndRates();
    await processForexTurn(db as unknown as Db, 50, "2027-default");

    expect(db.collectionMocks.gameState).toBeUndefined();
    expect(db.collectionMocks.centralBanks.find).toHaveBeenCalledTimes(1);
    // Pre-existing reads only: the turn-open pre-fetch plus the limit-order
    // phase's rate reload. The peg adds neither.
    expect(db.collectionMocks.exchangeRates.find).toHaveBeenCalledTimes(2);
    // One writeback per processed country, nothing else.
    expect(db.collectionMocks.exchangeRates.updateOne).toHaveBeenCalledTimes(3);
    expect(db.collectionMocks.exchangeRates.insertOne).not.toHaveBeenCalled();
  });

  it("seeds a missing 2027 follower row as EUR at the DE anchor", async () => {
    const banks = [makeCentralBank("DE"), makeCentralBank("FR"), makeCentralBank("IT")];
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(banks),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeExchangeRate("DE", "EUR", 0.92, 0.92)]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processForexTurn(db as unknown as Db, 50, "2027-default");

    const frSeed = db.collectionMocks.exchangeRates.insertOne.mock.calls.find(
      (c: Array<{ _id: string }>) => c[0]._id === "FR"
    );
    expect(frSeed?.[0]).toEqual(
      expect.objectContaining({ _id: "FR", currencyCode: "EUR", rate: 0.92, baseRate: 0.92 })
    );
  });
});
