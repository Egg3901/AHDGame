/**
 * Unit tests for the DD (East Germany) Land First Secretary spawner: the
 * status/NPP-governed gate, the era gate (null ddVolkskammer anchor outside
 * the Cold-War presets), and the Volkskammer anchor ride-along. Mirrors
 * perpetualElections.ru.test.ts (the sibling one-party state).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

vi.mock("@/lib/countryAccess", () => ({
  getCountryAccessFromDb: vi.fn(),
}));

// Representative subset — the six-Länder roster invariant lives in
// sovietSeatMap.test.ts / countryCoverage.test.ts.
const DD_REGIONS = [
  { _id: "BEO", houseDistricts: 32, stateSenateSeats: 5 },
  { _id: "SN", houseDistricts: 151, stateSenateSeats: 24 },
  { _id: "MV", houseDistricts: 58, stateSenateSeats: 9 },
];

function makeDDMockDb(
  currentTurn: number,
  gameState: Record<string, unknown> = {},
  completed: Array<Partial<Election>> = [],
  regions: Array<Record<string, unknown>> = DD_REGIONS,
  live: Array<Partial<Election>> = []
) {
  const insertCalls: Omit<Election, "_id">[][] = [];
  const bulkWriteCalls: unknown[][] = [];
  const db = {
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "states") {
        return {
          find: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue(regions),
          }),
        };
      }
      if (name === "gameState") {
        return {
          findOne: vi.fn().mockResolvedValue({
            currentTurn,
            startingYear: 1953,
            preset: "1953-default",
            ...gameState,
          }),
        };
      }
      if (name === "elections") {
        return {
          find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
            if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
            // Two status-scoped reads share this mock: the live races (none) and
            // the resolved history the next cycle is scheduled from.
            const wanted = (filter.status as { $in?: string[] } | undefined)?.$in ?? [];
            const rows = wanted.includes("resolved") ? completed : live;
            return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(rows) };
          }),
          insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
            insertCalls.push(docs);
            return Promise.resolve({ insertedIds: {} });
          }),
          bulkWrite: vi.fn().mockImplementation((ops: unknown[]) => {
            bulkWriteCalls.push(ops);
            return Promise.resolve({ modifiedCount: ops.length });
          }),
        };
      }
      return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
    }),
  };
  return { db, insertCalls, bulkWriteCalls };
}

async function mountDD(
  mock: { db: unknown },
  status: "active" | "coming-soon" = "active",
  nppGoverned = false
) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(mock.db as never);
  const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
  vi.mocked(getCountryAccessFromDb).mockResolvedValue({ status, nppGoverned } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureDDGovernorElections (Land First Secretaries)", () => {
  it("spawns one single-seat race per Land on the Volkskammer cycle when active", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock);
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(DD_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.electionType).toBe("governor");
      expect(doc.countryId).toBe("DD");
      expect(doc.totalSeats).toBe(1);
      // ddVolkskammer anchor (1954) — the Land races ride the chamber's cycle.
      expect(doc.electionYear).toBe(1954);
    }
  });

  it("status gate: coming-soon (not NPP-governed) spawns nothing", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock, "coming-soon");
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });

  it("NPP-governed gate: coming-soon + nppGoverned spawns the family", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock, "coming-soon", /* nppGoverned */ true);
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));
    expect(mock.insertCalls.flat()).toHaveLength(DD_REGIONS.length);
  });

  it("era gate: null ddVolkskammer anchor under 2019-default spawns nothing even when active", async () => {
    const mock = makeDDMockDb(1, { startingYear: 2019, preset: "2019-default" });
    await mountDD(mock);
    const { ensureDDGovernorElections } = await import("./perpetualElections");
    await ensureDDGovernorElections(new Date("2026-04-01T00:00:00Z"));
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });
});

describe("ensureDDLandAssemblyElections (Landtage)", () => {
  it("spawns one multi-seat Landtag race per Land sized by stateSenateSeats", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock);
    const { ensureDDLandAssemblyElections } = await import("./perpetualElections");
    await ensureDDLandAssemblyElections(new Date("2026-04-01T00:00:00Z"));

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(DD_REGIONS.length);
    for (const doc of inserted) {
      expect(doc.electionType).toBe("landAssembly");
      expect(doc.countryId).toBe("DD");
      expect(doc.electionYear).toBe(1954);
    }
    const byState = new Map(inserted.map((d) => [d.state, d.totalSeats]));
    expect(byState.get("BEO")).toBe(5);
    expect(byState.get("SN")).toBe(24);
    expect(byState.get("MV")).toBe(9);
  });

  it("status gate: coming-soon (not NPP-governed) spawns nothing", async () => {
    const mock = makeDDMockDb(1);
    await mountDD(mock, "coming-soon");
    const { ensureDDLandAssemblyElections } = await import("./perpetualElections");
    await ensureDDLandAssemblyElections(new Date("2026-04-01T00:00:00Z"));
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });
});

describe("buildDelegateSeatHealOps", () => {
  const now = new Date("2026-04-01T00:00:00Z");
  const race = (id: string, state: string, totalSeats?: number) =>
    ({ _id: id, state, totalSeats }) as unknown as Pick<Election, "_id" | "state" | "totalSeats">;

  it("rewrites only the races whose count disagrees with the live map", async () => {
    const { buildDelegateSeatHealOps } = await import("./perpetualElections");
    const ops = buildDelegateSeatHealOps(
      [race("a", "SN", 24), race("b", "MV", 63)],
      { SN: 161, MV: 63 },
      now
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ updateOne: { filter: { _id: "a" } } });
  });

  it("fills in a race that carries no count at all", async () => {
    const { buildDelegateSeatHealOps } = await import("./perpetualElections");
    const ops = buildDelegateSeatHealOps([race("a", "SN")], { SN: 161 }, now);
    expect(ops).toHaveLength(1);
  });

  it("leaves a race alone when the map cannot size its region", async () => {
    const { buildDelegateSeatHealOps } = await import("./perpetualElections");
    // Absent, zero, negative and NaN all mean "no authoritative number". NaN is
    // the sharp one: every comparison against it is false, so a `<= 0` guard
    // would fall straight through and write NaN over a good seat count.
    expect(buildDelegateSeatHealOps([race("a", "SN", 24)], {}, now)).toEqual([]);
    expect(buildDelegateSeatHealOps([race("a", "SN", 24)], { SN: 0 }, now)).toEqual([]);
    expect(buildDelegateSeatHealOps([race("a", "SN", 24)], { SN: -5 }, now)).toEqual([]);
    expect(buildDelegateSeatHealOps([race("a", "SN", 24)], { SN: NaN }, now)).toEqual([]);
  });

  it("ignores a race with no region", async () => {
    const { buildDelegateSeatHealOps } = await import("./perpetualElections");
    expect(
      buildDelegateSeatHealOps([race("a", undefined as unknown as string, 24)], { SN: 161 }, now)
    ).toEqual([]);
  });
});

describe("regional delegate seat sizing (#1262)", () => {
  // Reunification rescaled the GDR's Laender: Sachsen's Volkskammer delegation
  // went from the 1953 seed's 151 to 55 once the acceded western Laender were
  // apportioned alongside it. The chamber's live size is the sum of the region
  // docs' `houseDistricts`, so a new cycle that copies the resolved 1953 race
  // advertises a delegation the chamber does not have -- which is exactly what
  // the map and the elections page disagreed about.
  const RESCALED = [
    { _id: "SN", houseDistricts: 55, stateSenateSeats: 161 },
    { _id: "MV", houseDistricts: 21, stateSenateSeats: 63 },
  ];
  const stale = (electionType: string, seatsByState: Record<string, number>) =>
    Object.entries(seatsByState).map(
      ([state, totalSeats]) =>
        ({
          state,
          electionType,
          countryId: "DD",
          status: "resolved",
          totalSeats,
          cycle: 0,
          endTurn: -200,
        }) as unknown as Partial<Election>
    );

  it("sizes a new Volkskammer cycle from the live region, not the resolved one", async () => {
    const mock = makeDDMockDb(1, {}, stale("volkskammerDeputy", { SN: 151, MV: 58 }), RESCALED);
    await mountDD(mock);
    const { ensureDDVolkskammerElections } = await import("./perpetualElections");
    await ensureDDVolkskammerElections(new Date("2026-04-01T00:00:00Z"));

    const byState = new Map(mock.insertCalls.flat().map((d) => [d.state, d.totalSeats]));
    expect(byState.get("SN")).toBe(55);
    expect(byState.get("MV")).toBe(21);
  });

  it("sizes a new Landtag cycle from the live region too", async () => {
    const mock = makeDDMockDb(1, {}, stale("landAssembly", { SN: 24 }), RESCALED);
    await mountDD(mock);
    const { ensureDDLandAssemblyElections } = await import("./perpetualElections");
    await ensureDDLandAssemblyElections(new Date("2026-04-01T00:00:00Z"));

    const byState = new Map(mock.insertCalls.flat().map((d) => [d.state, d.totalSeats]));
    expect(byState.get("SN")).toBe(161);
  });

  it("heals a race already in flight when the chamber was resized", async () => {
    // The spawn-time force only reaches the next cycle, and a region with a live
    // race gets no new doc at all. `allocateSeats` reads `totalSeats` straight
    // off the Election for these families, so leaving it stale would resolve
    // Sachsen's Landtag back down to 24 seats in a 161-seat chamber.
    const live = [
      {
        _id: "e1",
        state: "SN",
        electionType: "landAssembly",
        countryId: "DD",
        status: "active",
        totalSeats: 24,
      },
      {
        _id: "e2",
        state: "MV",
        electionType: "landAssembly",
        countryId: "DD",
        status: "active",
        totalSeats: 63,
      },
    ] as unknown as Array<Partial<Election>>;
    const mock = makeDDMockDb(1, {}, [], RESCALED, live);
    await mountDD(mock);
    const { ensureDDLandAssemblyElections } = await import("./perpetualElections");
    await ensureDDLandAssemblyElections(new Date("2026-04-01T00:00:00Z"));

    // Only the stale one is rewritten; the one already agreeing is left alone.
    expect(mock.bulkWriteCalls.flat()).toEqual([
      {
        updateOne: {
          filter: { _id: "e1" },
          update: { $set: { totalSeats: 161, updatedAt: expect.any(Date) } },
        },
      },
    ]);
    // A region with a live race is not respawned.
    expect(mock.insertCalls.flat()).toHaveLength(0);
  });

  it("keeps the inherited count when the region doc does not size the chamber", async () => {
    // A region with no `houseDistricts` contributes nothing to the live chamber
    // sum, so there is no authoritative number to force and the previous cycle's
    // count is the best available answer. Forcing a 1 here would be a regression.
    const mock = makeDDMockDb(1, {}, stale("volkskammerDeputy", { SN: 151 }), [
      { _id: "SN", stateSenateSeats: 161 },
    ]);
    await mountDD(mock);
    const { ensureDDVolkskammerElections } = await import("./perpetualElections");
    await ensureDDVolkskammerElections(new Date("2026-04-01T00:00:00Z"));

    const byState = new Map(mock.insertCalls.flat().map((d) => [d.state, d.totalSeats]));
    expect(byState.get("SN")).toBe(151);
  });
});
