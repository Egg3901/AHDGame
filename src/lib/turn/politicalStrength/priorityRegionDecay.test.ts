import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { processPriorityRegionDecay } from "./priorityRegionDecay";

interface FakePartyRow {
  _id: ObjectId;
  sequentialId: number;
  countryId: "US";
  isDefault: boolean;
  priorityRegion?: { stateIds: string[]; setAtTurn: number; setBy: ObjectId };
}

interface FakeStateRow {
  countryId: "US";
  partyId: string;
  stateId: string;
  organization: number;
}

function makeFakeDb(parties: FakePartyRow[], stateRows: FakeStateRow[]) {
  return {
    parties,
    stateRows,
    collection<T>(name: string) {
      if (name === "politicalParties") {
        return {
          find: (filter: Record<string, unknown>) => ({
            toArray: async () => {
              if ("priorityRegion" in filter) {
                return parties.filter((p) => p.priorityRegion !== undefined);
              }
              return parties;
            },
          }),
          updateOne: async (
            filter: { _id: ObjectId },
            update: { $set: { "priorityRegion.stateIds": string[] } }
          ) => {
            const party = parties.find((p) => p._id.equals(filter._id));
            if (!party?.priorityRegion) return { modifiedCount: 0 };
            party.priorityRegion.stateIds = update.$set["priorityRegion.stateIds"];
            return { modifiedCount: 1 };
          },
        } as unknown as ReturnType<T extends never ? never : never>;
      }
      if (name === "statePartyOrg") {
        return {
          find: (filter: { countryId: string; partyId: string; stateId: { $in: string[] } }) => ({
            toArray: async () =>
              stateRows.filter(
                (r) =>
                  r.countryId === filter.countryId &&
                  r.partyId === filter.partyId &&
                  filter.stateId.$in.includes(r.stateId)
              ),
          }),
        } as unknown as ReturnType<T extends never ? never : never>;
      }
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

describe("processPriorityRegionDecay", () => {
  let setBy: ObjectId;
  beforeEach(() => {
    setBy = new ObjectId();
  });

  it("evicts states where the party has no organization", async () => {
    const partyId = new ObjectId();
    const db = makeFakeDb(
      [
        {
          _id: partyId,
          sequentialId: 1,
          countryId: "US",
          isDefault: true,
          priorityRegion: { stateIds: ["CA", "TX", "FL"], setAtTurn: 50, setBy },
        },
      ],
      [
        { countryId: "US", partyId: "1", stateId: "CA", organization: 30 },
        { countryId: "US", partyId: "1", stateId: "TX", organization: 0 }, // evicted
        // FL row missing entirely → also evicted
      ]
    );
    const result = await processPriorityRegionDecay(db as unknown as never);
    expect(result.partiesScanned).toBe(1);
    expect(result.partiesWithCluster).toBe(1);
    expect(result.statesEvicted).toBe(2); // TX (0 org) and FL (no row)
    expect(db.parties[0].priorityRegion?.stateIds).toEqual(["CA"]);
  });

  it("does not modify clusters where every state is still eligible", async () => {
    const partyId = new ObjectId();
    const db = makeFakeDb(
      [
        {
          _id: partyId,
          sequentialId: 2,
          countryId: "US",
          isDefault: false,
          priorityRegion: { stateIds: ["CA", "TX"], setAtTurn: 50, setBy },
        },
      ],
      [
        { countryId: "US", partyId: "2", stateId: "CA", organization: 25 },
        { countryId: "US", partyId: "2", stateId: "TX", organization: 30 },
      ]
    );
    const result = await processPriorityRegionDecay(db as unknown as never);
    expect(result.statesEvicted).toBe(0);
    expect(db.parties[0].priorityRegion?.stateIds).toEqual(["CA", "TX"]);
  });

  it("skips parties with no priorityRegion", async () => {
    const db = makeFakeDb(
      [{ _id: new ObjectId(), sequentialId: 5, countryId: "US", isDefault: true }],
      []
    );
    const result = await processPriorityRegionDecay(db as unknown as never);
    expect(result.partiesScanned).toBe(0);
    expect(result.partiesWithCluster).toBe(0);
  });

  it("skips parties with empty stateIds array", async () => {
    const partyId = new ObjectId();
    const db = makeFakeDb(
      [
        {
          _id: partyId,
          sequentialId: 7,
          countryId: "US",
          isDefault: false,
          priorityRegion: { stateIds: [], setAtTurn: 50, setBy },
        },
      ],
      []
    );
    const result = await processPriorityRegionDecay(db as unknown as never);
    expect(result.partiesScanned).toBe(1);
    expect(result.partiesWithCluster).toBe(0);
    expect(result.statesEvicted).toBe(0);
  });
});
