import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { computeMapOfficeholders } from "./officeholderService";

function mockDb(rows: Record<string, unknown[]>) {
  const find = vi.fn((name: string, ..._args: unknown[]) => ({
    toArray: async () => rows[name] ?? [],
  }));
  const db = {
    collection: (name: string) => ({ find: (...args: unknown[]) => find(name, ...args) }),
  } as unknown as Db;
  return { db, find };
}

describe("map officeholders", () => {
  it("batches player and NPP portraits, excludes vacancies and retains multi-seat counts", async () => {
    const player = new ObjectId(),
      npp = new ObjectId();
    const { db, find } = mockDb({
      electedOfficials: [
        {
          _id: new ObjectId(),
          state: "CA",
          officeType: "house",
          characterId: player,
          characterName: "Player official",
          party: "1",
          seatsHeld: 4,
        },
        {
          _id: new ObjectId(),
          state: "CA",
          officeType: "senate",
          nppId: npp,
          characterName: "NPP official",
          party: "Example party",
        },
        { _id: new ObjectId(), state: "CA", officeType: "governor", characterName: "Vacant" },
      ],
      politicalParties: [{ sequentialId: 1, name: "Example party", color: "#abc123" }],
      characters: [{ _id: player, avatarUrl: "/player.png" }],
      npps: [{ _id: npp, avatarUrl: "/npp.png" }],
    });
    const result = await computeMapOfficeholders(db, "US", ["CA"]);
    expect(result.CA).toHaveLength(2);
    expect(result.CA[0]).toMatchObject({
      avatarUrl: "/player.png",
      seats: 4,
      partyName: "Example party",
    });
    expect(result.CA[1]).toMatchObject({ avatarUrl: "/npp.png", seats: 1, party: "1" });
    expect(find).toHaveBeenCalledTimes(4);
    expect(find.mock.calls[0][1]).toMatchObject({
      state: { $in: ["CA"] },
      $or: [{ countryId: "US" }, { countryId: { $exists: false } }],
    });
    expect(find.mock.calls[3][2]).toEqual({ projection: { _id: 1, avatarUrl: 1 } });
  });
  it("skips portrait reads when no seats are filled", async () => {
    const { db, find } = mockDb({});
    expect(await computeMapOfficeholders(db, "US", [])).toEqual({});
    expect(find).toHaveBeenCalledTimes(2);
  });
});
