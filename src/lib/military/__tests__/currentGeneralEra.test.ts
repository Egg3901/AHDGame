import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/db/collections/gameState", () => ({ getGameStateCollection: vi.fn() }));
const { getGameStateCollection } = await import("@/lib/db/collections/gameState");
import { resolveGeneralEra } from "../currentGeneralEra";
import { CUR_ERA_YEAR } from "../generalsTree";

describe("resolveGeneralEra", () => {
  it("returns the game year (decade year, not an index)", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ startingYear: 1979, currentTurn: 1 });
    vi.mocked(getGameStateCollection).mockResolvedValue(db.collectionMocks.gameState as never);
    expect(await resolveGeneralEra(db as unknown as Db)).toBe(1979);
  });

  it("falls back to CUR_ERA_YEAR when no game year is resolvable", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    vi.mocked(getGameStateCollection).mockResolvedValue(db.collectionMocks.gameState as never);
    expect(await resolveGeneralEra(db as unknown as Db)).toBe(CUR_ERA_YEAR);
  });
});
