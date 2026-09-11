import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateDEStatePartyOrgs } from "./deStatePartyOrgCalculations";
import { DE_LAND_VOTE_SHARES_2025 } from "./deLandVoteShares2025";
import { deParties } from "./deParties";

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

/** Exactly what `ensureDefaultParties` seeds for a 2027 reset. */
const DE_2027_PARTY_NAMES = deParties
  .filter((p) => !p.validForPresets || p.validForPresets.includes("2027-default"))
  .map((p) => p.name);

const seqOf = (name: string) => String(DE_2027_PARTY_NAMES.indexOf(name) + 1);

describe("DE_LAND_VOTE_SHARES_2025", () => {
  it("covers all 16 Länder", () => {
    expect(Object.keys(DE_LAND_VOTE_SHARES_2025).sort()).toEqual(
      [
        "BW",
        "BY",
        "NW",
        "HE",
        "RP",
        "SL",
        "NI",
        "SH",
        "HH",
        "BRE",
        "BE",
        "BB",
        "MV",
        "SN",
        "ST",
        "TH",
      ].sort()
    );
  });

  it("CSU contests only Bayern; CDU stays out of it", () => {
    for (const [landId, votes] of Object.entries(DE_LAND_VOTE_SHARES_2025)) {
      if (landId === "BY") {
        expect(votes, "BY has csu").toHaveProperty("csu", 37);
        expect(votes, "BY has no cdu").not.toHaveProperty("cdu");
      } else {
        expect(votes, `${landId} has cdu`).toHaveProperty("cdu");
        expect(votes, `${landId} has no csu`).not.toHaveProperty("csu");
      }
    }
  });

  it("matches the 2025 outcome anchors: AfD first in the East, SPD holds Bremen", () => {
    expect(DE_LAND_VOTE_SHARES_2025.TH.afd).toBe(39);
    expect(DE_LAND_VOTE_SHARES_2025.SN.afd).toBe(37);
    expect(DE_LAND_VOTE_SHARES_2025.ST.afd).toBe(37);
    expect(DE_LAND_VOTE_SHARES_2025.MV.afd).toBe(35);
    expect(DE_LAND_VOTE_SHARES_2025.BB.afd).toBe(33);
    expect(DE_LAND_VOTE_SHARES_2025.BRE.spd).toBe(23);
    expect(DE_LAND_VOTE_SHARES_2025.BE.lnk).toBe(20);
    expect(DE_LAND_VOTE_SHARES_2025.BY.csu).toBe(37);
  });
});

describe("2027-default DE seed validity", () => {
  it("every continuing modern default is valid for 2027", () => {
    for (const name of [
      "Sozialdemokratische Partei Deutschlands",
      "Christlich Demokratische Union",
      "Christlich-Soziale Union in Bayern",
      "Bündnis 90/Die Grünen",
      "Freie Demokratische Partei",
      "Die Linke",
      "Alternative für Deutschland",
    ]) {
      expect(DE_2027_PARTY_NAMES, `${name} valid for 2027`).toContain(name);
    }
  });

  it("era-locked parties stay out of 2027", () => {
    for (const name of [
      "Deutsche Partei",
      "Gesamtdeutscher Block/BHE",
      "Partei des Demokratischen Sozialismus",
    ]) {
      expect(DE_2027_PARTY_NAMES, `${name} excluded from 2027`).not.toContain(name);
    }
  });
});

describe("calculateDEStatePartyOrgs, 2027 dispatch (2025 results)", () => {
  it("seeds all 16 Länder from the 2025 table", async () => {
    seedParties(DE_2027_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "2027-default");
    expect(new Set(rows.map((r) => r.stateId)).size).toBe(16);
    expect(rows.every((r) => r.countryId === "DE")).toBe(true);
  });

  it("reflects the 2025 outcome: AfD ahead in Thuringia, Union ahead in BW, Linke ahead in Berlin", async () => {
    seedParties(DE_2027_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "2027-default");
    const org = (stateId: string, name: string) =>
      rows.find((r) => r.stateId === stateId && r.partyId === seqOf(name))!.organization;
    expect(org("TH", "Alternative für Deutschland")).toBeGreaterThan(
      org("TH", "Christlich Demokratische Union")
    );
    expect(org("BW", "Christlich Demokratische Union")).toBeGreaterThan(
      org("BW", "Alternative für Deutschland")
    );
    expect(org("BE", "Die Linke")).toBeGreaterThan(org("BE", "Christlich Demokratische Union"));
  });

  it("keeps CSU in Bayern only and CDU out of Bayern", async () => {
    seedParties(DE_2027_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "2027-default");
    expect(
      rows.some(
        (r) => r.stateId === "BY" && r.partyId === seqOf("Christlich-Soziale Union in Bayern")
      )
    ).toBe(true);
    expect(
      rows.some((r) => r.stateId === "BY" && r.partyId === seqOf("Christlich Demokratische Union"))
    ).toBe(false);
  });

  it("seeds the FDP everywhere despite its sub-threshold 2025 result", async () => {
    seedParties(DE_2027_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "2027-default");
    const fdpRows = rows.filter((r) => r.partyId === seqOf("Freie Demokratische Partei"));
    expect(fdpRows.length).toBe(16);
  });

  it("emits no PDS rows under 2027 (1991-only party not in the DB)", async () => {
    seedParties(DE_2027_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "2027-default");
    const modern = [
      "Sozialdemokratische Partei Deutschlands",
      "Christlich Demokratische Union",
      "Christlich-Soziale Union in Bayern",
      "Bündnis 90/Die Grünen",
      "Freie Demokratische Partei",
      "Die Linke",
      "Alternative für Deutschland",
    ];
    const byName = new Map(modern.map((n) => [seqOf(n), n]));
    for (const r of rows) {
      expect(byName.has(r.partyId), `row party ${r.partyId} is a 2027 party`).toBe(true);
    }
  });

  it("clamps organization to the 5-70 range", async () => {
    seedParties(DE_2027_PARTY_NAMES);
    const rows = await calculateDEStatePartyOrgs(db as unknown as Db, "2027-default");
    expect(rows.every((r) => r.organization >= 5 && r.organization <= 70)).toBe(true);
  });
});
