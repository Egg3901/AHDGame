import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { firstDaysComplete, isInFirstDays, loadFirstDays } from "./firstDays";

const NOW = new Date("2026-10-14T12:00:00Z");
const H = 3_600_000;

function character(over: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "US",
    homeState: "CA",
    party: "independent",
    politicalInfluence: 0,
    currentOffice: null,
    createdAt: new Date(NOW.getTime() - 2 * H),
    tutorial: { experience: "skip", interests: [], chosenAt: NOW },
    ...over,
  } as unknown as Parameters<typeof loadFirstDays>[1];
}

describe("isInFirstDays", () => {
  it("covers the first 72 hours of a character", () => {
    expect(isInFirstDays({ createdAt: new Date(NOW.getTime() - 71 * H) }, NOW.getTime())).toBe(
      true
    );
    expect(isInFirstDays({ createdAt: new Date(NOW.getTime() - 73 * H) }, NOW.getTime())).toBe(
      false
    );
  });
});

describe("loadFirstDays", () => {
  let db: MockDb;
  const raceSoon = new ObjectId();
  const raceLater = new ObjectId();
  const raceClosed = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    db.collection("actionLogs").countDocuments.mockResolvedValue(1);
    db.collection("electionCandidates").countDocuments.mockImplementation(
      async (filter: Record<string, unknown>) => ("characterId" in filter ? 0 : 4)
    );
    db.collection("elections").find.mockReturnValue({
      limit: () => ({
        toArray: async () => [
          {
            _id: raceLater,
            electionType: "governor",
            primaryEndTime: new Date(NOW.getTime() + 50 * H),
          },
          { _id: raceClosed, electionType: "senate", primaryEndTime: new Date(NOW.getTime() - H) },
          {
            _id: raceSoon,
            electionType: "stateSenate",
            primaryEndTime: new Date(NOW.getTime() + 5 * H),
          },
        ],
      }),
    });
  });

  it("lists home races still taking candidates, soonest first, and the goals' state", async () => {
    const data = await loadFirstDays(db as unknown as Db, character(), NOW);
    expect(data).not.toBeNull();
    expect(data!.races.map((r) => r.id)).toEqual([raceSoon.toString(), raceLater.toString()]);
    expect(data!.races[0]).toMatchObject({ closesInHours: 5, candidates: 4 });
    expect(data!).toMatchObject({
      campaigns: 1,
      campaignGoal: 3,
      joinedParty: false,
      enteredRace: false,
      skippedTutorial: true,
    });
    expect(db.collectionMocks.elections!.find.mock.calls[0][0]).toEqual({
      countryId: "US",
      state: "CA",
      status: { $in: ["upcoming", "active"] },
    });
  });

  it("is hidden after the first days", async () => {
    const old = character({ createdAt: new Date(NOW.getTime() - 100 * H) });
    expect(await loadFirstDays(db as unknown as Db, old, NOW)).toBeNull();
  });

  it("is hidden once every goal is done", async () => {
    db.collection("actionLogs").countDocuments.mockResolvedValue(3);
    db.collection("electionCandidates").countDocuments.mockResolvedValue(1);
    expect(await loadFirstDays(db as unknown as Db, character({ party: "4" }), NOW)).toBeNull();
  });

  it("treats holding office as having entered a race", () => {
    expect(
      firstDaysComplete({
        influence: 5,
        campaigns: 3,
        campaignGoal: 3,
        joinedParty: true,
        enteredRace: true,
        races: [],
        skippedTutorial: false,
      })
    ).toBe(true);
  });
});
