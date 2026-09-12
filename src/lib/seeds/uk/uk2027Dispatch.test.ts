import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateUKStatePartyOrgs } from "./ukStatePartyOrgCalculations";
import { ukParties } from "./ukParties";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

function seedParties(names: string[]) {
  const parties = names.map((name, i) => ({
    _id: new ObjectId(),
    countryId: "UK",
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
const UK_2027_PARTY_NAMES = ukParties
  .filter((p) => !p.validForPresets || p.validForPresets.includes("2027-default"))
  .map((p) => p.name);

const seqOf = (name: string) => String(UK_2027_PARTY_NAMES.indexOf(name) + 1);

describe("2027-default UK seed validity", () => {
  it("every continuing modern default is valid for 2027, including Reform UK", () => {
    for (const name of [
      "Labour Party",
      "Conservative Party",
      "Liberal Democrats",
      "Scottish National Party",
      "Plaid Cymru",
      "Green Party",
      "Reform UK",
      "Democratic Unionist Party",
      "Sinn Féin",
    ]) {
      expect(UK_2027_PARTY_NAMES, `${name} valid for 2027`).toContain(name);
    }
  });

  it("era-locked parties stay out of 2027", () => {
    for (const name of ["Ulster Unionist Party", "Liberal Party"]) {
      expect(UK_2027_PARTY_NAMES, `${name} excluded from 2027`).not.toContain(name);
    }
  });
});

describe("calculateUKStatePartyOrgs, 2027 dispatch (2024 results)", () => {
  it("seeds all 12 regions from the 2024 table", async () => {
    seedParties(UK_2027_PARTY_NAMES);
    const rows = await calculateUKStatePartyOrgs(db as unknown as Db, "2027-default");
    expect(new Set(rows.map((r) => r.stateId)).size).toBe(12);
    expect(rows.every((r) => r.countryId === "UK")).toBe(true);
  });

  it("gives Reform UK presence everywhere in GB (the 2027 dispatch)", async () => {
    seedParties(UK_2027_PARTY_NAMES);
    const rows = await calculateUKStatePartyOrgs(db as unknown as Db, "2027-default");
    const reformRows = rows.filter((r) => r.partyId === seqOf("Reform UK"));
    expect(reformRows.length).toBeGreaterThanOrEqual(11);
    const org = (stateId: string) =>
      rows.find((r) => r.stateId === stateId && r.partyId === seqOf("Reform UK"))!.organization;
    // NEE 20% Reform vs 6% LibDem: Reform must out-organise the LibDems there.
    const ld = rows.find(
      (r) => r.stateId === "NEE" && r.partyId === seqOf("Liberal Democrats")
    )!.organization;
    expect(org("NEE")).toBeGreaterThan(ld);
  });

  it("reflects the 2024 outcome: Labour ahead of the SNP in Scotland, SF ahead of DUP in NI", async () => {
    seedParties(UK_2027_PARTY_NAMES);
    const rows = await calculateUKStatePartyOrgs(db as unknown as Db, "2027-default");
    const org = (stateId: string, name: string) =>
      rows.find((r) => r.stateId === stateId && r.partyId === seqOf(name))!.organization;
    // 2024 reversed the 2019 order in Scotland: Labour 35, SNP 30.
    expect(org("SCO", "Labour Party")).toBeGreaterThan(org("SCO", "Scottish National Party"));
    expect(org("NIR", "Sinn Féin")).toBeGreaterThan(org("NIR", "Democratic Unionist Party"));
  });

  it("emits no UUP rows under 2027 (1991-only party not in the DB)", async () => {
    seedParties(UK_2027_PARTY_NAMES);
    const rows = await calculateUKStatePartyOrgs(db as unknown as Db, "2027-default");
    // UUP is absent from the DB under 2027, so its 2024-table key is skipped.
    expect(rows).toHaveLength(
      Object.values((await import("./ukRegionPolling2024")).UK_REGION_POLLING_2024).reduce(
        (n, region) => n + Object.keys(region).filter((s) => s !== "uk_uup").length,
        0
      )
    );
  });

  it("leaves the other era branches untouched", async () => {
    seedParties(UK_2027_PARTY_NAMES);
    const rows2020 = await calculateUKStatePartyOrgs(db as unknown as Db, "2019-default");
    const org = (stateId: string, name: string) =>
      rows2020.find((r) => r.stateId === stateId && r.partyId === seqOf(name))?.organization;
    // 2020 table has NEE Reform at 6, not 20.
    expect(org("NEE", "Reform UK")).toBeLessThan(
      (await calculateUKStatePartyOrgs(db as unknown as Db, "2027-default")).find(
        (r) => r.stateId === "NEE" && r.partyId === seqOf("Reform UK")
      )!.organization
    );
  });
});
