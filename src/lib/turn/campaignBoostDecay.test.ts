import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { processCampaignBoostDecay } from "./campaignBoostDecay";

function fakeDb(elections: Record<string, unknown>[]): {
  db: Db;
  elections: Record<string, unknown>[];
} {
  const db = {
    collection(name: string) {
      if (name === "gameState") return { findOne: async () => ({ redistrictingEnabled: true }) };
      return {
        find: () => ({ toArray: async () => elections }),
        async updateOne(filter: { _id: unknown }, update: { $set: Record<string, unknown> }) {
          const e = elections.find((x) => x._id === filter._id);
          if (e) Object.assign(e, update.$set);
          return { acknowledged: true };
        },
      };
    },
  } as unknown as Db;
  return { db, elections };
}

describe("processCampaignBoostDecay", () => {
  it("decays each election's boosts by one turn", async () => {
    const { db, elections } = fakeDb([
      { _id: "e1", districtCampaignBoosts: { "1": { "2": 7.5 } } },
    ]);
    const res = await processCampaignBoostDecay(10, new Date(), db);
    expect(res.electionsDecayed).toBe(1);
    expect(
      (elections[0].districtCampaignBoosts as Record<string, Record<string, number>>)["1"]["2"]
    ).toBe(7); // 7.5 - 0.5
  });
});
