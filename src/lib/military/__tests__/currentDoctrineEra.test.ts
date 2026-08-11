import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/db/collections/gameState", () => ({ getGameStateCollection: vi.fn() }));
const { getGameStateCollection } = await import("@/lib/db/collections/gameState");
import { resolveDoctrineEra } from "../currentDoctrineEra";

describe("resolveDoctrineEra", () => {
  it("maps the game year to a decade index", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ startingYear: 1979, currentTurn: 1 });
    vi.mocked(getGameStateCollection).mockResolvedValue(db.collectionMocks.gameState as never);
    expect(await resolveDoctrineEra(db as unknown as Db)).toBe(7); // 1979 → "1970s"
  });

  it("falls back to the latest era when no game year is resolvable", async () => {
    const db = createMockDb();
    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue(null);
    vi.mocked(getGameStateCollection).mockResolvedValue(db.collectionMocks.gameState as never);
    const era = await resolveDoctrineEra(db as unknown as Db);
    expect(era).toBeGreaterThan(0);
  });
});
