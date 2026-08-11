import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, createAsyncIterableCursor, type MockDb } from "@/lib/test-utils/mockDb";
import {
  allocatePriorsSeats,
  allocatePriorsSeatsWithMajorFloor,
  topMajorPartyIds,
  seedNppPriorsPopulation,
} from "@/lib/npp/seedNppPriorsPopulation";

describe("allocatePriorsSeats", () => {
  it("distributes seats proportionally to weight", () => {
    const weights = new Map([
      ["1", 60],
      ["2", 40],
    ]);
    const allocation = allocatePriorsSeats(100, weights);
    expect(allocation.get("1")).toBe(60);
    expect(allocation.get("2")).toBe(40);
  });

  it("guarantees every present party at least one seat even when heavily skewed", () => {
    // Floor+remainder alone would zero out the four minor parties here:
    // floor(5*100/104)=4, floor(5*1/104)=0 for each of the four.
    const weights = new Map([
      ["major", 100],
      ["minor1", 1],
      ["minor2", 1],
      ["minor3", 1],
      ["minor4", 1],
    ]);
    const allocation = allocatePriorsSeats(5, weights);
    expect(allocation.get("minor1")).toBeGreaterThanOrEqual(1);
    expect(allocation.get("minor2")).toBeGreaterThanOrEqual(1);
    expect(allocation.get("minor3")).toBeGreaterThanOrEqual(1);
    expect(allocation.get("minor4")).toBeGreaterThanOrEqual(1);
    expect(allocation.get("major")).toBeGreaterThanOrEqual(1);
    const total = [...allocation.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(5); // effectiveTarget === target here (5 >= 5 parties)
  });

  it("bumps the effective target up to the present-party count when target is smaller", () => {
    const weights = new Map([
      ["a", 1],
      ["b", 1],
      ["c", 1],
    ]);
    // Only 1 seat "exists" per the seat-count signal, but 3 parties are present.
    const allocation = allocatePriorsSeats(1, weights);
    expect(allocation.get("a")).toBeGreaterThanOrEqual(1);
    expect(allocation.get("b")).toBeGreaterThanOrEqual(1);
    expect(allocation.get("c")).toBeGreaterThanOrEqual(1);
  });

  it("returns an empty map when no party has positive weight", () => {
    const weights = new Map([
      ["a", 0],
      ["b", 0],
    ]);
    expect(allocatePriorsSeats(10, weights).size).toBe(0);
  });
});

describe("allocatePriorsSeatsWithMajorFloor", () => {
  it("raises the two dominant parties to full race coverage, keeping minors proportional", () => {
    const weights = new Map([
      ["1", 50], // major
      ["2", 40], // major
      ["3", 5], // minor
      ["4", 5], // minor
    ]);
    const target = 10;
    const majors = topMajorPartyIds(weights);
    expect(majors).toEqual(new Set(["1", "2"]));
    const alloc = allocatePriorsSeatsWithMajorFloor(target, weights, majors);
    // Both majors can now contest every one of the 10 races.
    expect(alloc.get("1")).toBe(10);
    expect(alloc.get("2")).toBe(10);
    // Minors keep at least their floor.
    expect(alloc.get("3")).toBeGreaterThanOrEqual(1);
    expect(alloc.get("4")).toBeGreaterThanOrEqual(1);
  });

  it("never lowers a major already above target and skips absent majors", () => {
    const weights = new Map([
      ["1", 100],
      ["2", 0], // absent — must not be bumped
    ]);
    const alloc = allocatePriorsSeatsWithMajorFloor(3, weights, new Set(["1", "2"]));
    expect(alloc.get("1")).toBe(3);
    expect(alloc.get("2") ?? 0).toBe(0);
  });
});

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("seedNppPriorsPopulation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  function setup(opts: {
    states: Array<{ _id: string; countryId: string }>;
    elections: Array<{ countryId: string; state: string; totalSeats?: number }>;
    parties: Array<{
      sequentialId: number;
      countryId: string;
      name: string;
      isDefault?: boolean;
      economicPosition: number;
      socialPosition: number;
    }>;
    orgRows?: Array<{
      countryId: string;
      stateId: string;
      partyId: string;
      organization?: number;
      registration?: number;
      registrationShare?: number;
      hasPresence?: boolean;
    }>;
    existingNpps?: Array<{ name: string; countryId: string; homeState: string; party: string }>;
  }) {
    (db.collection("states") as unknown as { find: ReturnType<typeof vi.fn> }).find.mockReturnValue(
      createAsyncIterableCursor(opts.states)
    );
    (
      db.collection("elections") as unknown as { find: ReturnType<typeof vi.fn> }
    ).find.mockReturnValue(createAsyncIterableCursor(opts.elections));
    (
      db.collection("politicalParties") as unknown as { find: ReturnType<typeof vi.fn> }
    ).find.mockReturnValue(createAsyncIterableCursor(opts.parties));
    (
      db.collection("statePartyOrg") as unknown as { find: ReturnType<typeof vi.fn> }
    ).find.mockReturnValue(createAsyncIterableCursor(opts.orgRows ?? []));
    (db.collection("npps") as unknown as { find: ReturnType<typeof vi.fn> }).find.mockReturnValue(
      createAsyncIterableCursor(opts.existingNpps ?? [])
    );
    (
      db.collection("counters") as unknown as {
        findOneAndUpdate: ReturnType<typeof vi.fn>;
      }
    ).findOneAndUpdate.mockImplementation(
      async (_filter: unknown, update: { $inc: { seq: number } }) => ({
        _id: "npp",
        seq: update.$inc.seq,
      })
    );
  }

  it("seeds every seeded party present in a region, not just the largest", async () => {
    setup({
      states: [{ _id: "LON", countryId: "UK" }],
      elections: [{ countryId: "UK", state: "LON", totalSeats: 20 }],
      parties: [
        {
          sequentialId: 1,
          countryId: "UK",
          name: "Labour",
          economicPosition: -2,
          socialPosition: -2,
        },
        {
          sequentialId: 2,
          countryId: "UK",
          name: "Conservative",
          economicPosition: 2,
          socialPosition: 1,
        },
        {
          sequentialId: 3,
          countryId: "UK",
          name: "Liberal Democrats",
          economicPosition: 0,
          socialPosition: -1,
        },
      ],
      orgRows: [
        { countryId: "UK", stateId: "LON", partyId: "1", organization: 40, hasPresence: true },
        { countryId: "UK", stateId: "LON", partyId: "2", organization: 35, hasPresence: true },
        { countryId: "UK", stateId: "LON", partyId: "3", organization: 5, hasPresence: true },
      ],
    });

    const result = await seedNppPriorsPopulation(db as unknown as Db);

    // One cycle-0 race, so the race-count target is 1 - the per-party floor
    // then lifts it to the number of parties present. Sizing is per RACE, not
    // per SEAT (totalSeats 20 is deliberately ignored): a multi-seat chamber is
    // held by a few officeholders via seatsHeld, and electionEntry registers at
    // most one candidate per party per election.
    expect(result.nppsCreated).toBe(3);
    expect(result.byCountry.UK).toBe(3);
    const inserted = db.collectionMocks.npps!.insertMany.mock.calls[0][0] as Array<{
      party: string;
      currentOffice: unknown;
    }>;
    const partiesRepresented = new Set(inserted.map((n) => n.party));
    expect(partiesRepresented).toEqual(new Set(["1", "2", "3"]));
    // Every seeded party gets at least one NPP, including the 5%-org minor party.
    expect(inserted.filter((n) => n.party === "3").length).toBeGreaterThanOrEqual(1);
    // Priors are always unseated candidates.
    expect(inserted.every((n) => n.currentOffice === null)).toBe(true);
  });

  it("never touches electedOfficials", async () => {
    setup({
      states: [{ _id: "LON", countryId: "UK" }],
      elections: [{ countryId: "UK", state: "LON", totalSeats: 10 }],
      parties: [
        {
          sequentialId: 1,
          countryId: "UK",
          name: "Labour",
          economicPosition: -2,
          socialPosition: -2,
        },
        {
          sequentialId: 2,
          countryId: "UK",
          name: "Conservative",
          economicPosition: 2,
          socialPosition: 1,
        },
      ],
    });

    await seedNppPriorsPopulation(db as unknown as Db);

    expect(db.collection).not.toHaveBeenCalledWith("electedOfficials");
  });

  it("excludes national single-seat executive races whose state is a country code, not a region", async () => {
    setup({
      states: [{ _id: "LON", countryId: "UK" }],
      elections: [
        { countryId: "UK", state: "LON", totalSeats: 5 },
        // President-style national race: `state` carries the country code,
        // which is never a row in `states`.
        { countryId: "US", state: "US", totalSeats: 1 },
      ],
      parties: [
        {
          sequentialId: 1,
          countryId: "UK",
          name: "Labour",
          isDefault: true,
          economicPosition: -2,
          socialPosition: -2,
        },
        {
          sequentialId: 2,
          countryId: "UK",
          name: "Conservative",
          isDefault: true,
          economicPosition: 2,
          socialPosition: 1,
        },
      ],
    });

    const result = await seedNppPriorsPopulation(db as unknown as Db);

    expect(result.byCountry.US).toBeUndefined();
    expect(result.byCountry.UK).toBeGreaterThan(0);
  });

  it("falls back to an even split across default parties when no statePartyOrg data exists", async () => {
    setup({
      states: [{ _id: "REG", countryId: "FR" }],
      elections: [{ countryId: "FR", state: "REG", totalSeats: 8 }],
      parties: [
        {
          sequentialId: 1,
          countryId: "FR",
          name: "Party A",
          isDefault: true,
          economicPosition: -1,
          socialPosition: -1,
        },
        {
          sequentialId: 2,
          countryId: "FR",
          name: "Party B",
          isDefault: true,
          economicPosition: 1,
          socialPosition: 1,
        },
      ],
      orgRows: [],
    });

    const result = await seedNppPriorsPopulation(db as unknown as Db);

    // One race; the floor lifts to the default-party count. totalSeats 8 is
    // ignored - see the race-vs-seat note above.
    expect(result.nppsCreated).toBe(2);
    const inserted = db.collectionMocks.npps!.insertMany.mock.calls[0][0] as Array<{
      party: string;
    }>;
    expect(inserted.filter((n) => n.party === "1").length).toBeGreaterThanOrEqual(1);
    expect(inserted.filter((n) => n.party === "2").length).toBeGreaterThanOrEqual(1);
  });

  it("only tops up the shortfall when NPPs already exist for a (region, party)", async () => {
    setup({
      states: [{ _id: "LON", countryId: "UK" }],
      elections: [{ countryId: "UK", state: "LON", totalSeats: 10 }],
      parties: [
        {
          sequentialId: 1,
          countryId: "UK",
          name: "Labour",
          economicPosition: -2,
          socialPosition: -2,
        },
        {
          sequentialId: 2,
          countryId: "UK",
          name: "Conservative",
          economicPosition: 2,
          socialPosition: 1,
        },
      ],
      orgRows: [
        { countryId: "UK", stateId: "LON", partyId: "1", organization: 50, hasPresence: true },
        { countryId: "UK", stateId: "LON", partyId: "2", organization: 50, hasPresence: true },
      ],
      existingNpps: Array.from({ length: 5 }, (_, i) => ({
        name: `Existing Labour NPP ${i}`,
        countryId: "UK",
        homeState: "LON",
        party: "1",
      })),
    });

    const result = await seedNppPriorsPopulation(db as unknown as Db);

    // One race -> floor of one per present party. Labour already has NPPs, so
    // only the Conservative shortfall is created.
    expect(result.nppsCreated).toBe(1);
    const inserted = db.collectionMocks.npps!.insertMany.mock.calls[0][0] as Array<{
      party: string;
    }>;
    expect(inserted.every((n) => n.party === "2")).toBe(true);
  });

  it("returns zero when there are no cycle-0 regional elections", async () => {
    setup({ states: [], elections: [], parties: [] });
    const result = await seedNppPriorsPopulation(db as unknown as Db);
    expect(result.nppsCreated).toBe(0);
    expect(db.collectionMocks.npps!.insertMany).not.toHaveBeenCalled();
  });
});
