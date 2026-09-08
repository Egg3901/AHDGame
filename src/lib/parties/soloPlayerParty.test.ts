import { describe, it, expect, vi } from "vitest";
import { type Db } from "mongodb";
import { isSoloPlayerParty } from "./soloPlayerParty";

function makeDb(playerCount: number) {
  const countDocuments = vi.fn().mockResolvedValue(playerCount);
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name !== "characters") throw new Error(`unexpected collection ${name}`);
      return { countDocuments };
    }),
  } as unknown as Db;
  return { db, countDocuments };
}

const PARTY = { sequentialId: 3, countryId: "UK" as const };

describe("isSoloPlayerParty", () => {
  it("is true for a party with one player", () => {
    return expect(isSoloPlayerParty(makeDb(1).db, PARTY)).resolves.toBe(true);
  });

  it("is true for a party with no players at all", () => {
    // An all-NPP party has nobody to countersign either. In practice no
    // player can act as its officer anyway, so the mode never matters.
    return expect(isSoloPlayerParty(makeDb(0).db, PARTY)).resolves.toBe(true);
  });

  it("is false as soon as a second player exists", () => {
    return expect(isSoloPlayerParty(makeDb(2).db, PARTY)).resolves.toBe(false);
  });

  it("counts players by party and country, capped at two", async () => {
    const { db, countDocuments } = makeDb(2);
    await isSoloPlayerParty(db, PARTY);
    expect(countDocuments).toHaveBeenCalledWith({ party: "3", countryId: "UK" }, { limit: 2 });
  });

  it("counts characters, never the party's memberCount", async () => {
    // memberCount is characters + NPPs. NPPs cannot approve anything, so
    // using it would wrongly deny the fallback to a lone player in a
    // party padded out with NPP members.
    const { db } = makeDb(1);
    await expect(isSoloPlayerParty(db, { sequentialId: 1, countryId: "NG" })).resolves.toBe(true);
  });
});
