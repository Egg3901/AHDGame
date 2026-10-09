import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { migration } from "./2026-10-09-corporate-fund-positions";

describe("corporate fund position indexes", () => {
  it("runs idempotently and prevents duplicate corporate positions without restricting player holders", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    await migration.execute(db, { dryRun: true });
    await migration.execute(db, { dryRun: false });
    await migration.execute(db, { dryRun: false });
    const positions = memory.collection("indexFundPositions");
    const fundId = new ObjectId();
    const corporationId = new ObjectId();
    await positions.insertOne({ fundId, corporationId, holderKind: "corporation", units: 1 });
    await expect(
      positions.insertOne({ fundId, corporationId, holderKind: "corporation", units: 2 })
    ).rejects.toMatchObject({ code: 11000 });
    await positions.insertOne({
      fundId,
      corporationId: new ObjectId(),
      holderKind: "corporation",
      units: 1,
    });
    await positions.insertOne({
      fundId,
      characterId: new ObjectId(),
      holderKind: "character",
      units: 1,
    });
    await positions.insertOne({
      fundId,
      characterId: new ObjectId(),
      holderKind: "character",
      units: 1,
    });
    expect(positions.docs).toHaveLength(4);
  });
});
