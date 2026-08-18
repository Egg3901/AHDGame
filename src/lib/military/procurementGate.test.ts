import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { isDefenceProcurementPaused } from "@/lib/military/procurementGate";

function dbWithGameState(doc: unknown): Db {
  const db = createMockDb();
  db.collection("gameState");
  db.collectionMocks.gameState.findOne.mockResolvedValue(doc);
  return db as unknown as Db;
}

describe("isDefenceProcurementPaused", () => {
  it("is true only when the flag is explicitly set", async () => {
    expect(
      await isDefenceProcurementPaused(dbWithGameState({ defenceProcurementPaused: true }))
    ).toBe(true);
  });

  it("is false when the flag is false, absent, or the doc is missing", async () => {
    expect(
      await isDefenceProcurementPaused(dbWithGameState({ defenceProcurementPaused: false }))
    ).toBe(false);
    expect(await isDefenceProcurementPaused(dbWithGameState({}))).toBe(false);
    expect(await isDefenceProcurementPaused(dbWithGameState(null))).toBe(false);
  });

  it("reads the singleton current doc, projected to just the flag", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    await isDefenceProcurementPaused(db as unknown as Db);
    const [filter, options] = db.collectionMocks.gameState.findOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: "current" });
    expect(options).toMatchObject({ projection: { defenceProcurementPaused: 1 } });
  });
});
