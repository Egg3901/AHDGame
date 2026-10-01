import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { MIN_NON_PROXY_WAR_TURNS } from "@/lib/military/rules/warResolution";

const finalizePoleVictory = vi.fn().mockResolvedValue("terms_pending");
vi.mock("@/lib/military/finalizePoleVictory", () => ({
  finalizePoleVictory: (...args: unknown[]) => finalizePoleVictory(...args),
}));

const { resolveMatureWarPoles } = await import("../matureWarPoles");

const TURN = 200;
const war = (over: Record<string, unknown> = {}) => ({
  _id: "war_ru_de_176",
  type: "interstate",
  status: "active",
  startTurn: TURN - MIN_NON_PROXY_WAR_TURNS,
  control: 100,
  poleSide: "B",
  poleSinceTurn: TURN - 10,
  sideA: { label: "Soviet Union", countries: ["RU"], kind: "state" },
  sideB: { label: "West Germany", countries: ["DE"], kind: "state" },
  ...over,
});

describe("resolveMatureWarPoles", () => {
  let db: MockDb;

  function seed(rows: unknown[]) {
    db = createMockDb();
    db.collection("conflicts");
    db.collectionMocks.conflicts.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });
    return db;
  }

  beforeEach(() => {
    finalizePoleVictory.mockClear();
    finalizePoleVictory.mockResolvedValue("terms_pending");
  });

  it("finalizes a stamped pole once the war reaches 24 turns", async () => {
    const result = await resolveMatureWarPoles(seed([war()]) as unknown as Db, TURN, true);

    expect(result).toEqual({ finalized: 1 });
    expect(finalizePoleVictory).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "B",
      TURN
    );
  });

  it("does not finalize an early pole", async () => {
    const young = war({ startTurn: TURN - MIN_NON_PROXY_WAR_TURNS + 1 });
    const result = await resolveMatureWarPoles(seed([young]) as unknown as Db, TURN, true);

    expect(result).toEqual({ finalized: 0 });
    expect(finalizePoleVictory).not.toHaveBeenCalled();
  });

  it("does not convert an unstamped starting pole into a victory", async () => {
    const untouched = war({ poleSide: undefined, poleSinceTurn: undefined });
    const result = await resolveMatureWarPoles(seed([untouched]) as unknown as Db, TURN, true);

    expect(result).toEqual({ finalized: 0 });
    expect(finalizePoleVictory).not.toHaveBeenCalled();
  });

  it("re-checks the current control against the stored stamp", async () => {
    const pushedOff = war({ control: 99 });
    await resolveMatureWarPoles(seed([pushedOff]) as unknown as Db, TURN, true);

    expect(finalizePoleVictory).not.toHaveBeenCalled();
  });

  it("counts only a transition whose atomic claim succeeded", async () => {
    finalizePoleVictory.mockResolvedValue(null);
    const result = await resolveMatureWarPoles(seed([war()]) as unknown as Db, TURN, true);

    expect(result).toEqual({ finalized: 0 });
  });

  it("does nothing while conflicts are disabled", async () => {
    const result = await resolveMatureWarPoles(seed([war()]) as unknown as Db, TURN, false);

    expect(result).toEqual({ finalized: 0 });
    expect(finalizePoleVictory).not.toHaveBeenCalled();
    expect(db.collectionMocks.conflicts.find).not.toHaveBeenCalled();
  });
});
