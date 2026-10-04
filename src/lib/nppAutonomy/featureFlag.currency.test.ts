import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { getNppAutonomyWorldContext } from "./featureFlag";

describe("NPP world context", () => {
  it("loads the preset alongside autonomy in one gameState read", async () => {
    const findOne = vi.fn().mockResolvedValue({ nppAutonomyLevel: "v3", preset: "2027-default" });
    const db = {
      collection: vi.fn().mockReturnValue({ findOne }),
    } as unknown as Db;

    expect(await getNppAutonomyWorldContext(db)).toEqual({
      level: "v3",
      preset: "2027-default",
    });
    expect(db.collection).toHaveBeenCalledTimes(1);
    expect(findOne).toHaveBeenCalledWith(
      { _id: "current" },
      { projection: { nppAutonomyLevel: 1, nppAutonomyEnabled: 1, preset: 1 } }
    );
  });
});
