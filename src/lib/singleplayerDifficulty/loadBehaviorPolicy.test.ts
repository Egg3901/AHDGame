import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadNppBehaviorPolicy, loadSingleplayerDifficulty } from "./loadBehaviorPolicy";
import { nppBehaviorPolicy } from "./rules/behavior";

function dbWith(state: Record<string, unknown> | null) {
  const db = createMockDb();
  db.collection("gameState");
  db.collectionMocks.gameState!.findOne = vi.fn().mockResolvedValue(state);
  return db as unknown as Db;
}

describe("loadNppBehaviorPolicy", () => {
  it("resolves a hosted world (no singleplayerConfig) to the shipped behavior", async () => {
    expect(await loadNppBehaviorPolicy(dbWith({ _id: "current" }))).toEqual(
      nppBehaviorPolicy("normal")
    );
  });

  it("resolves a world with no gameState row at all to the shipped behavior", async () => {
    expect(await loadNppBehaviorPolicy(dbWith(null))).toEqual(nppBehaviorPolicy("normal"));
  });

  it("resolves a local world to its configured difficulty", async () => {
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const db = dbWith({ _id: "current", singleplayerConfig: { difficulty } });
      expect(await loadNppBehaviorPolicy(db)).toEqual(nppBehaviorPolicy(difficulty));
    }
  });

  it("reports the raw difficulty for callers that need it", async () => {
    expect(await loadSingleplayerDifficulty(dbWith({ _id: "current" }))).toBeUndefined();
    expect(
      await loadSingleplayerDifficulty(
        dbWith({ _id: "current", singleplayerConfig: { difficulty: "hard" } })
      )
    ).toBe("hard");
  });

  it("projects only the difficulty, never the whole config", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne = vi.fn().mockResolvedValue({ _id: "current" });
    await loadNppBehaviorPolicy(db as unknown as Db);
    expect(db.collectionMocks.gameState!.findOne).toHaveBeenCalledWith(
      { _id: "current" },
      { projection: { "singleplayerConfig.difficulty": 1 } }
    );
  });
});
