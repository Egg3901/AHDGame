import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { ALL_COUNTRY_IDS } from "@/lib/constants/countries";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursorReturning(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("processMinisterialOrders tier effect resolution", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("applies a CN tier effect to the resolved nested metric path", async () => {
    // One CN finance setting on the "stimulus" tier:
    //   tier effects { gdpGrowth: 0.02, unemploymentRate: -0.015, costOfLiving: 0.015 }
    db.collection("cabinetSettings");
    db.collectionMocks.cabinetSettings!.find.mockReturnValue(
      cursorReturning([
        {
          _id: "CN_minister_of_finance",
          countryId: "CN",
          positionId: "minister_of_finance",
          tierSetting: "stimulus",
        },
      ])
    );

    // One CN province so the apply step has a state to write to.
    db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue(cursorReturning([{ _id: "HD" }]));

    // No active orders, no cabinet members (action regen no-op): defaults ([]) are fine.

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    await processMinisterialOrders(100);

    // SP5: economic tier effects land on macroMetrics.
    const bulkWrite = db.collectionMocks.macroMetrics!.bulkWrite;
    expect(bulkWrite).toHaveBeenCalledTimes(1);

    const ops = bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $inc: Record<string, number> } };
    }>;
    const hdOp = ops.find((op) => op.updateOne.filter._id === "HD");
    expect(hdOp).toBeDefined();
    // Authored tier effects × CABINET_EFFECT_STRENGTH (1.25), all sub-cap (×1 span).
    const hdInc = hdOp!.updateOne.update.$inc;
    expect(hdInc["economic.gdpGrowth.value"]).toBeCloseTo(0.025, 10);
    expect(hdInc["economic.unemploymentRate.value"]).toBeCloseTo(-0.01875, 10);
    expect(hdInc["economic.costOfLiving.value"]).toBeCloseTo(0.01875, 10);
    // The bare key must NOT appear at the document root.
    expect(hdInc["gdpGrowth.value"]).toBeUndefined();
  });

  it("routes the PBoC tight-stance inflation pressure to the central bank, not stateMetrics", async () => {
    db.collection("cabinetSettings");
    db.collectionMocks.cabinetSettings!.find.mockReturnValue(
      cursorReturning([
        {
          _id: "CN_pboc_governor",
          countryId: "CN",
          positionId: "pboc_governor",
          tierSetting: "tight",
        },
      ])
    );
    db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue(cursorReturning([{ _id: "BJ" }]));
    db.collection("centralBanks");
    db.collectionMocks.centralBanks!.find.mockReturnValue(cursorReturning([{ _id: "CN" }]));

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    await processMinisterialOrders(100);

    // Inflation pressure persisted to the central bank (tight = -0.4 pp).
    const cbBulk = db.collectionMocks.centralBanks!.bulkWrite;
    expect(cbBulk).toHaveBeenCalledTimes(1);
    const cbOps = cbBulk.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: { policyInflationPressure: number } } };
    }>;
    const cnOp = cbOps.find((op) => op.updateOne.filter._id === "CN");
    expect(cnOp!.updateOne.update.$set.policyInflationPressure).toBeCloseTo(-0.4, 10);

    // SP5: gdp/unemployment (economic) hit macroMetrics; inflation does NOT.
    const smOps = db.collectionMocks.macroMetrics!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $inc: Record<string, number> } };
    }>;
    const bjInc = smOps.find((op) => op.updateOne.filter._id === "BJ")!.updateOne.update.$inc;
    // gdp/unemployment × CABINET_EFFECT_STRENGTH (1.25); inflation pressure is NOT
    // strength-scaled (routed to the central bank before the multiplier).
    expect(bjInc["economic.gdpGrowth.value"]).toBeCloseTo(-0.025, 10);
    expect(bjInc["economic.unemploymentRate.value"]).toBeCloseTo(0.01875, 10);
    expect(bjInc["economic.inflationRate.value"]).toBeUndefined();
    expect(bjInc["inflationPressure.value"]).toBeUndefined();
  });

  it("scales an order's effect by the issuing minister's Statecraft", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();

    db.collection("ministerialOrders");
    db.collectionMocks.ministerialOrders!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    // First find() is expireMinisterialOrders' active sweep (none stale); second
    // is processMinisterialOrders' active-order fetch (our order).
    db.collectionMocks
      .ministerialOrders!.find.mockReturnValueOnce(cursorReturning([]))
      .mockReturnValueOnce(
        cursorReturning([
          {
            _id: "order_sc",
            countryId: "CN",
            characterId: charId,
            effects: [{ metric: "economic.gdpGrowth", modifier: 0.01, scope: "national" }],
            active: true,
          },
        ])
      );

    // High-Statecraft issuer → statMultiplier(10) = 1.18×.
    db.collection("characters");
    db.collectionMocks.characters!.find.mockReturnValue(
      cursorReturning([{ _id: charId, stats: { statecraft: 10 } }])
    );

    db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue(cursorReturning([{ _id: "HD" }]));
    db.collection("cabinetSettings");
    db.collectionMocks.cabinetSettings!.find.mockReturnValue(cursorReturning([]));
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers!.find.mockReturnValue(cursorReturning([]));
    db.collection("centralBanks");
    db.collectionMocks.centralBanks!.find.mockReturnValue(cursorReturning([]));

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    await processMinisterialOrders(100);

    const ops = db.collectionMocks.macroMetrics!.bulkWrite.mock.calls[0]![0] as Array<{
      updateOne: { filter: { _id: string }; update: { $inc: Record<string, number> } };
    }>;
    const hdInc = ops.find((op) => op.updateOne.filter._id === "HD")!.updateOne.update.$inc;
    // 0.01 base × 1.18 (Statecraft) × 1.25 (CABINET_EFFECT_STRENGTH) = 0.01475 (well under the 0.05 cap).
    expect(hdInc["economic.gdpGrowth.value"]).toBeCloseTo(0.01475, 6);
  });

  it("expires active orders once currentTurn reaches expiresTurn (bug #0761)", async () => {
    db.collection("ministerialOrders");
    db.collectionMocks
      .ministerialOrders!.updateMany.mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });
    db.collectionMocks
      .ministerialOrders!.find.mockReturnValueOnce(
        cursorReturning([
          {
            _id: "order_1",
            active: true,
            issuedTurn: 100,
            expiresTurn: "124",
          },
        ])
      )
      .mockReturnValueOnce(cursorReturning([]));
    db.collection("cabinetSettings");
    db.collectionMocks.cabinetSettings!.find.mockReturnValue(cursorReturning([]));
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers!.find.mockReturnValue(cursorReturning([]));
    db.collection("centralBanks");
    db.collectionMocks.centralBanks!.find.mockReturnValue(cursorReturning([{ _id: "CN" }]));

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    const result = await processMinisterialOrders(124);

    expect(result.ordersExpired).toBe(1);
    expect(result.ordersActive).toBe(0);
    expect(db.collectionMocks.ministerialOrders!.updateMany).toHaveBeenCalledTimes(2);
  });

  it("refills ministerial actions to cap on a new Eastern calendar day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T14:00:00.000Z"));

    db.collection("ministerialOrders");
    db.collectionMocks.ministerialOrders!.updateMany.mockResolvedValue({ modifiedCount: 0 });
    db.collectionMocks.ministerialOrders!.find.mockReturnValue(cursorReturning([]));
    db.collection("cabinetSettings");
    db.collectionMocks.cabinetSettings!.find.mockReturnValue(cursorReturning([]));
    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers!.find.mockReturnValue(
      cursorReturning([
        {
          _id: "member_1",
          ministerialActions: 0,
          lastMinisterialActionResetDay: "2026-06-02",
        },
      ])
    );
    db.collection("centralBanks");
    db.collectionMocks.centralBanks!.find.mockReturnValue(cursorReturning([{ _id: "US" }]));

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    const result = await processMinisterialOrders(200);

    expect(result.actionsRegenerated).toBe(1);
    expect(db.collectionMocks.cabinetMembers!.bulkWrite).toHaveBeenCalledWith([
      {
        updateOne: {
          filter: { _id: "member_1" },
          update: {
            $set: {
              ministerialActions: MINISTERIAL_ACTION_CAP,
              lastMinisterialActionResetDay: "2026-06-03",
            },
          },
        },
      },
    ]);

    vi.useRealTimers();
  });
});

describe("processMinisterialOrders political-metric contribution snapshot", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue(cursorReturning([{ _id: "MA" }]));
    db.collection("politicalCabinetContribution");
  });

  it("snapshots a pipeline country's cabinet political contribution", async () => {
    // US Attorney General on tough_on_crime → publicSafety.crimeRate -0.02,
    // mapped (order.safety weight -1) to a positive order.safety contribution.
    db.collection("cabinetSettings");
    db.collectionMocks.cabinetSettings!.find.mockReturnValue(
      cursorReturning([
        {
          _id: "US_attorney_general",
          countryId: "US",
          positionId: "attorney_general",
          tierSetting: "tough_on_crime",
        },
      ])
    );

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    await processMinisterialOrders(100);

    const call = db.collectionMocks.politicalCabinetContribution!.updateOne.mock.calls[0];
    expect(call![0]).toEqual({ _id: "US" });
    const contribution = (call![1] as { $set: { contribution: Record<string, number> } }).$set
      .contribution;
    expect(contribution["order.safety"]).toBeGreaterThan(0);
  });

  it("never snapshots a non-pipeline country (pipeline countries may persist empty)", async () => {
    // The excluded country is DERIVED from the gate, not hardcoded. This test
    // named DE until the board widened from the four playables to 26 countries
    // and made DE a pipeline country — asserting the invariant against whatever
    // the predicate currently excludes is what keeps it honest through the next
    // widening. (`ALL_COUNTRY_IDS` order is stable, so the pick is deterministic.)
    const nonPipeline = ALL_COUNTRY_IDS.find((c) => !isPoliticalApprovalCountry(c));
    expect(nonPipeline).toBeTruthy();

    db.collection("cabinetSettings");
    db.collectionMocks.cabinetSettings!.find.mockReturnValue(
      cursorReturning([
        {
          _id: `${nonPipeline}_minister_of_finance`,
          countryId: nonPipeline,
          positionId: "minister_of_finance",
          tierSetting: "stimulus",
        },
      ])
    );

    const { processMinisterialOrders } = await import("./ministerialOrderProcessing");
    await processMinisterialOrders(100);

    // Board countries are always in effectsByCountry via the military/estate/
    // energy/infra loops, so they may persist an empty snapshot — but a country
    // the gate excludes must never be written at all.
    const calls = db.collectionMocks.politicalCabinetContribution!.updateOne.mock.calls;
    expect(calls.some((c) => (c[0] as { _id: string })._id === nonPipeline)).toBe(false);
  });
});
