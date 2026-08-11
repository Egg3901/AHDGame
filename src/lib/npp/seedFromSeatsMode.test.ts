import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedFromSeats } from "@/lib/npp/seedHistorical";
import type { HistoricalSeat } from "@/lib/constants/historicalSeats";
import type { Db } from "mongodb";

vi.mock("@/lib/db/sequentialId", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/sequentialId")>();
  let n = 0;
  return {
    ...actual,
    getNextSequentialId: vi.fn(async () => ++n),
    // seedFromSeats reserves its ids as one block; keep the same 1..n sequence
    // the single-id stub produced so id assertions are unchanged.
    reserveSequentialIds: vi.fn(async (_db: unknown, _type: unknown, count: number) =>
      Array.from({ length: count }, () => ++n)
    ),
  };
});

const STATES = [
  { _id: "CA", countryId: "US" },
  { _id: "TX", countryId: "US" },
];

function mockDbWithStates(): MockDb {
  const db = createMockDb();
  db.collectionMocks["states"] = db.collection("states");
  db.collectionMocks["states"].find = vi.fn().mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(STATES),
  });
  return db;
}

function inserted(db: MockDb, collection: string): Array<Record<string, unknown>> {
  const calls = db.collectionMocks[collection]?.insertMany.mock.calls ?? [];
  return calls.flatMap((call: unknown[]) => (call[0] as Array<Record<string, unknown>>) ?? []);
}

const SEATS: HistoricalSeat[] = [
  { state: "CA", officeType: "house", party: "us_democrat", seatsHeld: 45 },
  { state: "CA", officeType: "house", party: "us_republican", seatsHeld: 8 },
  { state: "TX", officeType: "senate", party: "us_republican", senateClass: 1 },
];

describe("seedFromSeats seedMode", () => {
  let db: MockDb;
  beforeEach(() => {
    db = mockDbWithStates();
  });

  it("'winners' (default) seats officials AND creates NPPs with an office", async () => {
    const res = await seedFromSeats(db as unknown as Db, SEATS);
    const npps = inserted(db, "npps");
    const officials = inserted(db, "electedOfficials");

    expect(res.nppsCreated).toBe(3);
    expect(res.officialsCreated).toBe(3);
    expect(npps).toHaveLength(3);
    expect(officials).toHaveLength(3);
    // Winners carry a current office and the officials carry seatsHeld.
    expect(npps.every((n) => n.currentOffice != null)).toBe(true);
    const caHouse = officials.filter((o) => o.state === "CA" && o.officeType === "house");
    expect((caHouse.map((o) => o.seatsHeld) as number[]).sort((a, b) => a - b)).toEqual([8, 45]);
  });

  it("'priors' creates the candidate NPPs but leaves chambers VACANT", async () => {
    const res = await seedFromSeats(db as unknown as Db, SEATS, "priors");
    const npps = inserted(db, "npps");
    const officials = inserted(db, "electedOfficials");

    // Same candidate field...
    expect(res.nppsCreated).toBe(3);
    expect(npps).toHaveLength(3);
    // ...but zero seated officials (the founding election decides them). The
    // electedOfficials insert is skipped entirely (its collection mock is never
    // even touched), so `inserted()` is empty.
    expect(res.officialsCreated).toBe(0);
    expect(officials).toHaveLength(0);
    // Priors NPPs are unseated (no current office).
    expect(npps.every((n) => n.currentOffice === null)).toBe(true);
    // Party affiliation is preserved so they can contest the founding election.
    expect(npps.every((n) => n.party != null)).toBe(true);
  });
});

describe("seedFromSeats — 1953 presidential executives (generic names)", () => {
  it("seats US/BR presidents with generated names (no authored historical person)", async () => {
    const db = createMockDb();
    db.collectionMocks["states"] = db.collection("states");
    db.collectionMocks["states"].find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks["politicalParties"] = db.collection("politicalParties");
    db.collectionMocks["politicalParties"].findOne = vi
      .fn()
      .mockImplementation(async (filter: { name?: string; countryId?: string }) => {
        if (filter.countryId === "US") {
          return {
            sequentialId: 2,
            name: "Republican Party",
            countryId: "US",
            economicPosition: 2,
            socialPosition: 1,
          };
        }
        if (filter.countryId === "BR") {
          return {
            sequentialId: 3,
            name: "Partido Trabalhista Brasileiro",
            countryId: "BR",
            economicPosition: -2,
            socialPosition: 0,
          };
        }
        return null;
      });
    db.collectionMocks["npps"] = db.collection("npps");
    db.collectionMocks["npps"].find = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const seats: HistoricalSeat[] = [
      { state: "US", officeType: "president", party: "republican" },
      { state: "US", officeType: "vicePresident", party: "republican" },
      { state: "BR", officeType: "president", party: "br_ptb" },
    ];
    const res = await seedFromSeats(db as unknown as Db, seats);
    expect(res.nppsCreated).toBe(3);
    expect(res.officialsCreated).toBe(3);

    const npps = inserted(db, "npps") as Array<{
      name: string;
      countryId: string;
      currentOffice: { type: string };
      party: string;
    }>;
    const officials = inserted(db, "electedOfficials") as Array<{
      characterName: string;
      officeType: string;
      countryId: string;
      party: string;
    }>;

    const forbidden = ["Eisenhower", "Nixon", "Vargas", "Getúlio", "Getulio"];
    for (const n of npps) {
      expect(n.name.length).toBeGreaterThan(0);
      for (const bad of forbidden) {
        expect(n.name).not.toContain(bad);
      }
    }
    expect(npps.map((n) => n.currentOffice.type).sort()).toEqual([
      "president",
      "president",
      "vicePresident",
    ]);
    expect(
      officials.filter((o) => o.countryId === "US" && o.officeType === "president")
    ).toHaveLength(1);
    expect(
      officials.filter((o) => o.countryId === "BR" && o.officeType === "president")
    ).toHaveLength(1);
    expect(officials.find((o) => o.countryId === "US")?.party).toBe("2");
    expect(officials.find((o) => o.countryId === "BR")?.party).toBe("3");
  });
});
