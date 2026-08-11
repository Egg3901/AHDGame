import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { getGameStatePreset } from "./gameState";

/**
 * The `gameState` collection is a singleton BY CONVENTION, not by constraint —
 * a live world was found carrying a `debt_ceiling_crisis` document alongside
 * `_id: "current"`. #3773 purges squatters on reset; this is the read-side
 * half. An unfiltered `findOne({})` returns whichever document Mongo scans
 * first, which silently reads a 1953 world as the default preset.
 */
function mockDbWithDocs(docs: Record<string, unknown>[]) {
  const findOne = vi.fn(async (filter: Record<string, unknown>) => {
    const entries = Object.entries(filter ?? {});
    return docs.find((doc) => entries.every(([k, v]) => doc[k] === v)) ?? null;
  });
  return {
    db: { collection: vi.fn().mockReturnValue({ findOne }) } as unknown as Db,
    findOne,
  };
}

describe("getGameStatePreset", () => {
  it("reads the canonical document, not whatever the collection scans first", async () => {
    // The squatter is deliberately FIRST — an unfiltered read would return it.
    const { db, findOne } = mockDbWithDocs([
      { _id: "debt_ceiling_crisis", active: true },
      { _id: "current", preset: "1953-default" },
    ]);

    await expect(getGameStatePreset(db)).resolves.toBe("1953-default");
    expect(findOne).toHaveBeenCalledWith({ _id: "current" }, { projection: { preset: 1 } });
  });

  it("returns undefined when no world is seeded, so callers apply their own default", async () => {
    const { db } = mockDbWithDocs([{ _id: "debt_ceiling_crisis", active: true }]);
    await expect(getGameStatePreset(db)).resolves.toBeUndefined();
  });

  it("returns undefined when the canonical doc has no preset recorded", async () => {
    const { db } = mockDbWithDocs([{ _id: "current", currentTurn: 42 }]);
    await expect(getGameStatePreset(db)).resolves.toBeUndefined();
  });
});
