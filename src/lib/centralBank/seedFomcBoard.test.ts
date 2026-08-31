import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CentralBank } from "@/lib/db/types/centralBank";

// The committee is US-only; a non-US bank is never government-controlled here so
// the ONLY thing that can keep it boardless is the country gate under test.
vi.mock("@/lib/centralBank/governance", () => ({
  isBankGovernmentControlledLive: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/npp/generator", () => ({
  spawnTechnocratNpp: vi.fn(async () => ({ _id: new ObjectId(), name: "Technocrat" })),
}));

import { seedFomcBoards } from "./seedFomcBoard";

function makeDb(banks: Partial<CentralBank>[]) {
  const updates: Array<{ id: string; set: Record<string, unknown> }> = [];
  const db = {
    collection: (name: string) => {
      if (name === "centralBanks") {
        return {
          find: () => ({ toArray: async () => banks }),
          updateOne: async (filter: { _id: string }, update: { $set: Record<string, unknown> }) => {
            updates.push({ id: filter._id, set: update.$set });
          },
        };
      }
      // npps / characters collections touched by spawnTechnocratNpp are mocked away.
      return {
        findOne: async () => null,
        insertOne: async () => ({}),
        updateOne: async () => ({}),
      };
    },
  };
  return { db: db as unknown as Db, updates };
}

describe("seedFomcBoards — committee is US-only (#1195)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds a board for the US Fed", async () => {
    const { db, updates } = makeDb([{ _id: "US", countryId: "US" }]);
    const seeded = await seedFomcBoards(db, 0);
    expect(seeded).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("US");
    expect(Array.isArray(updates[0].set.fomcBoard)).toBe(true);
  });

  it("never seeds a board for non-US banks (BoE, ECB, BoJ...)", async () => {
    const { db, updates } = makeDb([
      { _id: "UK", countryId: "UK" },
      { _id: "ECB", countryId: "DE" },
      { _id: "JP", countryId: "JP" },
      { _id: "IE", countryId: "IE" },
    ]);
    const seeded = await seedFomcBoards(db, 0);
    expect(seeded).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("seeds only the US when a mixed set of banks is present", async () => {
    const { db, updates } = makeDb([
      { _id: "UK", countryId: "UK" },
      { _id: "US", countryId: "US" },
      { _id: "JP", countryId: "JP" },
    ]);
    const seeded = await seedFomcBoards(db, 0);
    expect(seeded).toBe(1);
    expect(updates.map((u) => u.id)).toEqual(["US"]);
  });
});
