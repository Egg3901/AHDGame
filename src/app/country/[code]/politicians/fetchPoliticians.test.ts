import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { fetchPoliticians } from "./fetchPoliticians";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("fetchPoliticians party labels", () => {
  beforeEach(() => vi.resetAllMocks());

  it("resolves a stored party ObjectId for players and NPPs", async () => {
    const partyId = new ObjectId("6a779f32e464c15609bfdb11");
    const party = {
      _id: partyId,
      sequentialId: 3,
      name: "Democratic Party",
      color: "#123456",
      countryId: "US",
    };
    const character = {
      _id: new ObjectId(),
      sequentialId: 12,
      name: "Player",
      party: partyId.toString(),
      countryId: "US",
      homeState: "UT",
      politicalInfluence: 10,
    };
    const npp = {
      _id: new ObjectId(),
      name: "NPP",
      party: partyId.toString(),
      countryId: "US",
      homeState: "UT",
      politicalInfluence: 5,
    };
    const collection = vi.fn((name: string) => {
      if (name === "characters") return { aggregate: () => ({ toArray: async () => [character] }) };
      const docs = name === "npps" ? [npp] : name === "politicalParties" ? [party] : [];
      const cursor = { toArray: async () => docs, project: () => cursor, sort: () => cursor };
      return { find: () => cursor };
    });
    vi.mocked(getDb).mockResolvedValue({ collection } as unknown as Awaited<
      ReturnType<typeof getDb>
    >);

    const result = await fetchPoliticians("US");

    expect(result.politicians).toHaveLength(2);
    expect(result.politicians.map((person) => person.partyName)).toEqual([
      "Democratic Party",
      "Democratic Party",
    ]);
    expect(result.politicians.map((person) => person.partyColor)).toEqual(["#123456", "#123456"]);
  });
});
