import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { loadNominationPeople } from "./nominationPeople";

function fakeDb(data: Record<string, unknown[]>): Db {
  return {
    collection: (name: string) => ({
      find: () => ({ toArray: async () => data[name] ?? [] }),
    }),
  } as unknown as Db;
}

const presidentId = new ObjectId();
const nomineeCharId = new ObjectId();
const nomineeNppId = new ObjectId();

const db = fakeDb({
  characters: [
    { _id: presidentId, sequentialId: 12, avatarUrl: "https://cdn/p.png", party: "1" },
    { _id: nomineeCharId, sequentialId: 40, avatarUrl: "https://cdn/n.png", party: "7" },
  ],
  npps: [{ _id: nomineeNppId, sequentialId: 9, avatarUrl: "https://cdn/npp.png", party: "1" }],
  politicalParties: [
    { sequentialId: 1, name: "Democratic Party", color: "#3B82F6" },
    { sequentialId: 7, name: "Liberty Party", color: "#f59e0b" },
  ],
});

describe("loadNominationPeople", () => {
  it("resolves player nominee and nominator portraits, profile links and party names", async () => {
    const [row] = await loadNominationPeople(db, "US", [
      {
        nomineeMode: "character",
        nomineeCharacterId: nomineeCharId,
        nomineeName: "Low Thia Khiang",
        nomineeParty: "7",
        proposedByPresidentId: presidentId,
        proposedByPresidentName: "Flowery Dreemurr",
      },
    ]);
    expect(row.nominee).toEqual({
      name: "Low Thia Khiang",
      href: "/character/40",
      avatarUrl: "https://cdn/n.png",
      partyName: "Liberty Party",
      partyColor: "#f59e0b",
    });
    expect(row.nominator).toMatchObject({
      name: "Flowery Dreemurr",
      href: "/character/12",
      avatarUrl: "https://cdn/p.png",
      partyName: "Democratic Party",
    });
  });

  it("links NPP nominees to the NPP profile", async () => {
    const [row] = await loadNominationPeople(db, "US", [
      { nomineeMode: "npp", nomineeNppId, nomineeName: "Scholar", nomineeParty: "1" },
    ]);
    expect(row.nominee.href).toBe("/politicians/npp/9");
    expect(row.nominee.avatarUrl).toBe("https://cdn/npp.png");
    expect(row.nominator).toMatchObject({ name: "President", href: null, avatarUrl: null });
  });

  it("never surfaces a raw party id when the party is unknown", async () => {
    const [row] = await loadNominationPeople(db, "US", [
      { nomineeName: "Ghost", nomineeParty: "99", nomineeCharacterId: new ObjectId() },
    ]);
    expect(row.nominee).toMatchObject({ partyName: null, partyColor: null, href: null });
  });
});
