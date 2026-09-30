import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { loadFrenchEuropeanExecutiveParty } from "./billSponsorship";

describe("French autonomous European treaty sponsor", () => {
  it("uses the party of the seated NPP president without a government formation", async () => {
    const mem = createInMemoryDb();
    const nppId = new ObjectId();
    mem.seed("electedOfficials", [
      {
        _id: new ObjectId(),
        countryId: "FR",
        officeType: "president",
        characterId: null,
        nppId,
        party: "2",
      },
    ]);
    mem.seed("npps", [{ _id: nppId, party: "2" }]);
    expect(await loadFrenchEuropeanExecutiveParty(mem as unknown as Db)).toBe("2");
  });

  it("does not sponsor autonomously for a player president or conflicting party", async () => {
    const mem = createInMemoryDb();
    const nppId = new ObjectId();
    const presidentId = new ObjectId();
    mem.seed("electedOfficials", [
      {
        _id: presidentId,
        countryId: "FR",
        officeType: "president",
        characterId: new ObjectId(),
        nppId,
        party: "2",
      },
    ]);
    mem.seed("npps", [{ _id: nppId, party: "2" }]);
    expect(await loadFrenchEuropeanExecutiveParty(mem as unknown as Db)).toBeUndefined();
    await mem
      .collection("electedOfficials")
      .updateOne({ _id: presidentId }, { $set: { characterId: null, party: "5" } });
    expect(await loadFrenchEuropeanExecutiveParty(mem as unknown as Db)).toBeUndefined();
  });
});
