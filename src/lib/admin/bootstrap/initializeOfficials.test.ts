/**
 * Verifies vacant-world seeding excludes non-electoral US regions (DC).
 * DC exists in the `states` collection for economy/presidential electoral votes
 * but has no House/Senate/Governor/state-legislature seats, so it must not be
 * seeded with officials or cycle-1 elections.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("initializeOfficials", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // states.find({ countryId: "US" }) → one real state (WY) + DC.
    db.collection("states");
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "WY", countryId: "US" },
        { _id: "DC", countryId: "US" },
      ]),
    });
  });

  it("seeds officials and elections for real states but never for DC", async () => {
    const { initializeOfficials } = await import("./initializeOfficials");
    await initializeOfficials(db as unknown as Db);

    const officialDocs = db.collectionMocks.electedOfficials!.insertMany.mock.calls.flatMap(
      (c) => c[0] as Array<{ state?: string; officeType: string }>
    );
    const electionDocs = db.collectionMocks.elections!.insertMany.mock.calls.flatMap(
      (c) => c[0] as Array<{ state: string; electionType: string }>
    );

    // Non-vacuous: WY must be seeded (proves seeding ran).
    expect(officialDocs.some((o) => o.state === "WY")).toBe(true);
    expect(electionDocs.some((e) => e.state === "WY")).toBe(true);

    // The fix: DC must never be seeded as an official or election.
    expect(officialDocs.filter((o) => o.state === "DC")).toEqual([]);
    expect(electionDocs.filter((e) => e.state === "DC")).toEqual([]);
  });

  it("skips pre-statehood territories under the 1953 preset (AK/HI)", async () => {
    // Alaska and Hawaii were territories until 1959, so the 1950-census
    // apportionment map `getHouseSeats("1953-default")` omits them and
    // `seedSeats` gives them no seat row. `isUsElectoralState` is
    // preset-INDEPENDENT (the modern 50-state set), so without the era gate
    // this seeder fabricates officials and cycle-1 elections with no matching
    // seat — 6 phantom officials + 10 orphan elections, regenerated every reset.
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "WY", countryId: "US" },
        { _id: "AK", countryId: "US" },
        { _id: "HI", countryId: "US" },
      ]),
    });
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "1953-default",
      startingYear: 1953,
    });

    const { initializeOfficials } = await import("./initializeOfficials");
    await initializeOfficials(db as unknown as Db);

    const officialDocs = db.collectionMocks.electedOfficials!.insertMany.mock.calls.flatMap(
      (c) => c[0] as Array<{ state?: string; officeType: string }>
    );
    const electionDocs = db.collectionMocks.elections!.insertMany.mock.calls.flatMap(
      (c) => c[0] as Array<{ state: string; electionType: string }>
    );

    // Non-vacuous: WY is a 1953 state and must still be seeded.
    expect(officialDocs.some((o) => o.state === "WY")).toBe(true);
    expect(electionDocs.some((e) => e.state === "WY")).toBe(true);

    expect(officialDocs.filter((o) => o.state === "AK" || o.state === "HI")).toEqual([]);
    expect(electionDocs.filter((e) => e.state === "AK" || e.state === "HI")).toEqual([]);
  });

  it("still seeds AK/HI under a modern preset", async () => {
    // Guard against over-gating: the 2019 apportionment map contains AK and HI,
    // so they must keep their officials and elections.
    db.collectionMocks.states!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "WY", countryId: "US" },
        { _id: "AK", countryId: "US" },
        { _id: "HI", countryId: "US" },
      ]),
    });
    db.collection("gameState");
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      preset: "2019-default",
      startingYear: 2019,
    });

    const { initializeOfficials } = await import("./initializeOfficials");
    await initializeOfficials(db as unknown as Db);

    const officialDocs = db.collectionMocks.electedOfficials!.insertMany.mock.calls.flatMap(
      (c) => c[0] as Array<{ state?: string; officeType: string }>
    );
    const electionDocs = db.collectionMocks.elections!.insertMany.mock.calls.flatMap(
      (c) => c[0] as Array<{ state: string; electionType: string }>
    );

    expect(officialDocs.some((o) => o.state === "AK")).toBe(true);
    expect(officialDocs.some((o) => o.state === "HI")).toBe(true);
    expect(electionDocs.some((e) => e.state === "AK")).toBe(true);
    expect(electionDocs.some((e) => e.state === "HI")).toBe(true);
  });
});
