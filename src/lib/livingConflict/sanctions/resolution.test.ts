import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolveGlobalResponse } from "../globalResponse";

vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

describe("sanctions resolution persistence", () => {
  it("does not close the decision when enforcement fails, and materializes on retry", async () => {
    const db = createMockDb();
    const crisisId = new ObjectId();
    const interactionId = new ObjectId();
    db.collection("crises").findOne.mockResolvedValue({
      _id: crisisId,
      startTurn: 90,
      durationTurns: 10,
      endTurn: null,
      globalResponse: {
        conflictKey: "sanction-test",
        eventKey: "test",
        roleByCountry: { DE: "bloc", YU: "belligerent" },
        defaultOptionIdByRole: {},
        defaultOutcomeId: "pressure",
        outcomes: [
          {
            outcomeId: "pressure",
            label: "Pressure",
            description: "Arms restriction",
            priority: 1,
            conditions: [],
            wireMessage: "Arms restriction",
            tradeSanction: {
              participationAxis: "sanctions",
              targetRole: "belligerent",
              commodity: "ordnance",
              durationTurns: 48,
            },
          },
        ],
      },
    });
    db.collection("crisisInteractions").findOne.mockResolvedValue({
      _id: interactionId,
      decisionTree: [],
      crisisId,
      leaderResponses: [
        { countryId: "DE", characterId: new ObjectId(), responseScores: { sanctions: 4 } },
      ],
    });
    db.collection("tradeEmbargoes").updateOne.mockRejectedValueOnce(
      new Error("temporary database failure")
    );
    await expect(resolveGlobalResponse(db as unknown as Db, crisisId)).rejects.toThrow(
      "temporary database failure"
    );
    expect(db.collection("crisisInteractions").updateOne).not.toHaveBeenCalled();
    const result = await resolveGlobalResponse(db as unknown as Db, crisisId);
    expect(result?.outcomeId).toBe("pressure");
    expect(db.collection("tradeEmbargoes").updateOne).toHaveBeenCalledTimes(2);
    expect(db.collection("crisisInteractions").updateOne).toHaveBeenCalledTimes(1);
    expect(db.collection("tradeEmbargoes").updateOne.mock.calls[1][1].$setOnInsert).toMatchObject({
      sourceCountry: "DE",
      targetCountry: "YU",
      commodity: "ordnance",
      origin: "crisis",
    });
  });
});
