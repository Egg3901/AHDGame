import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateDEStatePartyOrgs } from "./deStatePartyOrgCalculations";
import { deParties } from "./deParties";
import { deRegions1953 } from "./deRegions1953";
import { ddRegions1953 } from "../dd/ddRegions1953";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

function seedParties(names: string[]) {
  const parties = names.map((name, i) => ({
    _id: new ObjectId(),
    countryId: "DE",
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
const DE_1953_PARTY_NAMES = deParties
  .filter((p) => !p.validForPresets || p.validForPresets.includes("1953-default"))
  .map((p) => p.name);

const seqOf = (name: string) => String(DE_1953_PARTY_NAMES.indexOf(name) + 1);

describe("calculateDEStatePartyOrgs — 1953 Bundesrepublik", () => {
  it("seeds only the 11 FRG Länder, never a DDR region id", async () => {
    seedParties(DE_1953_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "1953-default");
    const seeded = new Set(rows.map((r) => r.stateId));
    expect(seeded).toEqual(new Set(deRegions1953.map((r) => String(r._id))));
    expect(rows.every((r) => r.countryId === "DE")).toBe(true);
    expect(rows.every((r) => r.hasPresence)).toBe(true);
    // `statePartyOrg._id` is `${stateId}_${partySeqId}` with no country prefix,
    // so a DE row on a DDR region id would collide with the DDR's own National
    // Front org rows (both seeded in the same 1953 bootstrap).
    for (const ddRegion of ddRegions1953) {
      expect(seeded.has(String(ddRegion._id)), `DE must not seed DDR region ${ddRegion._id}`).toBe(
        false
      );
    }
  });

  it("gives the DP and the GB/BHE presence somewhere (the empty-field guard)", async () => {
    seedParties(DE_1953_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "1953-default");
    for (const name of ["Deutsche Partei", "Gesamtdeutscher Block/BHE"]) {
      const partyRows = rows.filter((r) => r.partyId === seqOf(name));
      expect(partyRows.length, `${name} presence`).toBeGreaterThan(0);
      expect(partyRows.every((r) => r.organization > 0)).toBe(true);
    }
    // Every Land is contested by at least three parties.
    for (const region of deRegions1953) {
      const inLand = rows.filter((r) => r.stateId === String(region._id));
      expect(inLand.length, `${String(region._id)} party presence`).toBeGreaterThanOrEqual(3);
    }
  });

  it("regression: the 2021 table gave DP and GB/BHE ZERO rows and invented DDR Länder", async () => {
    // `dp` / `gbbhe` have no slug in the 2021 dataset, so falling through to it
    // left both parties with no statePartyOrg row anywhere — and a seeded region
    // with no row for a party is a hard block in `canPartyFieldInState`.
    seedParties(DE_1953_PARTY_NAMES);
    const wrongEra = await calculateDEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(wrongEra.some((r) => r.partyId === seqOf("Deutsche Partei"))).toBe(false);
    expect(wrongEra.some((r) => r.partyId === seqOf("Gesamtdeutscher Block/BHE"))).toBe(false);
    expect(wrongEra.some((r) => r.stateId === "SN")).toBe(true);
  });

  it("puts the Union ahead of the SPD, as the September 1953 result did", async () => {
    seedParties(DE_1953_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "1953-default");
    const org = (stateId: string, name: string) =>
      rows.find((r) => r.stateId === stateId && r.partyId === seqOf(name))!.organization;
    // CDU/CSU 45.2% vs SPD 28.8% nationally — the 2021 table has this inverted.
    expect(org("NW", "Christlich Demokratische Union")).toBeGreaterThan(
      org("NW", "Sozialdemokratische Partei Deutschlands")
    );
    // CSU contests Bayern; the CDU stays out of it (and vice versa).
    expect(org("BY", "Christlich-Soziale Union in Bayern")).toBeGreaterThan(0);
    expect(
      rows.some((r) => r.stateId === "BY" && r.partyId === seqOf("Christlich Demokratische Union"))
    ).toBe(false);
    // The DP was a Lower-Saxon party, not a national one.
    expect(org("NI", "Deutsche Partei")).toBeGreaterThan(org("BW", "Deutsche Partei"));
    // The expellee bloc polled where the expellees were resettled.
    expect(org("SH", "Gesamtdeutscher Block/BHE")).toBeGreaterThan(
      org("NW", "Gesamtdeutscher Block/BHE")
    );
  });

  it("clamps organization to the 5-70 range", async () => {
    seedParties(DE_1953_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "1953-default");
    expect(rows.every((r) => r.organization >= 5 && r.organization <= 70)).toBe(true);
  });

  it("leaves the 1991 and 2019 branches untouched", async () => {
    const modern = [
      "Sozialdemokratische Partei Deutschlands",
      "Christlich Demokratische Union",
      "Christlich-Soziale Union in Bayern",
      "Bündnis 90/Die Grünen",
      "Freie Demokratische Partei",
      "Partei des Demokratischen Sozialismus",
    ];
    seedParties(modern);
    const rows1991 = await calculateDEStatePartyOrgs(db as unknown as Db, "1991-default");
    expect(new Set(rows1991.map((r) => r.stateId)).size).toBe(16);
    expect(rows1991.some((r) => r.stateId === "SN")).toBe(true);

    seedParties([...modern.slice(0, 5), "Die Linke", "Alternative für Deutschland"]);
    const rows2019 = await calculateDEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(new Set(rows2019.map((r) => r.stateId)).size).toBe(16);
  });
});
