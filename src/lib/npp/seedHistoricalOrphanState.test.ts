import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedFromSeats } from "@/lib/npp/seedHistorical";
import { getPresetSeats, type HistoricalSeat } from "@/lib/constants/historicalSeats";
import type { Db } from "mongodb";

vi.mock("@/lib/db/sequentialId", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/sequentialId")>();
  let n = 0;
  return {
    ...actual,
    getNextSequentialId: vi.fn(async () => ++n),
    // seedFromSeats reserves its ids as one block; keep the same 1..n sequence.
    reserveSequentialIds: vi.fn(async (_db: unknown, _type: unknown, count: number) =>
      Array.from({ length: count }, () => ++n)
    ),
  };
});

/**
 * The states a bootstrap actually creates for the USSR + its satellites. Both
 * Cold-War presets seed DD on the same six eastern-Länder codes.
 */
const SEEDED_STATES = [
  // RU regions, including the two union republics folded in by this branch.
  ...[
    "CEN",
    "NWR",
    "NOR",
    "CBE",
    "VOL",
    "NCA",
    "URA",
    "WSB",
    "ESB",
    "FEA",
    "UKR",
    "KAZ",
    "TRA",
    "CAS",
    "MOL",
    "BEL",
    "BLT",
  ].map((_id) => ({ _id, countryId: "RU" })),
  { _id: "HU_BUD", countryId: "HU" },
  { _id: "HU_PES", countryId: "HU" },
  { _id: "HU_TRW", countryId: "HU" },
  { _id: "HU_TRS", countryId: "HU" },
  { _id: "HU_NOR", countryId: "HU" },
  { _id: "HU_ALF", countryId: "HU" },
  { _id: "PL_MAZ", countryId: "PL" },
  { _id: "PL_LOD", countryId: "PL" },
  { _id: "PL_MAL", countryId: "PL" },
  { _id: "PL_SLK", countryId: "PL" },
  { _id: "PL_DSL", countryId: "PL" },
  { _id: "PL_WLK", countryId: "PL" },
  { _id: "PL_POM", countryId: "PL" },
  { _id: "PL_EAS", countryId: "PL" },
  { _id: "RO_BUC", countryId: "RO" },
  { _id: "RO_MUN", countryId: "RO" },
  { _id: "RO_OLT", countryId: "RO" },
  { _id: "RO_TRA", countryId: "RO" },
  { _id: "RO_VST", countryId: "RO" },
  { _id: "RO_MOL", countryId: "RO" },
  { _id: "RO_DOB", countryId: "RO" },
  { _id: "YU_SLO", countryId: "YU" },
  { _id: "YU_CRO", countryId: "YU" },
  { _id: "YU_BIH", countryId: "YU" },
  { _id: "YU_SRB", countryId: "YU" },
  { _id: "YU_VOJ", countryId: "YU" },
  { _id: "YU_KOS", countryId: "YU" },
  { _id: "YU_MNE", countryId: "YU" },
  { _id: "YU_MKD", countryId: "YU" },
  { _id: "BG_SOF", countryId: "BG" },
  { _id: "BG_NOR", countryId: "BG" },
  { _id: "BG_COA", countryId: "BG" },
  { _id: "BG_THR", countryId: "BG" },
  { _id: "BG_SW", countryId: "BG" },
  { _id: "CS_PRG", countryId: "CS" },
  { _id: "CS_BOH", countryId: "CS" },
  { _id: "CS_MOR", countryId: "CS" },
  { _id: "CS_SVK", countryId: "CS" },
  // DD Länder (both Cold-War presets seed the same six codes).
  ...["BEO", "MV", "BB", "ST", "SN", "TH"].map((_id) => ({ _id, countryId: "DD" })),
];

function mockDbWithStates(): MockDb {
  const db = createMockDb();
  db.collectionMocks["states"] = db.collection("states");
  db.collectionMocks["states"].find = vi.fn().mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(SEEDED_STATES),
  });
  return db;
}

function insertedNPPs(db: MockDb): Array<{ countryId: string; homeState: string }> {
  const calls = db.collectionMocks["npps"]?.insertMany.mock.calls ?? [];
  return calls.flatMap(
    (call: unknown[]) => (call[0] as Array<Record<string, unknown>>) ?? []
  ) as Array<{ countryId: string; homeState: string }>;
}

describe("seedFromSeats attributes orphan states to the US", () => {
  let db: MockDb;

  beforeEach(() => {
    db = mockDbWithStates();
  });

  /**
   * This is the hazard the branch's dangling BY_BEL/BAL_BAL rows tripped: an
   * unknown state is not skipped or reported, it silently becomes a US seat.
   * Documented here so the fallback's blast radius stays visible.
   */
  it("mints US legislators for a seat whose state no longer exists", async () => {
    const dangling: HistoricalSeat[] = [
      { state: "BY_BEL", officeType: "chamber", party: "by_cpb", seatsHeld: 3 },
    ];

    await seedFromSeats(db as unknown as Db, dangling);

    const npps = insertedNPPs(db);
    expect(npps.length).toBeGreaterThan(0);
    expect(npps.every((n) => n.countryId === "US")).toBe(true);
    expect(npps.every((n) => n.homeState === "BY_BEL")).toBe(true);
  });

  it("keeps a known state on its real country", async () => {
    const valid: HistoricalSeat[] = [
      { state: "BEL", officeType: "chamber", party: "su_cpsu", seatsHeld: 2 },
    ];

    await seedFromSeats(db as unknown as Db, valid);

    const npps = insertedNPPs(db);
    expect(npps.length).toBeGreaterThan(0);
    expect(npps.every((n) => n.countryId === "RU")).toBe(true);
  });
});

describe.each(["1953-default", "1979-default"])("%s seats no phantom US legislators", (preset) => {
  it("attributes every eastern-bloc seat to a non-US country", async () => {
    const db = mockDbWithStates();
    // Only the one-party chamber seats — the US executive rows are legitimately US.
    const blocSeats = getPresetSeats(preset).filter((s) => s.officeType === "chamber");

    await seedFromSeats(db as unknown as Db, blocSeats);

    const npps = insertedNPPs(db);
    expect(npps.length).toBeGreaterThan(0);
    const strays = npps.filter((n) => n.countryId === "US");
    expect(
      [...new Set(strays.map((n) => n.homeState))],
      "chamber seats fell back to the US"
    ).toEqual([]);
  });
});
