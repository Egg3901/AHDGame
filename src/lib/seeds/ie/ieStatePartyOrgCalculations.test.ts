import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateIEStatePartyOrgs } from "./ieStatePartyOrgCalculations";
import { ieParties } from "./ieParties";
import { ieRegions1953 } from "./ieRegions1953";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

function seedParties(names: string[]) {
  const parties = names.map((name, i) => ({
    _id: new ObjectId(),
    countryId: "IE",
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

describe("calculateIEStatePartyOrgs", () => {
  it("produces 40 rows for the 2019-default preset (8 regions × 5 parties)", async () => {
    seedParties(["Fianna Fáil", "Fine Gael", "Sinn Féin", "Labour", "Green Party"]);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((r) => r.stateId)).size).toBe(8);
    expect(rows.every((r) => r.countryId === "IE")).toBe(true);
  });

  it("produces 40 rows for the 1991-default preset (8 regions × 5 parties)", async () => {
    seedParties(["Fianna Fáil", "Fine Gael", "Labour", "Workers' Party", "Progressive Democrats"]);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "1991-default");
    expect(rows).toHaveLength(40);
  });

  it("defaults to the 2019-default vote-share table when preset is unset", async () => {
    seedParties(["Fianna Fáil", "Fine Gael", "Sinn Féin", "Labour", "Green Party"]);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(rows).toHaveLength(40);
    // Sinn Féin only appears in the 2024 table, confirming the 2019-default branch ran.
    const sinnFeinPartySeqId = "3";
    expect(rows.some((r) => r.partyId === sinnFeinPartySeqId)).toBe(true);
  });

  it("clamps organization to the 5–70 range", async () => {
    seedParties(["Fianna Fáil", "Fine Gael", "Sinn Féin", "Labour", "Green Party"]);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(rows.every((r) => r.organization >= 5 && r.organization <= 70)).toBe(true);
  });

  it("skips parties that aren't seeded under the active preset", async () => {
    seedParties(["Fianna Fáil", "Fine Gael"]); // only 2 of 5
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(rows).toHaveLength(16); // 8 regions × 2 parties
  });

  it("keys row _id by `${regionId}_${partySeqId}` to match the JP/DE pattern", async () => {
    seedParties(["Fianna Fáil"]);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(rows[0]?._id).toMatch(/^[A-Z_]+_1$/);
    expect(rows[0]?.partyId).toBe("1");
  });

  it("seeds hasPresence=true and the 5% stateTaxRate default for every row", async () => {
    seedParties(["Fianna Fáil", "Fine Gael", "Sinn Féin", "Labour", "Green Party"]);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(rows.every((r) => r.hasPresence === true)).toBe(true);
    expect(rows.every((r) => r.stateTaxRate === 5)).toBe(true);
  });
});

/** Exactly what `ensureDefaultParties` seeds for a 1953 reset. */
const IE_1953_PARTY_NAMES = ieParties
  .filter((p) => !p.validForPresets || p.validForPresets.includes("1953-default"))
  .map((p) => p.name);

describe("calculateIEStatePartyOrgs — 1954 Dáil", () => {
  const seqOf = (name: string) => String(IE_1953_PARTY_NAMES.indexOf(name) + 1);

  it("seeds presence for every (region × 1953 party) pair", async () => {
    seedParties(IE_1953_PARTY_NAMES);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "1953-default");
    // 8 NUTS-III regions × FF / FG / Labour.
    expect(rows).toHaveLength(ieRegions1953.length * 3);
    expect(new Set(rows.map((r) => r.stateId))).toEqual(
      new Set(ieRegions1953.map((r) => String(r._id)))
    );
    expect(rows.every((r) => r.countryId === "IE")).toBe(true);
    expect(rows.every((r) => r.hasPresence)).toBe(true);
  });

  it("reproduces the 1954 two-and-a-half party system, not the 2024 field", async () => {
    seedParties(IE_1953_PARTY_NAMES);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "1953-default");
    const org = (stateId: string, name: string) =>
      rows.find((r) => r.stateId === stateId && r.partyId === seqOf(name))!.organization;
    for (const region of ieRegions1953) {
      const id = String(region._id);
      // FF led every region except Dublin (#3873: FG's real Dublin-southside
      // base means DUB is FG-led, not just narrower — see ieRegionVoteShares.ts).
      // Labour trails both everywhere.
      if (id === "DUB") {
        expect(org(id, "Fine Gael"), `FG in ${id}`).toBeGreaterThan(org(id, "Fianna Fáil"));
      } else {
        expect(org(id, "Fianna Fáil"), `FF in ${id}`).toBeGreaterThan(org(id, "Fine Gael"));
      }
      expect(org(id, "Fine Gael"), `FG in ${id}`).toBeGreaterThan(org(id, "Labour"));
    }
    // FF still leads Fine Gael nationally (aggregate across regions) even
    // though Dublin flips — the seed keeps FF's real 1954 dominance intact.
    const sum = (name: string) =>
      ieRegions1953.reduce((acc, r) => acc + org(String(r._id), name), 0);
    expect(sum("Fianna Fáil")).toBeGreaterThan(sum("Fine Gael"));
    // Labour's belt (Dublin / Wexford) against the west, where it barely stood.
    expect(org("WEX", "Labour")).toBeGreaterThan(org("GAL", "Labour"));
    expect(org("DUB", "Labour")).toBeGreaterThan(org("DON", "Labour"));
  });

  it("regression: the 2024 table understated both big parties", async () => {
    // The pre-fix fall-through. FF/FG/Labour all resolve by name in the 2024
    // table, so IE was never presence-blocked (unlike DE) — the bug was purely
    // that a 1954 world was calibrated to a fragmented 2024 field.
    seedParties(IE_1953_PARTY_NAMES);
    const era = await calculateIEStatePartyOrgs(db as unknown as Db, "1953-default");
    const wrongEra = await calculateIEStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(wrongEra).toHaveLength(era.length);
    const ffOrg = (rows: typeof era, stateId: string) =>
      rows.find((r) => r.stateId === stateId && r.partyId === seqOf("Fianna Fáil"))!.organization;
    for (const region of ieRegions1953) {
      const id = String(region._id);
      expect(ffOrg(era, id), `FF in ${id}`).toBeGreaterThan(ffOrg(wrongEra, id));
    }
  });

  it("clamps organization to the 5–70 range", async () => {
    seedParties(IE_1953_PARTY_NAMES);
    const rows = await calculateIEStatePartyOrgs(db as unknown as Db, "1953-default");
    expect(rows.every((r) => r.organization >= 5 && r.organization <= 70)).toBe(true);
  });
});
