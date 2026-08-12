import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { loadCollectiveAgreementEffects } from "./collectiveAgreementEffects";

describe("loadCollectiveAgreementEffects", () => {
  it("uses the highest wage floor and applies no-strike protection only inside its term", async () => {
    const shared = new ObjectId();
    const peaceEnded = new ObjectId();
    const toArray = vi.fn().mockResolvedValue([
      { sectorIds: [shared, peaceEnded], wageLevel: 1.1, noStrikeUntilTurn: 90 },
      { sectorIds: [shared], wageLevel: 1.2, noStrikeUntilTurn: 110 },
    ]);
    const find = vi.fn().mockReturnValue({ toArray });
    const db = { collection: () => ({ find }) } as unknown as Db;

    const effects = await loadCollectiveAgreementEffects(db, 100);

    expect(effects.wageFloorBySectorId.get(shared.toString())).toBe(1.2);
    expect(effects.noStrikeProtectedSectorIds.has(shared.toString())).toBe(true);
    expect(effects.noStrikeProtectedSectorIds.has(peaceEnded.toString())).toBe(false);
    expect(find).toHaveBeenCalledWith(
      {
        status: "active",
        startsAtTurn: { $lte: 100 },
        expiresAtTurn: { $gt: 100 },
      },
      expect.anything()
    );
  });
});
