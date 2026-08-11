import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  CONTINGENT_HOUSE_STATE_IDS,
  HOUSE_CONTINGENT_THRESHOLD,
} from "@/lib/turn/election/contingentElection";

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("loadContingentElectionData", () => {
  let db: MockDb;
  const electionId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of ["electedOfficials", "politicalParties", "characters", "npps"]) {
      db.collection(name);
    }
  });

  it("includes all 50 House states when no officials are seated", async () => {
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));

    const demId = new ObjectId();
    const { loadContingentElectionData } = await import("./loadContingentElectionData");
    const result = await loadContingentElectionData(
      db as unknown as Db,
      electionId,
      "US",
      [
        {
          _id: demId,
          party: "1",
          characterId: new ObjectId(),
          isNPP: false,
        },
      ] as never,
      { [demId.toString()]: 300 }
    );

    expect(result.houseDelegations).toHaveLength(CONTINGENT_HOUSE_STATE_IDS.length);
    expect(result.houseDelegations.every((d) => d.voters.length === 0)).toBe(true);
    expect(result.chamberSnapshot).toBeDefined();
  });

  it("excludes president and vice president characters from chamber voters", async () => {
    const repCharId = new ObjectId();
    const presCharId = new ObjectId();
    db.collectionMocks["electedOfficials"]!.find.mockImplementation(
      (filter: Record<string, unknown>) => {
        if (filter.officeType === "house") {
          return makeCursor([
            {
              state: "CA",
              characterId: repCharId,
              party: "1",
              officeType: "house",
            },
            {
              state: "TX",
              characterId: presCharId,
              party: "2",
              officeType: "house",
            },
          ]);
        }
        return makeCursor([]);
      }
    );
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([
        { _id: repCharId, party: "1", policies: { economic: 0, social: 0 } },
        {
          _id: presCharId,
          party: "2",
          policies: { economic: 0, social: 0 },
          currentOffice: { type: "president" },
        },
      ])
    );
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));

    const demId = new ObjectId();
    const { loadContingentElectionData } = await import("./loadContingentElectionData");
    const result = await loadContingentElectionData(
      db as unknown as Db,
      electionId,
      "US",
      [{ _id: demId, party: "1", characterId: new ObjectId(), isNPP: false }] as never,
      { [demId.toString()]: 300 }
    );

    const ca = result.houseDelegations.find((d) => d.stateId === "CA");
    const tx = result.houseDelegations.find((d) => d.stateId === "TX");
    expect(ca?.voters).toHaveLength(1);
    expect(tx?.voters).toHaveLength(0);
  });

  it("reuses frozen chamber snapshot without querying electedOfficials", async () => {
    const snapshot = {
      capturedAt: new Date(),
      houseDelegations: [
        { stateId: "CA", voters: [{ id: "v1", party: "1", economic: 0, social: 0 }] },
      ],
      senators: [{ id: "s1", party: "1", economic: 0, social: 0 }],
    };
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["characters"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));

    const demId = new ObjectId();
    const { loadContingentElectionData } = await import("./loadContingentElectionData");
    const result = await loadContingentElectionData(
      db as unknown as Db,
      electionId,
      "US",
      [{ _id: demId, party: "1", characterId: new ObjectId(), isNPP: false }] as never,
      { [demId.toString()]: 300 },
      { chamberSnapshot: snapshot }
    );

    expect(db.collectionMocks["electedOfficials"]!.find).not.toHaveBeenCalled();
    expect(result.chamberSnapshot).toBeUndefined();
    expect(result.houseDelegations.find((d) => d.stateId === "CA")?.voters).toHaveLength(1);
  });

  it("builds evByEligibleId for president and VP tickets", async () => {
    db.collectionMocks["electedOfficials"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["politicalParties"]!.find.mockReturnValue(makeCursor([]));
    const vpCharId = new ObjectId();
    db.collectionMocks["characters"]!.find.mockReturnValue(
      makeCursor([{ _id: vpCharId, party: "1", policies: { economic: 0, social: 0 } }])
    );
    db.collectionMocks["npps"]!.find.mockReturnValue(makeCursor([]));

    const demId = new ObjectId();
    const gopId = new ObjectId();
    const { loadContingentElectionData } = await import("./loadContingentElectionData");
    const result = await loadContingentElectionData(
      db as unknown as Db,
      electionId,
      "US",
      [
        {
          _id: demId,
          party: "1",
          characterId: new ObjectId(),
          runningMateId: vpCharId,
          isNPP: false,
        },
        { _id: gopId, party: "2", characterId: new ObjectId(), isNPP: false },
      ] as never,
      { [demId.toString()]: 269, [gopId.toString()]: 269 }
    );

    expect(result.evByEligibleId?.[demId.toString()]).toBe(269);
    expect(result.evByEligibleId?.[vpCharId.toString()]).toBe(269);
    expect(HOUSE_CONTINGENT_THRESHOLD).toBe(26);
  });
});
