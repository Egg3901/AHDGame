import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { loadCountrySovereignSnapshot, loadCountrySovereignSnapshots } from "../snapshotLoader";

const TURN = 600;
const IMF_ID = new ObjectId();

function world() {
  const memory = createInMemoryDb();
  memory.seed("corporations", [{ _id: IMF_ID, name: "IMF", imfInstitution: true }]);
  memory.seed("federalBudget", [
    {
      _id: "federal",
      countryId: "US",
      debtToGdpRatio: 0.92,
      economicFactors: { inflationRate: 3.94 },
      creditRating: "AA",
      lastDefaultTurn: null,
      recoveryCredibilityBonusUntilTurn: null,
      surplus: -8_000_000,
      debt: { principal: 5_000_000, interestRate: 0.04 },
      settledKeys: ["unrelated"],
    },
    {
      _id: "UK",
      countryId: "UK",
      debtToGdpRatio: 1.7,
      economicFactors: { inflationRate: 16.09 },
      creditRating: "BB",
      lastDefaultTurn: 512,
      recoveryCredibilityBonusUntilTurn: 700,
      surplus: 1_000,
      debt: { principal: 0 },
    },
    {
      _id: "FR",
      countryId: "FR",
      debtToGdpRatio: 0.4,
      economicFactors: { inflationRate: 2 },
      creditRating: "AAA",
      surplus: -123_456_789,
    },
  ]);
  memory.seed("centralBanks", [
    { _id: "US", countryId: "US", primeRate: 4.25, monetaryOperations: [] },
    { _id: "UK", countryId: "UK", primeRate: 9.5 },
  ]);
  memory.seed("politicalMetrics", [
    { _id: new ObjectId(), countryId: "US", values: { "governance.integrity": 61.3 } },
    { _id: new ObjectId(), countryId: "UK", values: { "governance.integrity": 22.7 } },
    { _id: new ObjectId(), countryId: "US", values: { "governance.integrity": 48.9 } },
    { _id: new ObjectId(), countryId: "US", values: {} },
  ]);
  memory.seed("exchangeRates", [
    {
      _id: "UK",
      currencyCode: "GBP",
      rate: 0.44,
      rateHistory: [
        { turn: 595, rate: 0.41 },
        { turn: 580, rate: 0.36 },
        { turn: 591, rate: 0.4 },
      ],
    },
    { _id: "FR", currencyCode: "FRF", rate: 4.9, rateHistory: [] },
  ]);
  const holders = (units: number[]) => [
    { corporationId: IMF_ID, units: 7 },
    ...units.map((u) => ({ characterId: new ObjectId(), units: u })),
    { corporationId: new ObjectId(), units: 3 },
  ];
  memory.seed("bonds", [
    {
      _id: new ObjectId(),
      issuerType: "sovereign",
      countryId: "US",
      matured: false,
      defaulted: false,
      maturityTurn: TURN + 4,
      totalIssued: 3_000_000,
      holders: holders([10, 20]),
    },
    {
      _id: new ObjectId(),
      issuerType: "sovereign",
      countryId: "US",
      matured: false,
      defaulted: false,
      maturityTurn: TURN + 40,
      totalIssued: 4_000_000,
      holders: holders([5]),
    },
    {
      _id: new ObjectId(),
      issuerType: "sovereign",
      countryId: "US",
      matured: false,
      defaulted: true,
      maturityTurn: TURN + 2,
      totalIssued: 9_000_000,
      holders: holders([99]),
    },
    {
      _id: new ObjectId(),
      issuerType: "sovereign",
      countryId: "UK",
      matured: false,
      defaulted: false,
      maturityTurn: TURN,
      totalIssued: 2_000_000,
      holders: holders([1]),
    },
    {
      _id: new ObjectId(),
      issuerType: "sovereign",
      countryId: "FR",
      matured: false,
      defaulted: false,
      maturityTurn: TURN + 11,
      totalIssued: 1_000_000,
    },
    {
      _id: new ObjectId(),
      issuerType: "corporation",
      countryId: "US",
      matured: false,
      defaulted: false,
      maturityTurn: TURN + 1,
      totalIssued: 8_000_000,
      holders: holders([50]),
    },
  ]);
  return memory;
}

/** Counts every read the loader sends, by collection. */
function countingDb(memory: ReturnType<typeof createInMemoryDb>) {
  const reads: string[] = [];
  const db = {
    collection(name: string) {
      const col = memory.collection(name);
      return {
        find: (...args: Parameters<typeof col.find>) => {
          reads.push(name);
          return col.find(...args);
        },
        findOne: (...args: Parameters<typeof col.findOne>) => {
          reads.push(name);
          return col.findOne(...args);
        },
      };
    },
  };
  return { db: db as unknown as Db, reads };
}

describe("loadCountrySovereignSnapshots", () => {
  const countries = ["US", "UK", "FR", "DE", "ZZ"];

  it("assembles the same snapshot the single-country loader does, for every country", async () => {
    const memory = world();
    const db = memory as unknown as Db;
    const batched = await loadCountrySovereignSnapshots(db, countries, TURN);
    expect([...batched.keys()]).toEqual(countries);
    for (const code of countries) {
      expect(batched.get(code)).toEqual(await loadCountrySovereignSnapshot(db, code, TURN));
    }
    // Pinned by hand too, so a mistake shared by both paths cannot hide.
    const us = batched.get("US")!;
    expect(Object.keys(us).sort()).toEqual(
      [
        "countryCode",
        "currentTurn",
        "debtToGdp",
        "inflationRate",
        "trust",
        "sovereignCouponRate",
        "fxDepreciationRate10t",
        "turnsSinceLastDefault",
        "entityHoldings",
        "requiredIssuance",
      ].sort()
    );
    expect(us.debtToGdp).toBe(0.92);
    expect(us.inflationRate).toBeCloseTo(0.0394, 10);
    expect(us.trust).toBeCloseTo((61.3 + 48.9 + 50) / 3 / 100, 10);
    expect(us.sovereignCouponRate).toBe(4.75); // 4.25 prime + 0.5 AA spread
    expect(us.turnsSinceLastDefault).toBeNull();
    // Live, non-IMF units: (10 + 20 + 3) + (5 + 3).
    expect(us.entityHoldings).toBe(41 * BOND_UNIT_FACE_VALUE);
    // Quarter of an 8M deficit (2M) plus rollover capped by principal: min(3M, 5M - 4M).
    expect(us.requiredIssuance).toBe(3_000_000);
    expect(batched.get("UK")!.fxDepreciationRate10t).toBeGreaterThan(0);
    expect(batched.get("UK")!.turnsSinceLastDefault).toBe(TURN - 512);
    expect(batched.get("DE")).toBeNull();
    expect(batched.get("ZZ")).toBeNull();
  });

  it("reads each collection once for the whole list instead of about nine times per country", async () => {
    const single = countingDb(world());
    for (const code of countries) await loadCountrySovereignSnapshot(single.db, code, TURN);
    const batched = countingDb(world());
    await loadCountrySovereignSnapshots(batched.db, countries, TURN);

    expect(batched.reads).toHaveLength(6);
    expect(new Set(batched.reads).size).toBe(6);
    expect(single.reads.length).toBeGreaterThan(20);
  });

  it("returns nulls without reading when no requested code is a real country", async () => {
    const counted = countingDb(world());
    const out = await loadCountrySovereignSnapshots(counted.db, ["ZZ"], TURN);
    expect(out.get("ZZ")).toBeNull();
    expect(counted.reads).toHaveLength(0);
  });
});
