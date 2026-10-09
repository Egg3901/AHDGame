import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { loadRaceCampaignMultiplier, type RaceCampaignEffectsMemo } from "./raceCampaignEffects";

function stubDb(collections: Record<string, Record<string, unknown>[]>, calls: string[]): Db {
  return {
    collection(name: string) {
      return {
        find: () => {
          calls.push(name);
          return { toArray: async () => collections[name] ?? [] };
        },
      };
    },
  } as unknown as Db;
}

describe("loadRaceCampaignMultiplier", () => {
  const electionId = new ObjectId();
  const candidate = new ObjectId();
  const rival = new ObjectId();

  it("applies Ground Game GOTV everywhere and swing only in swing regions", async () => {
    const db = stubDb(
      {
        campaigns: [
          {
            electionId,
            candidateId: candidate,
            groundGameTree: { starter: true, a: 0, b: 1, c: 0 },
            groundGameLevel: 0,
          },
        ],
      },
      []
    );
    const args = { electionId, countryId: "US", regionId: "PA", currentTurn: 10 };
    const swing = await loadRaceCampaignMultiplier(db, { ...args, isSwingRegion: true });
    const safe = await loadRaceCampaignMultiplier(db, { ...args, isSwingRegion: false });
    expect(swing!(candidate.toString())).toBeGreaterThan(safe!(candidate.toString()));
    expect(safe!(candidate.toString())).toBeGreaterThan(1);
    expect(swing!(rival.toString())).toBe(1);
  });

  it("returns null when nobody in the race has ground game or offices", async () => {
    const db = stubDb({}, []);
    const mult = await loadRaceCampaignMultiplier(db, {
      electionId,
      countryId: "US",
      regionId: "PA",
      currentTurn: 1,
      isSwingRegion: true,
    });
    expect(mult).toBeNull();
  });

  it("loads each source once per turn when memoised", async () => {
    const calls: string[] = [];
    const db = stubDb({}, calls);
    const memo: RaceCampaignEffectsMemo = {};
    for (let i = 0; i < 5; i++) {
      await loadRaceCampaignMultiplier(db, {
        electionId: new ObjectId(),
        countryId: "US",
        regionId: "PA",
        currentTurn: 1,
        isSwingRegion: false,
        memo,
      });
    }
    expect(calls.sort()).toEqual(["campaignFieldOffices", "campaigns"]);
  });

  it("stacks field offices on top of ground game", async () => {
    const db = stubDb(
      {
        campaignFieldOffices: [
          {
            electionId,
            candidateId: candidate,
            countryId: "UK",
            regionId: "LON",
            electorateShare: 0,
            yieldFactor: 1,
            openedTurn: 0,
          },
        ],
      },
      []
    );
    const mult = await loadRaceCampaignMultiplier(db, {
      electionId,
      countryId: "UK",
      regionId: "LON",
      currentTurn: 10,
      isSwingRegion: false,
    });
    expect(mult!(candidate.toString())).toBeGreaterThan(1);
    expect(mult!(rival.toString())).toBe(1);
  });
});
