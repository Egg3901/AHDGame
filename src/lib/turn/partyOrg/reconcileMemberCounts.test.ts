import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { reconcilePartyMemberCounts } from "./reconcileMemberCounts";

function makeDb(opts: {
  players: Array<{ party: string; countryId: string; count: number }>;
  npps: Array<{ party: string; countryId: string; count: number }>;
  parties: Array<{ sequentialId: number; countryId: string; memberCount: number }>;
}) {
  const bulkOps: unknown[] = [];
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "characters") {
      return {
        aggregate: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(
            opts.players.map((p) => ({
              _id: { party: p.party, countryId: p.countryId },
              count: p.count,
            }))
          ),
        }),
      };
    }
    if (name === "npps") {
      return {
        aggregate: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(
            opts.npps.map((n) => ({
              _id: { party: n.party, countryId: n.countryId },
              count: n.count,
            }))
          ),
        }),
      };
    }
    if (name === "politicalParties") {
      return {
        find: vi.fn().mockReturnValue({
          project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(opts.parties) }),
        }),
        bulkWrite: vi.fn().mockImplementation((ops: unknown[]) => {
          bulkOps.push(...ops);
          return Promise.resolve({ modifiedCount: ops.length });
        }),
      };
    }
    return {};
  });
  return { db: { collection } as unknown as Db, bulkOps };
}

describe("reconcilePartyMemberCounts", () => {
  it("rewrites only the parties whose stored memberCount drifts from live players + active NPPs", async () => {
    const { db, bulkOps } = makeDb({
      players: [
        { party: "3", countryId: "IE", count: 13 },
        { party: "2", countryId: "IE", count: 4 },
      ],
      npps: [
        { party: "3", countryId: "IE", count: 16 },
        { party: "2", countryId: "IE", count: 17 },
      ],
      parties: [
        { sequentialId: 3, countryId: "IE", memberCount: 61 }, // drifted: should be 29
        { sequentialId: 2, countryId: "IE", memberCount: 21 }, // correct: 4 + 17
        { sequentialId: 9, countryId: "IE", memberCount: 0 }, // no members: correct
      ],
    });

    const result = await reconcilePartyMemberCounts(db);

    expect(result).toEqual({ partiesChecked: 3, partiesUpdated: 1 });
    // Only the drifted party (#3) is written.
    expect(bulkOps).toHaveLength(1);
    const op = bulkOps[0] as {
      updateOne: { filter: unknown; update: { $set: { memberCount: number } } };
    };
    expect(op.updateOne.filter).toMatchObject({ sequentialId: 3, countryId: "IE" });
    expect(op.updateOne.update.$set.memberCount).toBe(29);
  });

  it("treats a party with no live members as 0 and does not write when already 0", async () => {
    const { db, bulkOps } = makeDb({
      players: [],
      npps: [],
      parties: [{ sequentialId: 5, countryId: "IE", memberCount: 0 }],
    });

    const result = await reconcilePartyMemberCounts(db);
    expect(result).toEqual({ partiesChecked: 1, partiesUpdated: 0 });
    expect(bulkOps).toHaveLength(0);
  });

  it("corrects a negative stored count to its true membership", async () => {
    const { db, bulkOps } = makeDb({
      players: [{ party: "2", countryId: "IE", count: 4 }],
      npps: [{ party: "2", countryId: "IE", count: 17 }],
      parties: [{ sequentialId: 2, countryId: "IE", memberCount: -2 }],
    });

    const result = await reconcilePartyMemberCounts(db);
    expect(result).toEqual({ partiesChecked: 1, partiesUpdated: 1 });
    expect(
      (bulkOps[0] as { updateOne: { update: { $set: { memberCount: number } } } }).updateOne.update
        .$set.memberCount
    ).toBe(21);
  });
});
