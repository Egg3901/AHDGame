import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { getNppAutonomyLevel, withNppAutonomySnapshot } from "./featureFlag";

function mockDb(level: string) {
  const findOne = vi.fn(async () => ({ _id: "current", nppAutonomyLevel: level }));
  return { db: { collection: vi.fn(() => ({ findOne })) } as unknown as Db, findOne };
}

describe("withNppAutonomySnapshot (#2690)", () => {
  it("reads gameState once for every autonomy lookup inside the scope", async () => {
    const { db, findOne } = mockDb("v3");
    const levels = await withNppAutonomySnapshot(db, async () =>
      Promise.all(Array.from({ length: 50 }, () => getNppAutonomyLevel(db)))
    );
    expect(new Set(levels)).toEqual(new Set(["v3"]));
    expect(findOne).toHaveBeenCalledTimes(1);
  });

  it("does not leak outside its scope", async () => {
    const { db, findOne } = mockDb("v2");
    await withNppAutonomySnapshot(db, async () => getNppAutonomyLevel(db));
    await getNppAutonomyLevel(db);
    await getNppAutonomyLevel(db);
    expect(findOne).toHaveBeenCalledTimes(3);
  });
});
