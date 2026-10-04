import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getCrisisInteractionsByCrisisId } from "./interactionEngine";

describe("getCrisisInteractionsByCrisisId", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("crisisInteractions");
  });

  it("loads interactions for many crises with one query", async () => {
    const crisisIds = Array.from({ length: 12 }, () => new ObjectId());
    db.collectionMocks.crisisInteractions.find.mockReturnValue({
      toArray: async () => crisisIds.map((crisisId) => ({ crisisId, currentNodeId: "decision" })),
    } as never);

    const interactions = await getCrisisInteractionsByCrisisId(db as unknown as Db, crisisIds);

    expect(interactions.size).toBe(crisisIds.length);
    expect(interactions.has(crisisIds[0]!.toString())).toBe(true);
    expect(db.collectionMocks.crisisInteractions.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.crisisInteractions.findOne).not.toHaveBeenCalled();
  });
});
