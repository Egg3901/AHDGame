import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolveGlobalResponse } from "./globalResponse";
import { YUGOSLAV_ESCALATION_CAPACITY_DESTRUCTION } from "./rules/capacityDestruction";

vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

function setup(interactionExtra: Record<string, unknown> = {}) {
  const db = createMockDb();
  const crisisId = new ObjectId();
  const interactionId = new ObjectId();
  const outcomes = [
    {
      outcomeId: "war",
      label: "War",
      description: "",
      priority: 1,
      conditions: [{ axis: "escalation", min: 7 }],
      wireMessage: "War",
      capacityDestruction: YUGOSLAV_ESCALATION_CAPACITY_DESTRUCTION,
    },
  ];
  db.collection("crises").findOne.mockResolvedValue({
    _id: crisisId,
    globalResponse: {
      conflictKey: "unknown-test",
      roleByCountry: { YU: "belligerent" },
      defaultOutcomeId: "war",
      outcomes,
    },
  });
  db.collection("crisisInteractions").findOne.mockResolvedValue({
    _id: interactionId,
    crisisId,
    decisionTree: [],
    leaderResponses: [{ countryId: "YU", responseScores: { escalation: 7 } }],
    ...interactionExtra,
  });
  db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 300 });
  db.collection("states")
    .find()
    .toArray.mockResolvedValue([
      { _id: "YU_CRO", name: "Croatia", countryId: "YU", gdp: 1000, capitalStock: 3000 },
      { _id: "YU_BIH", name: "Bosnia", countryId: "YU", gdp: 400, capitalStock: 1200 },
    ]);
  return { db, crisisId, interactionId };
}

describe("capacity destruction at resolution", () => {
  it("destroys capital once and stores the readout on the resolved outcome", async () => {
    const { db, crisisId, interactionId } = setup();
    const result = await resolveGlobalResponse(db as unknown as Db, crisisId);
    expect(result?.capacityDestruction?.regions).toEqual([
      expect.objectContaining({ regionId: "YU_CRO", destroyedCapital: 15, countryId: "YU" }),
      expect.objectContaining({ regionId: "YU_BIH", destroyedCapital: 6, countryId: "YU" }),
    ]);
    expect(db.collectionMocks.conflictCapacityObligations.bulkWrite).toHaveBeenCalledOnce();
    expect(db.collection("crisisInteractions").updateOne).toHaveBeenCalledWith(
      { _id: interactionId },
      {
        $set: expect.objectContaining({
          "globalResponseOutcome.capacityDestruction": result?.capacityDestruction,
        }),
      }
    );
  });

  it("does not re-plan destruction for an outcome whose readout is already stored", async () => {
    const { db, crisisId } = setup({
      globalResponseOutcome: {
        outcomeId: "war",
        label: "War",
        description: "",
        scores: {},
        respondedCountries: 1,
        eligibleCountries: 1,
        capacityDestruction: { regions: [], skipped: [], realizedFraction: 1 },
        resolvedAt: new Date(0),
      },
    });
    await resolveGlobalResponse(db as unknown as Db, crisisId);
    expect(db.collectionMocks.conflictCapacityObligations).toBeUndefined();
  });

  it("finishes destruction a crash left unwritten, without a second claim", async () => {
    const { db, crisisId } = setup({
      globalResponseOutcome: {
        outcomeId: "war",
        label: "War",
        description: "",
        scores: {},
        respondedCountries: 1,
        eligibleCountries: 1,
        resolvedAt: new Date(0),
      },
    });
    const result = await resolveGlobalResponse(db as unknown as Db, crisisId);
    expect(result?.outcomeId).toBe("war");
    expect(db.collectionMocks.conflictCapacityObligations.bulkWrite).toHaveBeenCalledOnce();
  });
});
