import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateBRStatePartyOrgs } from "./brStatePartyOrgCalculations";
import { brParties } from "./brParties";
import { brRegions1953 } from "./brRegions1953";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

function seedParties(names: string[]) {
  const parties = names.map((name, i) => ({
    _id: new ObjectId(),
    countryId: "BR",
    sequentialId: i + 1,
    name,
  }));
  db.collectionMocks["politicalParties"] = {
    ...db.collection("politicalParties"),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue(parties),
      project: vi.fn().mockReturnThis(),
    }),
  } as MockDb["collectionMocks"][string];
}

/** Exactly what `ensureDefaultParties` seeds for a 1953 reset. */
const BR_1953_PARTY_NAMES = brParties
  .filter((p) => !p.validForPresets || p.validForPresets.includes("1953-default"))
  .map((p) => p.name);

describe("calculateBRStatePartyOrgs — 1953 Second Republic", () => {
  it("seeds presence for every (region × 1953 party) pair", async () => {
    seedParties(BR_1953_PARTY_NAMES);
    const rows = await calculateBRStatePartyOrgs(db as unknown as Db, "1953-default");
    // 5 macro-regions × PSD / UDN / PTB.
    expect(rows).toHaveLength(brRegions1953.length * 3);
    expect(new Set(rows.map((r) => r.stateId))).toEqual(
      new Set(brRegions1953.map((r) => String(r._id)))
    );
    expect(rows.every((r) => r.countryId === "BR")).toBe(true);
    expect(rows.every((r) => r.hasPresence)).toBe(true);
  });

  it("gives every 1953 party presence in every region (the empty-field guard)", async () => {
    seedParties(BR_1953_PARTY_NAMES);
    const rows = await calculateBRStatePartyOrgs(db as unknown as Db, "1953-default");
    for (const region of brRegions1953) {
      const parties = rows.filter((r) => r.stateId === String(region._id));
      expect(parties.length, `${String(region._id)} party presence`).toBe(3);
      expect(parties.every((r) => r.organization > 0)).toBe(true);
    }
  });

  it("regression: the 2019 table would have seeded ZERO rows for 1953", async () => {
    // None of pt / pl / mdb / uniao / psd-modern is preset-valid in 1953, so
    // falling through to the 2019 dataset resolved no party at all and BR
    // opened with no party organization anywhere (the pre-fix production bug).
    seedParties(BR_1953_PARTY_NAMES);
    const wrongEra = await calculateBRStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(wrongEra).toHaveLength(0);
  });

  it("puts PTB ahead of PSD in the Sul (Vargas's Rio Grande do Sul base)", async () => {
    seedParties(BR_1953_PARTY_NAMES);
    const rows = await calculateBRStatePartyOrgs(db as unknown as Db, "1953-default");
    const seqOf = (name: string) => String(BR_1953_PARTY_NAMES.indexOf(name) + 1);
    const sul = (name: string) =>
      rows.find((r) => r.stateId === "SUL" && r.partyId === seqOf(name))!.organization;
    expect(sul("Partido Trabalhista Brasileiro")).toBeGreaterThan(
      sul("Partido Social Democrático")
    );
    // ...and PSD still leads nationally, as it did in the 1950 Câmara.
    const nordeste = (name: string) =>
      rows.find((r) => r.stateId === "NORDESTE" && r.partyId === seqOf(name))!.organization;
    expect(nordeste("Partido Social Democrático")).toBeGreaterThan(
      nordeste("Partido Trabalhista Brasileiro")
    );
  });

  it("leaves the 1991 and 2019 branches untouched", async () => {
    seedParties([
      "Partido do Movimento Democrático Brasileiro",
      "Partido da Frente Liberal",
      "Partido dos Trabalhadores",
      "PSD",
    ]);
    const rows1991 = await calculateBRStatePartyOrgs(db as unknown as Db, "1991-default");
    expect(rows1991).toHaveLength(20); // 5 regions × 4 resolvable parties

    seedParties(["Partido dos Trabalhadores", "Partido Liberal", "MDB", "União Brasil", "PSD"]);
    const rows2019 = await calculateBRStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(rows2019).toHaveLength(25); // 5 regions × 5 parties
  });
});
