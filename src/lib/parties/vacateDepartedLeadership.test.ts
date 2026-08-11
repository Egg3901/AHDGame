import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { vacateDepartedLeadership } from "./vacateDepartedLeadership";

function makeDb() {
  const updateManyCalls: Array<{ filter: unknown; update: unknown }> = [];
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "politicalParties") {
      return {
        updateMany: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
          updateManyCalls.push({ filter, update });
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
        }),
      };
    }
    return {};
  });
  return { db: { collection } as unknown as Db, updateManyCalls };
}

describe("vacateDepartedLeadership", () => {
  it("nulls chair / vice chair / treasurer slots referencing departed characters, scoped to country and excluding the new party", async () => {
    const { db, updateManyCalls } = makeDb();
    const departed = [new ObjectId(), new ObjectId()];

    await vacateDepartedLeadership(db, "IE", departed, { exceptPartySequentialId: 7 });

    expect(updateManyCalls).toHaveLength(1);
    const { filter, update } = updateManyCalls[0] as {
      filter: {
        countryId: string;
        sequentialId: { $ne: number };
        $or: Array<Record<string, unknown>>;
      };
      update: unknown;
    };
    expect(filter.countryId).toBe("IE");
    expect(filter.sequentialId.$ne).toBe(7);
    // Filter targets any of the three leadership slots.
    const slotKeys = filter.$or.flatMap((c) => Object.keys(c));
    expect(slotKeys).toEqual(expect.arrayContaining(["chairId", "viceChairId", "treasurerId"]));
    // Pipeline update nulls each slot and references the departed ids.
    const json = JSON.stringify(update);
    expect(json).toContain("chairId");
    expect(json).toContain("viceChairId");
    expect(json).toContain("treasurerId");
    expect(json).toContain(departed[0]!.toString());
  });

  it("omits the sequentialId exclusion when no exceptPartySequentialId is given", async () => {
    const { db, updateManyCalls } = makeDb();

    await vacateDepartedLeadership(db, "CN", [new ObjectId()]);

    expect(updateManyCalls).toHaveLength(1);
    const { filter } = updateManyCalls[0] as { filter: Record<string, unknown> };
    expect(filter.countryId).toBe("CN");
    expect(filter.sequentialId).toBeUndefined();
  });

  it("is a no-op when no departed characters are supplied", async () => {
    const { db, updateManyCalls } = makeDb();
    await vacateDepartedLeadership(db, "IE", [], { exceptPartySequentialId: 7 });
    expect(updateManyCalls).toHaveLength(0);
  });
});
