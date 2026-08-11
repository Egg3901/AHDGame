import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { buildDistrictDocsForStates } from "./buildStateDocs";

/** Minimal in-memory fake of the read-only Mongo surface this builder uses. */
function makeFakeDb(seed: Record<string, unknown[]>): Db {
  const store: Record<string, unknown[]> = { ...seed };
  return {
    collection(name: string) {
      const rows = store[name] ?? [];
      return { find: () => ({ toArray: async () => rows }) };
    },
  } as unknown as Db;
}

describe("buildDistrictDocsForStates — all-grey budget fallback", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("produces visible left/right when a state has no party-org rows (TX 1991 bug)", async () => {
    // 1991-style seed: a state with house seats but no statePartyOrg rows and a
    // PVI file whose district count won't match (so loadCookPvi returns null).
    const db = makeFakeDb({
      states: [{ _id: "TX", countryId: "US", houseDistricts: 30 }],
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", countryId: "US", economicPosition: -2 },
        { _id: "p2", sequentialId: 2, abbreviation: "GOP", countryId: "US", economicPosition: 2 },
      ],
      statePartyOrg: [], // ← the bug trigger: nothing maps to left/right
      stateRegistrationPool: [],
    });

    const docs = await buildDistrictDocsForStates(db, "US", now, ["TX"]);

    expect(docs).toHaveLength(30);
    const totals = docs.reduce(
      (a, d) => ({
        left: a.left + d.squares.left,
        right: a.right + d.squares.right,
        grey: a.grey + d.squares.grey,
      }),
      { left: 0, right: 0, grey: 0 }
    );
    // 30 districts × 16 squares, conserved.
    expect(totals.left + totals.right + totals.grey).toBe(480);
    // The fix: the state is no longer monochromatic grey.
    expect(totals.left).toBeGreaterThan(0);
    expect(totals.right).toBeGreaterThan(0);
    expect(totals.grey).toBeLessThan(480);
    // Multiple districts actually carry blue and red squares (not just one).
    expect(docs.filter((d) => d.squares.left > 0).length).toBeGreaterThan(1);
    expect(docs.filter((d) => d.squares.right > 0).length).toBeGreaterThan(1);
  });

  it("still uses registration when party-org rows are present", async () => {
    const db = makeFakeDb({
      states: [{ _id: "WY", countryId: "US", houseDistricts: 1 }],
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", countryId: "US", economicPosition: -2 },
        { _id: "p2", sequentialId: 2, abbreviation: "GOP", countryId: "US", economicPosition: 2 },
      ],
      statePartyOrg: [
        { _id: "WY_1", countryId: "US", stateId: "WY", partyId: "1", registration: 26 },
        { _id: "WY_2", countryId: "US", stateId: "WY", partyId: "2", registration: 62 },
      ],
      stateRegistrationPool: [],
    });

    const docs = await buildDistrictDocsForStates(db, "US", now, ["WY"]);
    expect(docs).toHaveLength(1);
    // Right-heavy registration ⇒ right outweighs left.
    expect(docs[0].squares.right).toBeGreaterThan(docs[0].squares.left);
  });

  it("falls back to `organization` lean when `registration` is unset", async () => {
    // The core seed populates `organization` (with the state's lean baked in) but
    // not `registration`; the district builder must still capture the lean.
    const db = makeFakeDb({
      states: [{ _id: "MA", countryId: "US", houseDistricts: 4 }],
      politicalParties: [
        { _id: "p1", sequentialId: 1, abbreviation: "DEM", countryId: "US", economicPosition: -3 },
        { _id: "p2", sequentialId: 2, abbreviation: "GOP", countryId: "US", economicPosition: 3 },
      ],
      statePartyOrg: [
        // Blue state: Democratic org outweighs Republican. No `registration` field.
        { _id: "MA_1", countryId: "US", stateId: "MA", partyId: "1", organization: 53 },
        { _id: "MA_2", countryId: "US", stateId: "MA", partyId: "2", organization: 25 },
      ],
      stateRegistrationPool: [],
    });

    const docs = await buildDistrictDocsForStates(db, "US", now, ["MA"]);
    expect(docs).toHaveLength(4);
    const totals = docs.reduce(
      (a, d) => ({ left: a.left + d.squares.left, right: a.right + d.squares.right }),
      { left: 0, right: 0 }
    );
    // Left-leaning org ⇒ left outweighs right (not the neutral grey default).
    expect(totals.left).toBeGreaterThan(totals.right);
  });
});
