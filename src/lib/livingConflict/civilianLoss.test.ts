import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Crisis, CrisisInteraction, GlobalResponseOutcome } from "@/lib/db/types/crisis";
import {
  prepareConflictCivilianLossOrder,
  loadPendingConflictCivilianLosses,
  materializeConflictCivilianLossResults,
} from "./civilianLoss";
import {
  YUGOSLAV_ESCALATION_CIVILIAN_LOSS,
  type ConflictCivilianLossResult,
} from "./rules/civilianLoss";

function fixture() {
  const memory = createMockDb();
  const db = memory as unknown as Db;
  memory.collection("gameState").findOne.mockResolvedValue({
    worldEpochId: "world",
    currentTurn: 7,
    livingConflictsEnabled: true,
  });
  memory
    .collection("states")
    .find()
    .toArray.mockResolvedValue([
      { _id: "origin", population: 100_000 },
      { _id: "federal", population: 1e9 },
    ]);
  const crisis: Crisis = {
    _id: new ObjectId(),
    name: "Yugoslav escalation",
    description: "Test conflict",
    scope: "global",
    countryIds: ["YU"],
    regionIds: ["origin"],
    status: "active",
    startTurn: 6,
    endTurn: null,
    durationTurns: null,
    effects: [],
    wireMessageOnStart: "",
    wireMessageOnEnd: null,
    createdBy: null,
    createdAt: new Date(0),
    resolvedAt: null,
    globalResponse: {
      conflictKey: "yugoslavia",
      eventKey: "escalation",
      roleByCountry: { YU: "belligerent" },
      defaultOptionIdByRole: {},
      outcomes: [],
      defaultOutcomeId: "military_escalation",
    },
  };
  const interaction = { _id: new ObjectId() } as CrisisInteraction;
  const outcome = {
    outcomeId: "military_escalation",
    civilianLoss: YUGOSLAV_ESCALATION_CIVILIAN_LOSS,
  } as GlobalResponseOutcome;
  return { memory, db, crisis, interaction, outcome };
}

describe("civilian outcome outbox", () => {
  it("keeps unrelated outcomes free of new reads and freezes a bounded request before claiming", async () => {
    const f = fixture();
    vi.clearAllMocks();
    expect(
      await prepareConflictCivilianLossOrder(f.db, f.crisis, f.interaction, {
        ...f.outcome,
        civilianLoss: undefined,
      })
    ).toBeUndefined();
    expect(f.memory.collection).not.toHaveBeenCalled();
    const order = await prepareConflictCivilianLossOrder(f.db, f.crisis, f.interaction, f.outcome);
    expect(order).toMatchObject({
      requestedPeople: 5,
      regionIds: ["origin"],
      countryId: "YU",
      effectiveTurn: 8,
      status: "pending",
    });
    expect(order?._id).toContain(f.interaction._id.toString());
    expect(f.memory.collection("crisisInteractions").updateOne).not.toHaveBeenCalled();
  });
  it("defers during processing and stays inactive with living conflicts disabled", async () => {
    const f = fixture();
    f.memory.collection("gameState").findOne.mockResolvedValue({
      worldEpochId: "world",
      currentTurn: 7,
      isProcessing: true,
      processingTargetTurn: 8,
      livingConflictsEnabled: true,
    });
    expect(
      (await prepareConflictCivilianLossOrder(f.db, f.crisis, f.interaction, f.outcome))
        ?.effectiveTurn
    ).toBe(9);
    f.memory.collection("gameState").findOne.mockResolvedValue({ livingConflictsEnabled: false });
    expect(
      await prepareConflictCivilianLossOrder(f.db, f.crisis, f.interaction, f.outcome)
    ).toBeUndefined();
  });
  it("rejects non-belligerents, invalid authored shares and bad population before any claim", async () => {
    const f = fixture();
    await expect(
      prepareConflictCivilianLossOrder(f.db, f.crisis, f.interaction, {
        ...f.outcome,
        civilianLoss: { countryId: "AT", residentPopulationShare: 0.00005 },
      })
    ).rejects.toThrow("Invalid");
    await expect(
      prepareConflictCivilianLossOrder(f.db, f.crisis, f.interaction, {
        ...f.outcome,
        civilianLoss: { countryId: "YU", residentPopulationShare: 0.1 },
      })
    ).rejects.toThrow("Invalid");
    f.memory
      .collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "origin", population: NaN }]);
    await expect(
      prepareConflictCivilianLossOrder(f.db, f.crisis, f.interaction, f.outcome)
    ).rejects.toThrow("finite");
  });
  it("loads only eligible pending orders through the separate outcome marker", async () => {
    const f = fixture();
    const order = (await prepareConflictCivilianLossOrder(
      f.db,
      f.crisis,
      f.interaction,
      f.outcome
    ))!;
    f.memory
      .collection("crisisInteractions")
      .find()
      .toArray.mockResolvedValue([
        { globalResponseOutcome: { civilianLossOrder: order } },
        { globalResponseOutcome: { civilianLossOrder: { ...order, effectiveTurn: 9 } } },
        { globalResponseOutcome: { civilianLossOrder: { ...order, status: "complete" } } },
      ]);
    expect(await loadPendingConflictCivilianLosses(f.db, "world", 8, true)).toEqual([order]);
    expect(f.memory.collection("crisisInteractions").find).toHaveBeenCalledWith(
      { civilianLossEpochId: "world", civilianLossPending: true },
      expect.anything()
    );
    expect(await loadPendingConflictCivilianLosses(f.db, "world", 8, false)).toEqual([]);
  });
  it("confirms immutable history before clearing the claimed outcome and makes no treasury or military write", async () => {
    const f = fixture();
    const result: ConflictCivilianLossResult = {
      _id: "loss",
      worldEpochId: "world",
      interactionId: f.interaction._id.toString(),
      crisisId: f.crisis._id.toString(),
      outcomeId: "military_escalation",
      countryId: "YU",
      stock: "civilian-residents",
      appliedTurn: 8,
      requestedPeople: 5,
      deaths: 5,
      regions: [{ regionId: "origin", deaths: 5 }],
      reason: "applied",
    };
    await expect(
      materializeConflictCivilianLossResults(f.db, [result], "batch", new Date(0))
    ).rejects.toThrow("history");
    expect(f.memory.collection("crisisInteractions").bulkWrite).not.toHaveBeenCalled();
    f.memory
      .collection("conflictCivilianLossHistory")
      .find()
      .toArray.mockResolvedValue([{ _id: "loss" }]);
    f.memory.collection("crisisInteractions").bulkWrite.mockResolvedValue({ matchedCount: 1 });
    await materializeConflictCivilianLossResults(f.db, [result], "batch", new Date(0));
    expect(f.memory.collection("crisisInteractions").bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            update: {
              $set: {
                "globalResponseOutcome.civilianLossOrder.status": "complete",
                "globalResponseOutcome.civilianLossResult": result,
                civilianLossPending: false,
              },
            },
          }),
        }),
      ],
      { ordered: true }
    );
    expect(f.memory.collectionMocks.federalBudget).toBeUndefined();
    expect(f.memory.collectionMocks.militaryUnits).toBeUndefined();
  });
});
