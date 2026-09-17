import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { checkGovernmentFormation } from "./readinessChecks";

/**
 * `governmentFormations` and `gameState` are the only collections this reads.
 * `formation` is the row (or null); `turn` is `gameState.current.currentTurn`.
 */
function makeDb(formation: Record<string, unknown> | null, turn = 1): Db {
  return {
    collection: vi.fn().mockImplementation((name: string) => ({
      findOne: vi
        .fn()
        .mockResolvedValue(name === "governmentFormations" ? formation : { currentTurn: turn }),
    })),
  } as unknown as Db;
}

describe("checkGovernmentFormation", () => {
  it("is ok when the row exists", async () => {
    const check = await checkGovernmentFormation(
      "JP",
      makeDb({ _id: "JP", status: "pending", cycle: 1 })
    );
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("pending");
  });

  it("is missing when the row is absent and nothing creates it later", async () => {
    const check = await checkGovernmentFormation("JP", makeDb(null));
    expect(check.status).toBe("missing");
  });

  /**
   * The false alarm this option removes.
   *
   * ⚠️ THE UK WRITES THIS ROW ON THE FIRST PROCESSED TURN, not at seed time:
   * `updateGovernmentSeats` calls its own `seedGovernmentFormation` when it
   * finds none, reading legacy collections no seed file has. A freshly reset
   * world sits on turn 1 with no turn processed, which is precisely when the row
   * cannot exist yet — so reporting "missing" there called a correct reset
   * broken, on every reset.
   */
  it("is ok for a lazily-created row before the first turn has run", async () => {
    const check = await checkGovernmentFormation("UK", makeDb(null, 1), {
      createdOnFirstTurn: true,
    });
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("first processed turn");
  });

  /**
   * ⚠️ AND STILL FAILS ONCE A TURN HAS RUN. The option must not become a blanket
   * excuse: if a turn has been processed and the row is still absent, the lazy
   * path did not fire and that is a real fault.
   */
  it("is missing for a lazily-created row once a turn has been processed", async () => {
    const check = await checkGovernmentFormation("UK", makeDb(null, 2), {
      createdOnFirstTurn: true,
    });
    expect(check.status).toBe("missing");
    expect(check.detail).toContain("did not run");
  });
});
