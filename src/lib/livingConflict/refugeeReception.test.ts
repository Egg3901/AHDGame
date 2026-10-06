import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Crisis, CrisisInteraction, CrisisDecisionOption } from "@/lib/db/types/crisis";
import {
  prepareRefugeeReceptionOrder,
  loadPendingRefugeeReceptions,
  materializeRefugeeReceptionResults,
  loadRefugeeServiceCosts,
} from "./refugeeReception";
import { YUGOSLAV_REFUGEE_RECEPTION, planRefugeeReceptions } from "./rules/refugeeReception";

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
      { _id: "host-region", population: 1000 },
      { _id: "federal", population: 1_000_000 },
    ]);
  memory.collection("federalBudget").findOne.mockResolvedValue({ gdp: 10_000_000 });
  memory
    .collection("livingConflicts")
    .findOne.mockResolvedValue({ hasOpened: true, status: "active", tracks: { displacement: 12 } });
  const crisis = { _id: new ObjectId() } as Crisis;
  const interaction = { _id: new ObjectId() } as CrisisInteraction;
  const option: CrisisDecisionOption = {
    optionId: "receive_refugees",
    label: "Reception",
    description: "",
    effects: [],
    nextNodeId: null,
    refugeeReception: YUGOSLAV_REFUGEE_RECEPTION,
  };
  return { memory, db, crisis, interaction, option };
}

describe("humanitarian response outbox and service shell", () => {
  it("keeps unrelated response preparation free of new database reads", async () => {
    const f = fixture();
    vi.clearAllMocks();
    expect(
      await prepareRefugeeReceptionOrder(
        f.db,
        f.crisis,
        f.interaction,
        "AT",
        { ...f.option, refugeeReception: undefined },
        "neighbor"
      )
    ).toBeUndefined();
    expect(f.memory.collection).not.toHaveBeenCalled();
  });
  it("freezes sovereign endpoints, fiscal units and an identity before the claim", async () => {
    const f = fixture();
    const order = await prepareRefugeeReceptionOrder(
      f.db,
      f.crisis,
      f.interaction,
      "AT",
      f.option,
      "neighbor"
    );
    expect(order).toMatchObject({
      worldEpochId: "world",
      effectiveTurn: 8,
      originCountryId: "YU",
      destinationCountryId: "AT",
      requestedPeople: 3,
      annualServiceCostPerPerson: 2000,
      serviceDurationTurns: 24,
      status: "pending",
    });
    expect(order?._id).toContain(f.interaction._id.toString());
    expect(f.memory.collection("federalBudget").updateOne).not.toHaveBeenCalled();
    expect(f.memory.collection("crisisInteractions").updateOne).not.toHaveBeenCalled();
  });
  it("defers responses admitted during processing beyond the current frozen turn", async () => {
    const f = fixture();
    f.memory.collection("gameState").findOne.mockResolvedValue({
      worldEpochId: "world",
      currentTurn: 7,
      isProcessing: true,
      processingTargetTurn: 8,
      livingConflictsEnabled: true,
    });
    expect(
      (
        await prepareRefugeeReceptionOrder(
          f.db,
          f.crisis,
          f.interaction,
          "AT",
          f.option,
          "neighbor"
        )
      )?.effectiveTurn
    ).toBe(9);
  });
  it("freezes enacted restriction and ignores repealed laws at the database boundary", async () => {
    const f = fixture();
    f.memory
      .collection("enactedLaws")
      .find()
      .toArray.mockResolvedValue([
        { legislationTypeId: "de_asylum_policy", policyOptionIndex: 6, enactedAt: new Date(100) },
      ]);
    const order = await prepareRefugeeReceptionOrder(
      f.db,
      f.crisis,
      f.interaction,
      "DE",
      f.option,
      "neighbor"
    );
    expect(order?.authorization.admissionMultiplier).toBe(0);
    expect(f.memory.collection("enactedLaws").find).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "DE", repealedAt: { $exists: false } }),
      expect.anything()
    );
  });
  it("requires a real host fiscal base and stays inert when living conflicts are off", async () => {
    const f = fixture();
    f.memory.collection("federalBudget").findOne.mockResolvedValue({ gdp: 0 });
    await expect(
      prepareRefugeeReceptionOrder(f.db, f.crisis, f.interaction, "AT", f.option, "neighbor")
    ).rejects.toThrow("fiscal base");
    f.memory.collection("gameState").findOne.mockResolvedValue({ livingConflictsEnabled: false });
    expect(
      await prepareRefugeeReceptionOrder(f.db, f.crisis, f.interaction, "AT", f.option, "neighbor")
    ).toBeUndefined();
  });
  it("loads claimed orders even after the interaction resolves, filtering future and other-world entries", async () => {
    const f = fixture();
    const order = (await prepareRefugeeReceptionOrder(
      f.db,
      f.crisis,
      f.interaction,
      "AT",
      f.option,
      "neighbor"
    ))!;
    f.memory
      .collection("crisisInteractions")
      .find()
      .toArray.mockResolvedValue([
        {
          resolvedAt: new Date(),
          leaderResponses: [
            { refugeeReceptionOrder: order },
            { refugeeReceptionOrder: { ...order, _id: "future", effectiveTurn: 9 } },
            { refugeeReceptionOrder: { ...order, _id: "old", worldEpochId: "old" } },
          ],
        },
      ]);
    expect(await loadPendingRefugeeReceptions(f.db, "world", 8, true)).toEqual([order]);
    expect(await loadPendingRefugeeReceptions(f.db, "world", 8, false)).toEqual([]);
  });
  it("persists actual routes before completing the response and never debits treasury directly", async () => {
    const f = fixture();
    const order = (await prepareRefugeeReceptionOrder(
      f.db,
      f.crisis,
      f.interaction,
      "AT",
      f.option,
      "neighbor"
    ))!;
    const ages = { male: Array<number>(101).fill(0), female: Array<number>(101).fill(0) };
    ages.male[20] = 1000;
    const result = planRefugeeReceptions(
      [order],
      [
        { regionId: "origin", countryId: "YU", vector: ages, remainingMigrationCapacity: 100 },
        { regionId: "host", countryId: "AT", vector: ages, remainingMigrationCapacity: 100 },
      ],
      8,
      "world"
    ).results[0];
    f.memory
      .collection("refugeeReceptionHistory")
      .find()
      .toArray.mockResolvedValue([{ _id: result._id }]);
    f.memory.collection("crisisInteractions").bulkWrite.mockResolvedValue({ matchedCount: 1 });
    await materializeRefugeeReceptionResults(f.db, [result], "batch", new Date(0));
    expect(f.memory.collection("refugeeReceptionHistory").bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            update: {
              $setOnInsert: expect.objectContaining({ movedPeople: 3, annualServiceCost: 6000 }),
            },
          }),
        }),
      ],
      { ordered: true }
    );
    expect(
      f.memory.collection("refugeeReceptionHistory").bulkWrite.mock.invocationCallOrder[0]
    ).toBeLessThan(f.memory.collection("crisisInteractions").bulkWrite.mock.invocationCallOrder[0]);
    expect(f.memory.collection("federalBudget").updateOne).not.toHaveBeenCalled();
  });
  it("keeps an unconfirmed response completion recoverable", async () => {
    const f = fixture();
    f.memory.collection("refugeeReceptionHistory").find().toArray.mockResolvedValue([]);
    await expect(
      materializeRefugeeReceptionResults(f.db, [{ _id: "missing" } as never], "batch", new Date())
    ).rejects.toThrow("not confirmed");
    expect(f.memory.collection("crisisInteractions").bulkWrite).not.toHaveBeenCalled();
  });
  it("uses the processing target for current-turn services and scopes obligations to the world", async () => {
    const f = fixture();
    f.memory.collection("gameState").findOne.mockResolvedValue({
      worldEpochId: "world",
      currentTurn: 7,
      isProcessing: true,
      processingTargetTurn: 8,
    });
    f.memory
      .collection("refugeeReceptionHistory")
      .find()
      .toArray.mockResolvedValue([
        {
          _id: "one",
          worldEpochId: "world",
          destinationCountryId: "AT",
          appliedTurn: 8,
          serviceEndTurn: 32,
          annualServiceCost: 6000,
        },
      ]);
    expect(await loadRefugeeServiceCosts(f.db)).toEqual({ AT: 6000 });
    expect(f.memory.collection("refugeeReceptionHistory").find).toHaveBeenCalledWith(
      expect.objectContaining({
        worldEpochId: "world",
        appliedTurn: { $lte: 8 },
        serviceEndTurn: { $gt: 8 },
      }),
      expect.anything()
    );
  });
});
