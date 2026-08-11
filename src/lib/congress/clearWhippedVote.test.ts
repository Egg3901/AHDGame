import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { clearWhippedFromVote } from "./clearWhippedVote";

describe("clearWhippedFromVote", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("unsets whippedFromVote.<characterId> on the target document", async () => {
    const targetId = new ObjectId();
    const characterId = new ObjectId();

    await clearWhippedFromVote(db as unknown as Db, "bills", targetId, characterId);

    const billsMock = db.collectionMocks["bills"];
    const billCalls = billsMock!.updateOne.mock.calls;
    expect(billCalls).toHaveLength(1);
    const [filter, update] = billCalls[0];
    expect(filter).toEqual({ _id: targetId });
    expect(update).toEqual({
      $unset: { [`whippedFromVote.${characterId.toString()}`]: "" },
    });
  });

  it("supports a custom field name (e.g. otherChamberWhippedFromVote)", async () => {
    const targetId = new ObjectId();
    const characterId = new ObjectId();

    await clearWhippedFromVote(
      db as unknown as Db,
      "bills",
      targetId,
      characterId,
      "otherChamberWhippedFromVote"
    );

    const billsMock = db.collectionMocks["bills"];
    const [, update] = billsMock!.updateOne.mock.calls[0];
    expect(update).toEqual({
      $unset: { [`otherChamberWhippedFromVote.${characterId.toString()}`]: "" },
    });
  });

  it("is chamber-agnostic — works for any collection name", async () => {
    const targetId = new ObjectId();
    const characterId = new ObjectId();

    await clearWhippedFromVote(db as unknown as Db, "speakerNominations", targetId, characterId);

    const mock = db.collectionMocks["speakerNominations"];
    expect(mock!.updateOne).toHaveBeenCalledTimes(1);
  });
});
