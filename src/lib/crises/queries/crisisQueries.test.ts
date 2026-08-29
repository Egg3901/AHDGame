import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));

const { getGameState } = await import("@/lib/gameState");
const { listCrises } = await import("./crisisQueries");

/**
 * #1208: crisis `startTurn`/`endTurn` are stored RAW, so every surface that
 * dates them needs the world's founding-phase clock. The client crisis page has
 * no other source for it, so it travels in this payload.
 */
describe("listCrises founding-phase clock", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("crises");
    db.collection("states");
    db.collectionMocks.crises.find.mockReturnValue({
      sort: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
    });
  });

  it("carries the clock so a stored turn can be dated on the world calendar", async () => {
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 463,
      startingYear: 1953,
      preIterationTurns: 48,
      preIteration: { active: false },
    } as never);

    const result = await listCrises(db as unknown as Db, null, "active");

    expect(result.startingYear).toBe(1953);
    expect(result.preIterationTurns).toBe(48);
    expect(result.preIterationActive).toBe(false);
  });

  it("reports a zero offset on a world with no founding phase", async () => {
    vi.mocked(getGameState).mockResolvedValue({
      currentTurn: 100,
      startingYear: 2019,
    } as never);

    const result = await listCrises(db as unknown as Db, null, "active");

    expect(result.preIterationTurns).toBe(0);
    expect(result.preIterationActive).toBe(false);
  });

  it("still answers when there is no game state at all", async () => {
    vi.mocked(getGameState).mockResolvedValue(null as never);

    const result = await listCrises(db as unknown as Db, null, "active");

    expect(result.currentTurn).toBe(0);
    expect(result.preIterationTurns).toBe(0);
  });
});
