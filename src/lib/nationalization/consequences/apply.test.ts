import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { INVESTOR_CONFIDENCE_BASELINE } from "../constants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("applyNationalizationConsequences", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const n of [
      "federalBudget",
      "stateMetrics",
      "politicalMetrics",
      "countryLeaderStates",
      "states",
      "politicalParties",
    ]) {
      db.collection(n);
    }
    // The trust nudge lands on the political BOARD now; a region needs a board
    // doc for applyBoardDelta to have anything to move.
    db.collectionMocks.politicalMetrics.find.mockReturnValue(
      cursor([
        {
          _id: "CA",
          countryId: "US",
          values: { "governance.integrity": 50 },
          residuals: { "governance.integrity": 0 },
        },
      ])
    );
  });

  it("lowers confidence on a seizure and records nothing foreign when domestic", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" }); // baseline
    db.collectionMocks.states.find.mockReturnValue(cursor([{ _id: "CA", countryId: "US" }]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(
      cursor([{ _id: "CA", countryId: "US", governance: { publicTrust: { value: 50 } } }])
    );

    const { applyNationalizationConsequences } = await import("./apply");
    const result = await applyNationalizationConsequences(db as unknown as Db, {
      countryId: "US",
      method: "executive",
      tier: "seizure",
      triggers: ["strategic"],
      sectorTypes: ["energy"],
      valuationAnchor: 1_000_000,
      compensationAnchor: 0,
      foreignOwnerCountryId: null,
      governingPartyId: null,
      turn: 10,
    });

    expect(result.confidenceAfter).toBeLessThan(INVESTOR_CONFIDENCE_BASELINE);
    expect(result.foreignOwnerRecorded).toBeNull();
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalled();
    // Trust nudged DOWN on CA's board (unpopular strategic seizure). The legacy
    // stateMetrics write this replaced had silently stopped applying.
    const boardWrite = db.collectionMocks.politicalMetrics.bulkWrite.mock.calls[0][0];
    expect(boardWrite[0].updateOne.update.$set.values["governance.integrity"]).toBeLessThan(50);
    expect(db.collectionMocks.stateMetrics.bulkWrite).not.toHaveBeenCalled();
  });

  it("records the foreign owner + emits a wire event, applies no relations delta", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" });
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(cursor([]));

    const { applyNationalizationConsequences } = await import("./apply");
    const { logWireEvent } = await import("@/lib/wireEvent");
    const result = await applyNationalizationConsequences(db as unknown as Db, {
      countryId: "US",
      method: "executive",
      tier: "discounted",
      triggers: ["strategic"],
      sectorTypes: ["technology"],
      valuationAnchor: 500_000,
      compensationAnchor: 250_000,
      foreignOwnerCountryId: "UK",
      governingPartyId: null,
      turn: 12,
    });

    expect(result.foreignOwnerRecorded).toBe("UK");
    expect(vi.mocked(logWireEvent)).toHaveBeenCalledWith(
      "corporation_nationalized",
      expect.stringContaining("UK-owned")
    );
  });

  it("a statist government takes a smaller confidence hit than a market one", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" });
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(cursor([]));

    const { applyNationalizationConsequences } = await import("./apply");
    const base = {
      countryId: "US" as const,
      method: "executive" as const,
      tier: "seizure" as const,
      triggers: ["strategic" as const],
      sectorTypes: ["energy" as const],
      valuationAnchor: 1_000_000,
      compensationAnchor: 0,
      foreignOwnerCountryId: null,
      governingPartyId: "1",
      turn: 10,
    };

    db.collectionMocks.politicalParties.findOne.mockResolvedValueOnce({ economicPosition: -5 }); // statist
    const statist = await applyNationalizationConsequences(db as unknown as Db, base);

    db.collectionMocks.politicalParties.findOne.mockResolvedValueOnce({ economicPosition: 5 }); // market
    const market = await applyNationalizationConsequences(db as unknown as Db, base);

    const statistDrop = 70 - statist.confidenceAfter;
    const marketDrop = 70 - market.confidenceAfter;
    expect(statistDrop).toBeLessThan(marketDrop);
  });

  it("lowers popular legitimacy for a confidence-model country (CN), most-recent leader", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "CN" });
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(cursor([]));
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue({
      _id: "CN_leader1",
      countryId: "CN",
      popularLegitimacy: 75,
      popularLegitimacyHistory: [],
    });

    const { applyNationalizationConsequences } = await import("./apply");
    const result = await applyNationalizationConsequences(db as unknown as Db, {
      countryId: "CN",
      method: "executive",
      tier: "seizure",
      triggers: ["strategic"],
      sectorTypes: ["energy"],
      valuationAnchor: 1_000_000,
      compensationAnchor: 0,
      foreignOwnerCountryId: null,
      governingPartyId: null,
      turn: 20,
    });

    expect(result.legitimacyDelta).toBeLessThan(0);
    // Selected the active leader-state via most-recent sort.
    const findCall = db.collectionMocks.countryLeaderStates.findOne.mock.calls[0];
    expect(findCall[0]).toEqual({ countryId: "CN" });
    expect(findCall[1]).toEqual({ sort: { updatedAt: -1 } });
    const update = db.collectionMocks.countryLeaderStates.updateOne.mock.calls[0];
    expect(update[1].$set.popularLegitimacy).toBeLessThan(75);
  });

  it("does not touch confidence/approval for an NPC/unowned taking (no expropriation)", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" });
    db.collectionMocks.states.find.mockReturnValue(cursor([{ _id: "CA", countryId: "US" }]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(
      cursor([{ _id: "CA", countryId: "US", governance: { publicTrust: { value: 50 } } }])
    );

    const { applyNationalizationConsequences } = await import("./apply");
    const result = await applyNationalizationConsequences(db as unknown as Db, {
      countryId: "US",
      method: "executive",
      tier: "seizure",
      triggers: ["npc"],
      sectorTypes: ["energy"],
      valuationAnchor: 1_000_000,
      compensationAnchor: 0,
      foreignOwnerCountryId: null,
      governingPartyId: null,
      turn: 10,
    });

    expect(result.confidenceAfter).toBe(INVESTOR_CONFIDENCE_BASELINE); // unchanged
    expect(db.collectionMocks.federalBudget.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.stateMetrics.bulkWrite).not.toHaveBeenCalled();
  });

  it("privatization raises confidence and nudges approval up for a market govt", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" }); // baseline 70
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue({
      countryId: "US",
      governingPartyId: "3",
    });
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({ economicPosition: 5 }); // market
    db.collectionMocks.states.find.mockReturnValue(cursor([{ _id: "CA", countryId: "US" }]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(
      cursor([{ _id: "CA", countryId: "US", governance: { publicTrust: { value: 50 } } }])
    );

    const { applyPrivatizationConsequences } = await import("./apply");
    const result = await applyPrivatizationConsequences(db as unknown as Db, {
      countryId: "US",
      turn: 10,
    });

    expect(result.confidenceAfter).toBeGreaterThan(result.confidenceBefore);
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalled();
    // Trust nudged UP on CA's board — privatization pleases a market government.
    const boardWrite = db.collectionMocks.politicalMetrics.bulkWrite.mock.calls[0][0];
    expect(boardWrite[0].updateOne.update.$set.values["governance.integrity"]).toBeGreaterThan(50);
  });

  it("privatization legitimacy delta is negative for a statist govt in a confidence-model country", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "CN" });
    db.collectionMocks.countryLeaderStates.findOne.mockResolvedValue({
      _id: "CN_leader1",
      countryId: "CN",
      governingPartyId: "1",
      popularLegitimacy: 75,
      popularLegitimacyHistory: [],
    });
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({ economicPosition: -5 }); // statist
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(cursor([]));

    const { applyPrivatizationConsequences } = await import("./apply");
    const result = await applyPrivatizationConsequences(db as unknown as Db, {
      countryId: "CN",
      turn: 20,
    });

    expect(result.legitimacyDelta).toBeLessThan(0);
    const update = db.collectionMocks.countryLeaderStates.updateOne.mock.calls[0];
    expect(update[1].$set.popularLegitimacy).toBeLessThan(75);
  });

  it("a high-SOCI country takes a deeper approval penalty (unpopular taking)", async () => {
    const base = {
      countryId: "US" as const,
      method: "executive" as const,
      tier: "seizure" as const,
      triggers: ["strategic" as const],
      sectorTypes: ["energy" as const],
      valuationAnchor: 1_000_000,
      compensationAnchor: 0,
      foreignOwnerCountryId: null,
      governingPartyId: null,
      turn: 10,
    };
    const boardRows = [
      {
        _id: "CA",
        countryId: "US",
        values: { "governance.integrity": 50 },
        residuals: { "governance.integrity": 0 },
      },
    ];

    const { applyNationalizationConsequences } = await import("./apply");

    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" }); // SOCI 0
    db.collectionMocks.states.find.mockReturnValue(cursor([{ _id: "CA", countryId: "US" }]));
    db.collectionMocks.politicalMetrics.find.mockReturnValue(cursor(boardRows));
    await applyNationalizationConsequences(db as unknown as Db, base);
    const lowWrite =
      db.collectionMocks.politicalMetrics.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
        .values["governance.integrity"];

    vi.clearAllMocks();
    for (const n of [
      "federalBudget",
      "stateMetrics",
      "politicalMetrics",
      "countryLeaderStates",
      "states",
      "politicalParties",
    ]) {
      db.collection(n);
    }
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      stateOwnershipConcentration: 85,
    });
    db.collectionMocks.states.find.mockReturnValue(cursor([{ _id: "CA", countryId: "US" }]));
    db.collectionMocks.politicalMetrics.find.mockReturnValue(cursor(boardRows));
    await applyNationalizationConsequences(db as unknown as Db, base);
    const highWrite =
      db.collectionMocks.politicalMetrics.bulkWrite.mock.calls[0][0][0].updateOne.update.$set
        .values["governance.integrity"];

    // Trust starts at 50 on the board; a deeper penalty lands a lower value at
    // high SOCI.
    expect(highWrite).toBeLessThan(lowWrite);
  });

  it("scars confidence on a fairly-paid expropriation (base hit fires on the act)", async () => {
    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" }); // baseline 70, SOCI absent ⇒ 0
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(cursor([]));

    const { applyNationalizationConsequences } = await import("./apply");
    const result = await applyNationalizationConsequences(db as unknown as Db, {
      countryId: "US",
      method: "legislative",
      tier: "fair",
      triggers: ["supermajority"],
      sectorTypes: ["financial"],
      valuationAnchor: 1_000_000,
      compensationAnchor: 1_000_000, // fully paid — used to be a 0 hit
      foreignOwnerCountryId: null,
      governingPartyId: null,
      turn: 9,
    });
    // The fix: a fully-paid expropriation now removes a real, non-trivial amount.
    expect(INVESTOR_CONFIDENCE_BASELINE - result.confidenceAfter).toBeGreaterThan(3);
    expect(db.collectionMocks.federalBudget.updateOne).toHaveBeenCalled();
  });

  it("a high-SOCI country takes a bigger confidence hit than a low-SOCI one (same taking)", async () => {
    const base = {
      countryId: "US" as const,
      method: "legislative" as const,
      tier: "fair" as const,
      triggers: ["supermajority" as const],
      sectorTypes: ["financial" as const],
      valuationAnchor: 1_000_000,
      compensationAnchor: 1_000_000,
      foreignOwnerCountryId: null,
      governingPartyId: null,
      turn: 9,
    };
    db.collectionMocks.states.find.mockReturnValue(cursor([]));
    db.collectionMocks.stateMetrics.find.mockReturnValue(cursor([]));

    const { applyNationalizationConsequences } = await import("./apply");

    db.collectionMocks.federalBudget.findOne.mockResolvedValue({ countryId: "US" }); // SOCI 0
    const low = await applyNationalizationConsequences(db as unknown as Db, base);

    db.collectionMocks.federalBudget.findOne.mockResolvedValue({
      countryId: "US",
      stateOwnershipConcentration: 85, // deep in the danger zone
    });
    const high = await applyNationalizationConsequences(db as unknown as Db, base);

    const lowDrop = INVESTOR_CONFIDENCE_BASELINE - low.confidenceAfter;
    const highDrop = INVESTOR_CONFIDENCE_BASELINE - high.confidenceAfter;
    expect(highDrop).toBeGreaterThan(lowDrop);
  });
});
