import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  collectEconomicSignalsForCountry,
  collectElectionCredibilitySignals,
  mapPurgeEventsToInput,
  mapEnactedBillsToInput,
} from "@/lib/turn/popularLegitimacyDriverCollectors";

describe("mapPurgeEventsToInput", () => {
  it("maps {severity, kind} pairs through unchanged", () => {
    const events = [
      { _id: new ObjectId(), severity: "minor", kind: "discipline" },
      { _id: new ObjectId(), severity: "major", kind: "ideological" },
      { _id: new ObjectId(), severity: "extreme", kind: "faction" },
    ];
    const out = mapPurgeEventsToInput(events);
    expect(out).toEqual([
      { severity: "minor", kind: "discipline" },
      { severity: "major", kind: "ideological" },
      { severity: "extreme", kind: "faction" },
    ]);
  });

  it("defaults missing kind to 'discipline'", () => {
    const events = [{ _id: new ObjectId(), severity: "minor" }];
    expect(mapPurgeEventsToInput(events)).toEqual([{ severity: "minor", kind: "discipline" }]);
  });

  it("returns empty array on empty input", () => {
    expect(mapPurgeEventsToInput([])).toEqual([]);
  });
});

describe("mapEnactedBillsToInput", () => {
  it("translates category-based axis effects into the driver shape", () => {
    const effects = {
      market_reform: [{ axisId: "economicProsperity", delta: 50 }],
      civil_liberties_expansion: [{ axisId: "civilLiberties", delta: 80 }],
    };
    const bills = mapEnactedBillsToInput(["market_reform", "civil_liberties_expansion"], effects);
    expect(bills).toHaveLength(2);
    // Deltas scaled from -100..+100 to -1..+1
    expect(bills[0].axisEffects.economicProsperity).toBeCloseTo(0.5, 5);
    expect(bills[1].axisEffects.civilLiberties).toBeCloseTo(0.8, 5);
  });

  it("aggregates multi-axis effects within a single bill", () => {
    const effects = {
      stimulus: [
        { axisId: "economicProsperity", delta: 60 },
        { axisId: "publicServices", delta: 40 },
      ],
    };
    const [bill] = mapEnactedBillsToInput(["stimulus"], effects);
    expect(bill.axisEffects.economicProsperity).toBeCloseTo(0.6, 5);
    expect(bill.axisEffects.publicServices).toBeCloseTo(0.4, 5);
  });

  it("skips unknown categories silently", () => {
    expect(mapEnactedBillsToInput(["unknown_category"], {})).toEqual([]);
  });

  it("returns empty on empty input", () => {
    expect(mapEnactedBillsToInput([], {})).toEqual([]);
  });
});

describe("collectEconomicSignalsForCountry", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("centralBanks");
  });

  it("returns neutral signals when no central bank doc exists", async () => {
    db.collectionMocks.centralBanks.findOne.mockResolvedValueOnce(null);
    const sig = await collectEconomicSignalsForCountry(db as unknown as Db, "CN");
    expect(sig.gdpGrowthAnnualPct).toBe(2.5);
    expect(sig.unemploymentDeltaPct).toBe(0);
    expect(sig.inflationDeviationFromTargetPct).toBe(0);
  });

  it("reads latest gdpGrowth snapshot when available", async () => {
    db.collectionMocks.centralBanks.findOne.mockResolvedValueOnce({
      _id: "CN",
      countryId: "CN",
      gdpGrowthHistory: [
        { turn: 10, rate: 2.0 },
        { turn: 11, rate: 3.0 },
      ],
      inflationHistory: [],
    });
    const sig = await collectEconomicSignalsForCountry(db as unknown as Db, "CN");
    expect(sig.gdpGrowthAnnualPct).toBe(3.0);
  });

  it("computes inflation deviation from a 2.0% target", async () => {
    db.collectionMocks.centralBanks.findOne.mockResolvedValueOnce({
      _id: "CN",
      countryId: "CN",
      gdpGrowthHistory: [],
      inflationHistory: [
        { turn: 10, rate: 2.0 },
        { turn: 11, rate: 4.5 },
      ],
    });
    const sig = await collectEconomicSignalsForCountry(db as unknown as Db, "CN");
    expect(sig.inflationDeviationFromTargetPct).toBe(2.5);
  });
});

describe("collectElectionCredibilitySignals", () => {
  it("returns isElectionTurn: false + neutral multiplier when no opsVoteMultipliers", async () => {
    const sig = await collectElectionCredibilitySignals(null as unknown as Db, "CN", 100, {
      opsMultiplier: null,
      isElectionTurn: false,
    });
    expect(sig.isElectionTurn).toBe(false);
    expect(sig.opsMultiplier).toBe(1.0);
  });

  it("uses the supplied opsMultiplier when present", async () => {
    const sig = await collectElectionCredibilitySignals(null as unknown as Db, "CN", 100, {
      opsMultiplier: 1.5,
      isElectionTurn: true,
    });
    expect(sig.isElectionTurn).toBe(true);
    expect(sig.opsMultiplier).toBe(1.5);
  });
});
