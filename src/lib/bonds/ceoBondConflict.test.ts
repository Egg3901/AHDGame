import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { holdsAnyBondsInCorp } from "./ceoBondConflict";

let db: MockDb;
const corpId = new ObjectId();
const holderId = new ObjectId();

beforeEach(() => {
  db = createMockDb();
  db.collection("bonds");
});

describe("holdsAnyBondsInCorp", () => {
  it("returns holds=false, units=0 when the holder owns no bonds in the corp", async () => {
    db.collectionMocks["bonds"]!.find = (() => ({
      toArray: async () => [],
    })) as never;
    const result = await holdsAnyBondsInCorp(db as never, holderId, "characterId", corpId);
    expect(result).toEqual({ holds: false, units: 0 });
  });

  it("sums units across multiple bond series for the holder", async () => {
    db.collectionMocks["bonds"]!.find = (() => ({
      toArray: async () => [
        {
          holders: [
            { characterId: holderId, units: 100 },
            { characterId: new ObjectId(), units: 5 },
          ],
        },
        { holders: [{ characterId: holderId, units: 25 }] },
      ],
    })) as never;
    const result = await holdsAnyBondsInCorp(db as never, holderId, "characterId", corpId);
    expect(result).toEqual({ holds: true, units: 125 });
  });

  it("matches the imperial holder field", async () => {
    db.collectionMocks["bonds"]!.find = (() => ({
      toArray: async () => [{ holders: [{ imperialCharacterId: holderId, units: 7 }] }],
    })) as never;
    const result = await holdsAnyBondsInCorp(db as never, holderId, "imperialCharacterId", corpId);
    expect(result).toEqual({ holds: true, units: 7 });
  });
});
