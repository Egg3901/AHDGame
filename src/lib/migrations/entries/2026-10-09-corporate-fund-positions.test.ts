import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-09-corporate-fund-positions";

describe("corporate fund position migration", () => {
  it("preserves existing positions and performs no writes in dry-run mode", async () => {
    const memory = createInMemoryDb();
    const position = {
      _id: new ObjectId(),
      fundId: new ObjectId(),
      characterId: new ObjectId(),
      holderKind: "character",
      units: 3,
      legacyUnits: 1,
    };
    memory.seed("indexFundPositions", [position]);
    const db = memory as unknown as Db;
    await migration.execute(db, { dryRun: true });
    expect(await memory.collection("indexFundPositions").listIndexes().toArray()).toEqual([]);
    expect(memory.collection("indexFundPositions").docs).toEqual([position]);
    await migration.execute(db, { dryRun: false });
    expect(memory.collection("indexFundPositions").docs).toEqual([position]);
    expect(await memory.collection("indexFundPositions").listIndexes().toArray()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          unique: true,
          partialFilterExpression: { holderKind: "corporation" },
        }),
      ])
    );
  });
});
