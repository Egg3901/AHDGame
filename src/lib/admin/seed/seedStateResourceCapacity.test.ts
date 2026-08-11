import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { bulkOps, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedStateResourceCapacity } from "./seedStateResourceCapacity";
import { getStateResourceCapacity } from "@/lib/seeds/reference/stateResourceCapacity";

// seedStateResourceCapacity defaults to the "2019-default" preset; assert
// against the same scaled map the seed actually writes (headroom applied).
const SEEDED = getStateResourceCapacity("2019-default");

describe("seedStateResourceCapacity", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("creates capacity docs for every state, including non-US regions added after runSeed", async () => {
    const states = [
      { _id: "TX", countryId: "US" },
      { _id: "SCO", countryId: "UK" },
      { _id: "HOK", countryId: "JP" },
      { _id: "DB", countryId: "CN" },
    ];
    db.collection("states").find.mockReturnValue({
      toArray: async () => states,
    });
    db.collection("stateResourceCapacity");

    const logs: string[] = [];
    await seedStateResourceCapacity(
      db as unknown as Db,
      false,
      (msg) => logs.push(msg),
      "2019-default"
    );

    const updates = bulkOps(db.collection("stateResourceCapacity").bulkWrite) as unknown as Array<
      [{ stateId?: string }, { $set?: { resources?: unknown } }]
    >;
    expect(updates).toHaveLength(states.length);
    // One round trip for the whole roster, not one per state.
    expect(db.collection("stateResourceCapacity").bulkWrite).toHaveBeenCalledTimes(1);

    const txCall = updates.find((call) => call[0]?.stateId === "TX");
    expect(txCall?.[1]?.$set?.resources).toEqual(SEEDED["US:TX"].resources);

    const scoCall = updates.find((call) => call[0]?.stateId === "SCO");
    expect(scoCall?.[1]?.$set?.resources).toEqual(SEEDED["UK:SCO"].resources);

    expect(logs.some((line) => line.includes("with capacity"))).toBe(true);
  });
});
