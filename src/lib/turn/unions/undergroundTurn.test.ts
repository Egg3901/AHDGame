import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Union } from "@/lib/db/types";
import { processUndergroundTurn } from "./undergroundTurn";
import { EXPOSURE_LENGTH_TURNS } from "@/lib/unions/underground";

let seededRollResult = 100;
vi.mock("@/lib/events/substrate/rng", () => ({
  seededRoll: vi.fn().mockImplementation(() => seededRollResult),
}));

function makeCell(overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "Cell",
    ownerId: null,
    treasury: 0,
    suspended: true,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Union;
}

function stubDb(cells: Union[]) {
  const bulkWrite = vi.fn().mockResolvedValue({});
  const db = {
    collection: (name: string) => {
      if (name === "unions") {
        return {
          find: vi.fn().mockReturnValue({ toArray: () => Promise.resolve(cells) }),
          bulkWrite,
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, bulkWrite };
}

beforeEach(() => {
  seededRollResult = 100;
});

describe("processUndergroundTurn", () => {
  it("writes nothing when no union is suspended", async () => {
    const legal = makeCell({ suspended: false });
    const { db, bulkWrite } = stubDb([legal]);
    const result = await processUndergroundTurn(db, 42);
    expect(result).toEqual({ unionsChecked: 0, newlyExposed: 0 });
    expect(bulkWrite).not.toHaveBeenCalled();
  });

  it("decays heat on idle turns and writes nothing at zero", async () => {
    const warm = makeCell({ heat: 10, lastUndergroundDriveTurn: 40 });
    const cold = makeCell({ heat: 0 });
    const { db, bulkWrite } = stubDb([warm, cold]);
    const result = await processUndergroundTurn(db, 42);
    expect(result.unionsChecked).toBe(2);
    expect(result.newlyExposed).toBe(0);
    expect(bulkWrite).toHaveBeenCalledTimes(1);
    const writes = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
    }>;
    expect(writes).toHaveLength(1);
    expect(writes[0].updateOne.filter._id).toEqual(warm._id);
    expect(writes[0].updateOne.update.$set.heat).toBe(8);
  });

  it("skips decay on turns with a drive but still clamps runaway heat", async () => {
    const hot = makeCell({ heat: 140, lastUndergroundDriveTurn: 42 });
    const { db, bulkWrite } = stubDb([hot]);
    seededRollResult = 100; // miss either way; heat 100 caps chance at 60
    await processUndergroundTurn(db, 42);
    const writes = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(writes[0].updateOne.update.$set.heat).toBe(100);
  });

  it("exposes a hot union when the detection roll hits", async () => {
    const hot = makeCell({ heat: 80, lastUndergroundDriveTurn: 40 });
    const { db, bulkWrite } = stubDb([hot]);
    seededRollResult = 1; // beats any nonzero chance
    const result = await processUndergroundTurn(db, 42);
    expect(result.newlyExposed).toBe(1);
    const writes = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(writes[0].updateOne.update.$set.exposedUntilTurn).toBe(42 + EXPOSURE_LENGTH_TURNS - 1);
  });

  it("stays dark when the roll misses and never rolls below threshold", async () => {
    const hot = makeCell({ heat: 80, lastUndergroundDriveTurn: 40 });
    const cool = makeCell({ heat: 10, lastUndergroundDriveTurn: 40 });
    const { db, bulkWrite } = stubDb([hot, cool]);
    seededRollResult = 100;
    const result = await processUndergroundTurn(db, 42);
    expect(result.newlyExposed).toBe(0);
    const writes = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    // Only the decay write for both cells; neither gains an exposure window.
    expect(writes.every((w) => !("exposedUntilTurn" in w.updateOne.update.$set))).toBe(true);
  });

  it("does not re-roll a union that is already exposed", async () => {
    const exposed = makeCell({ heat: 90, exposedUntilTurn: 50, lastUndergroundDriveTurn: 40 });
    const { db, bulkWrite } = stubDb([exposed]);
    seededRollResult = 1;
    const result = await processUndergroundTurn(db, 42);
    expect(result.newlyExposed).toBe(0);
    const writes = bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(writes.every((w) => !("exposedUntilTurn" in w.updateOne.update.$set))).toBe(true);
  });
});
