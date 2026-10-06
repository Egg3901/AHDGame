import { ObjectId, type Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { resolveGlobalResponse } from "./globalResponse";
import { YUGOSLAV_ESCALATION_CIVILIAN_LOSS } from "./rules/civilianLoss";

vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

describe("civilian loss resolution claim", () => {
  it("claims the frozen order with the outcome and exact response snapshot", async () => {
    const db = createMockDb();
    const crisisId = new ObjectId();
    const interactionId = new ObjectId();
    const responses = [{ countryId: "YU", responseScores: { escalation: 7 } }];
    db.collection("crises").findOne.mockResolvedValue({
      _id: crisisId,
      globalResponse: {
        conflictKey: "unknown-test",
        roleByCountry: { YU: "belligerent" },
        defaultOutcomeId: "war",
        outcomes: [
          {
            outcomeId: "war",
            label: "War",
            description: "",
            priority: 1,
            conditions: [{ axis: "escalation", min: 7 }],
            wireMessage: "War",
            civilianLoss: YUGOSLAV_ESCALATION_CIVILIAN_LOSS,
          },
        ],
      },
    });
    db.collection("crisisInteractions").findOne.mockResolvedValue({
      _id: interactionId,
      crisisId,
      decisionTree: [],
      leaderResponses: responses,
    });
    db.collection("gameState").findOne.mockResolvedValue({
      worldEpochId: "world",
      currentTurn: 7,
      livingConflictsEnabled: true,
    });
    db.collection("states")
      .find()
      .toArray.mockResolvedValue([{ _id: "origin", population: 100_000 }]);
    const result = await resolveGlobalResponse(db as unknown as Db, crisisId);
    expect(result?.civilianLossOrder?.requestedPeople).toBe(5);
    expect(db.collection("crisisInteractions").updateOne).toHaveBeenCalledWith(
      { _id: interactionId, globalResponseOutcome: { $exists: false }, leaderResponses: responses },
      {
        $set: expect.objectContaining({
          globalResponseOutcome: result,
          civilianLossEpochId: "world",
          civilianLossPending: true,
        }),
      }
    );
  });
  it("fails the stale claim when a response lands between tally and CAS, leaving retry to retally", async () => {
    const db = createMockDb();
    const crisisId = new ObjectId();
    const interactionId = new ObjectId();
    db.collection("crises").findOne.mockResolvedValue({
      _id: crisisId,
      globalResponse: {
        conflictKey: "unknown-test",
        roleByCountry: { YU: "belligerent" },
        defaultOutcomeId: "talks",
        outcomes: [
          {
            outcomeId: "talks",
            label: "Talks",
            description: "",
            priority: 1,
            conditions: [],
            wireMessage: "Talks",
          },
        ],
      },
    });
    const old = { _id: interactionId, crisisId, decisionTree: [], leaderResponses: [] };
    const latest = {
      ...old,
      leaderResponses: [{ countryId: "YU", responseScores: { mediation: 10 } }],
    };
    db.collection("crisisInteractions")
      .findOne.mockResolvedValueOnce(old)
      .mockResolvedValueOnce(latest);
    db.collection("crisisInteractions").updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });
    await expect(resolveGlobalResponse(db as unknown as Db, crisisId)).rejects.toThrow(
      "retry from current responses"
    );
    expect(db.collection("crisisInteractions").updateOne.mock.calls[0][0].leaderResponses).toEqual(
      []
    );
    expect(db.collectionMocks.livingConflicts).toBeUndefined();
  });
});
