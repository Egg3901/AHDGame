import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { recomputePartyMemberCount } from "./recomputePartyMemberCount";

function makeDb(charCount: number, nppCount: number) {
  const updateOneCalls: Array<{ filter: unknown; update: unknown }> = [];
  const countQueries: Record<string, unknown[]> = { characters: [], npps: [] };
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "characters") {
      return {
        countDocuments: vi.fn().mockImplementation((q: unknown) => {
          countQueries.characters.push(q);
          return Promise.resolve(charCount);
        }),
      };
    }
    if (name === "npps") {
      return {
        countDocuments: vi.fn().mockImplementation((q: unknown) => {
          countQueries.npps.push(q);
          return Promise.resolve(nppCount);
        }),
      };
    }
    if (name === "politicalParties") {
      return {
        updateOne: vi.fn().mockImplementation((filter: unknown, update: unknown) => {
          updateOneCalls.push({ filter, update });
          return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
        }),
      };
    }
    return {};
  });
  return { db: { collection } as unknown as Db, updateOneCalls, countQueries };
}

describe("recomputePartyMemberCount", () => {
  it("sets memberCount to live characters + active NPPs and returns it", async () => {
    const { db, updateOneCalls, countQueries } = makeDb(4, 17);

    const result = await recomputePartyMemberCount(db, "IE", 2);

    expect(result).toBe(21);
    // Counts are scoped to the party's sequentialId-as-string and country.
    expect(countQueries.characters[0]).toEqual({ party: "2", countryId: "IE" });
    // NPP count excludes retired NPPs.
    expect(countQueries.npps[0]).toEqual({ party: "2", countryId: "IE", retiredAt: null });
    // Writes the recomputed total to the matching party.
    expect(updateOneCalls).toHaveLength(1);
    const { filter, update } = updateOneCalls[0] as {
      filter: { sequentialId: number; countryId: string };
      update: { $set: { memberCount: number } };
    };
    expect(filter).toMatchObject({ sequentialId: 2, countryId: "IE" });
    expect(update.$set.memberCount).toBe(21);
  });

  it("never writes a negative count (recompute is authoritative, not a decrement)", async () => {
    const { db, updateOneCalls } = makeDb(0, 0);
    const result = await recomputePartyMemberCount(db, "IE", 2);
    expect(result).toBe(0);
    expect(
      (updateOneCalls[0] as { update: { $set: { memberCount: number } } }).update.$set.memberCount
    ).toBe(0);
  });
});
