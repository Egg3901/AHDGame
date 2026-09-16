import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { calculateJPStatePartyOrgs } from "./jpStatePartyOrgCalculations";
import { jpParties } from "./jpParties";
import { jpRegions1953 } from "./jpRegions1953";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
});

function seedParties(names: string[]) {
  const parties = names.map((name, i) => ({
    _id: new ObjectId(),
    countryId: "JP",
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
const JP_1953_PARTY_NAMES = jpParties
  .filter((p) => !p.validForPresets || p.validForPresets.includes("1953-default"))
  .map((p) => p.name);

describe("calculateJPStatePartyOrgs — 1953 Shugiin", () => {
  it("seeds presence for every (region × 1953 party) pair", async () => {
    seedParties(JP_1953_PARTY_NAMES);
    const rows = await calculateJPStatePartyOrgs(db as unknown as Db, "1953-default");
    expect(rows).toHaveLength(jpRegions1953.length * JP_1953_PARTY_NAMES.length);
    expect(new Set(rows.map((r) => r.stateId))).toEqual(
      new Set(jpRegions1953.map((r) => String(r._id)))
    );
    expect(rows.every((r) => r.countryId === "JP")).toBe(true);
  });

  it("regression: the 2021 table left every region Communist-only", async () => {
    // Of the 2021 slugs (ldp/cdp/komeito/jcp/ishin/dpfp) only `jcp` resolves
    // under the 1953 roster, so the pre-fix world seeded the JCP — which polled
    // 1.9% in 1953 — as the sole party with organization anywhere in Japan.
    seedParties(JP_1953_PARTY_NAMES);
    const wrongEra = await calculateJPStatePartyOrgs(db as unknown as Db, "2019-default");
    expect(wrongEra).toHaveLength(jpRegions1953.length);
    const jcpSeqId = String(JP_1953_PARTY_NAMES.indexOf("Japanese Communist Party") + 1);
    expect(wrongEra.every((r) => r.partyId === jcpSeqId)).toBe(true);
  });

  it("makes the Liberal Party the strongest organisation in every region except Hokkaido", async () => {
    seedParties(JP_1953_PARTY_NAMES);
    const rows = await calculateJPStatePartyOrgs(db as unknown as Db, "1953-default");
    const seqOf = (name: string) => String(JP_1953_PARTY_NAMES.indexOf(name) + 1);
    for (const region of jpRegions1953) {
      const id = String(region._id);
      const inRegion = rows.filter((r) => r.stateId === id);
      const top = inRegion.reduce((a, b) => (b.organization > a.organization ? b : a));
      // #3873: Hokkaido is the one region where the Socialists' organisation
      // genuinely leads (the era's strongest JSP regional base) — everywhere
      // else the Liberal Party stays on top.
      const expectedTop = id === "HOK" ? "Japan Socialist Party" : "Liberal Party";
      expect(top.partyId, `${id} strongest party`).toBe(seqOf(expectedTop));
    }
    // The Liberal Party still leads nationally (aggregate across regions) even
    // though Hokkaido flips — the seed keeps the real 1953 result intact.
    const org = (stateId: string, name: string) =>
      rows.find((r) => r.stateId === stateId && r.partyId === seqOf(name))!.organization;
    const sum = (name: string) =>
      jpRegions1953.reduce((acc, r) => acc + org(String(r._id), name), 0);
    expect(sum("Liberal Party")).toBeGreaterThan(sum("Japan Socialist Party"));
  });

  it("keeps the JCP marginal, below every other 1953 party", async () => {
    seedParties(JP_1953_PARTY_NAMES);
    const rows = await calculateJPStatePartyOrgs(db as unknown as Db, "1953-default");
    const seqOf = (name: string) => String(JP_1953_PARTY_NAMES.indexOf(name) + 1);
    const jcp = rows.filter((r) => r.partyId === seqOf("Japanese Communist Party"));
    const others = rows.filter((r) => r.partyId !== seqOf("Japanese Communist Party"));
    expect(Math.max(...jcp.map((r) => r.organization))).toBeLessThan(
      Math.min(...others.map((r) => r.organization))
    );
  });

  it("leaves the 1991 and 2019 branches untouched", async () => {
    seedParties([
      "Liberal Democratic Party",
      "Japan Socialist Party",
      "Komeito",
      "Japanese Communist Party",
      "Democratic Socialist Party",
    ]);
    const rows1991 = await calculateJPStatePartyOrgs(db as unknown as Db, "1991-default");
    expect(new Set(rows1991.map((r) => r.stateId)).size).toBe(8);
    expect(rows1991.length).toBeGreaterThan(8);
  });
});
