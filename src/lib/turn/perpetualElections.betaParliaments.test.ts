/**
 * Beta parliamentary countries (FR/IT/ES/SE/TR) election scheduling — #3239.
 *
 * Verifies:
 *  - runtime status gate (coming-soon spawns nothing; beta spawns)
 *  - era-aware canonical anchors per preset (1953 / 1979 / 1991 / 2019)
 *  - ES era-gating: 1953-default (Franco) spawns NOTHING; 1979+ spawns
 *  - chamber sizes come from the seeded region docs' houseDistricts
 *  - cycle 2 stays on the LARP calendar and opens its primary immediately
 *  - live elections suppress duplicate spawning
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

const MS = 3_600_000;

interface MockRegion {
  id: string;
  houseDistricts: number;
  /** Upper-chamber (Senate) seat count — read by ensureBetaSenateElections (#3791). */
  stateSenateSeats?: number;
}

interface MockWorld {
  preset: string;
  startingYear: number;
  currentTurn: number;
  /** countryGameStates status; null = no doc (config "coming-soon" wins). */
  status?: "beta" | "active" | null;
}

function makeMockDb(
  countryId: CountryId,
  regions: MockRegion[],
  liveOrUpcoming: Election[],
  completed: Election[],
  world: MockWorld
) {
  const insertCalls: Omit<Election, "_id">[][] = [];
  const electionsCollection = {
    find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
      // Country-scoped. GR/AT/FI used to be bundled into `ensureTRElections`;
      // they now own their COUNTRY_ELECTION_PHASES entries and spawners, but
      // this scoping stays: it keeps a single-country test from leaking
      // matches into another country's spawner queries (#3791).
      if (filter.countryId !== undefined && filter.countryId !== countryId) {
        return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue([]) };
      }
      const status = (filter.status as { $in?: string[] }) ?? {};
      const isLive = status.$in?.includes("active") && status.$in?.includes("upcoming");
      const pool = isLive ? liveOrUpcoming : completed;
      return {
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(pool),
      };
    }),
    insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
      insertCalls.push(docs);
      return Promise.resolve({ insertedIds: {} });
    }),
  };
  const statesCollection = {
    find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      // Same country-scoping as electionsCollection above.
      if (filter.countryId !== undefined && filter.countryId !== countryId) {
        return { toArray: vi.fn().mockResolvedValue([]) };
      }
      return {
        toArray: vi.fn().mockResolvedValue(
          regions.map((r) => ({
            _id: r.id,
            houseDistricts: r.houseDistricts,
            stateSenateSeats: r.stateSenateSeats,
          }))
        ),
      };
    }),
  };
  const gameStateCollection = {
    findOne: vi.fn().mockResolvedValue({
      currentTurn: world.currentTurn,
      preset: world.preset,
      startingYear: world.startingYear,
      nppAutonomyLevel: "off",
    }),
  };
  const countryGameStatesCollection = {
    findOne: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      // Country-scoped like the collections above — GR/AT/FI (bundled into
      // ensureTRElections) must NOT inherit TR's mocked status.
      if (filter._id !== undefined && filter._id !== countryId) return Promise.resolve(null);
      return Promise.resolve(
        world.status == null ? null : { _id: countryId, status: world.status }
      );
    }),
  };
  return {
    electionsCollection,
    statesCollection,
    gameStateCollection,
    countryGameStatesCollection,
    insertCalls,
  };
}

async function mountDb(mock: ReturnType<typeof makeMockDb>) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "elections") return mock.electionsCollection;
      if (name === "states") return mock.statesCollection;
      if (name === "gameState") return mock.gameStateCollection;
      if (name === "countryGameStates") return mock.countryGameStatesCollection;
      return {
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
        findOne: vi.fn().mockResolvedValue(null),
      };
    }),
  } as never);
}

const NOW = new Date("2026-04-01T00:00:00Z");

const FR_REGIONS_1953: MockRegion[] = [
  { id: "FR_IDF", houseDistricts: 70 },
  { id: "FR_NOR", houseDistricts: 40 },
];
const TR_REGIONS: MockRegion[] = [
  { id: "TR_MAR", houseDistricts: 110 },
  { id: "TR_ANK", houseDistricts: 60 },
];
const SE_REGIONS_1953: MockRegion[] = [
  { id: "SE_STO", houseDistricts: 40 },
  { id: "SE_SKA", houseDistricts: 30 },
];
const ES_REGIONS: MockRegion[] = [
  { id: "ES_MAD", houseDistricts: 50 },
  { id: "ES_CAT", houseDistricts: 47 },
];
const IT_REGIONS_1953: MockRegion[] = [
  { id: "IT_NW", houseDistricts: 90 },
  { id: "IT_SUD", houseDistricts: 85 },
];
const GR_REGIONS: MockRegion[] = [
  { id: "GR_ATT", houseDistricts: 10 },
  { id: "GR_MAC", houseDistricts: 8 },
];
// Senate-bearing regions (#3791): stateSenateSeats sizes the upper-chamber
// spawn, independent of houseDistricts (the lower chamber's seat map).
const FR_SENATE_REGIONS: MockRegion[] = [
  { id: "FR_IDF", houseDistricts: 70, stateSenateSeats: 40 },
  { id: "FR_NOR", houseDistricts: 40, stateSenateSeats: 20 },
];
const TR_SENATE_REGIONS: MockRegion[] = [
  { id: "TR_MAR", houseDistricts: 110, stateSenateSeats: 10 },
  { id: "TR_ANK", houseDistricts: 60, stateSenateSeats: 6 },
];

describe("ensureBetaParliamentElections (FR/IT/ES/SE/TR, #3239)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe("runtime status gate", () => {
    it("spawns nothing while the country is coming-soon (no countryGameStates doc)", async () => {
      const mock = makeMockDb("TR", TR_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: null,
      });
      await mountDb(mock);
      const { ensureTRElections } = await import("./perpetualElections");
      await ensureTRElections(NOW);
      expect(mock.insertCalls.flat()).toHaveLength(0);
    });

    it("spawns once the runtime status flips to beta", async () => {
      const mock = makeMockDb("TR", TR_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureTRElections } = await import("./perpetualElections");
      await ensureTRElections(NOW);
      expect(mock.insertCalls.flat()).toHaveLength(TR_REGIONS.length);
    });
  });

  describe("1953-default anchors", () => {
    it("TR: Grand National Assembly cycle 1 ends turn 96 (1954), seats from houseDistricts", async () => {
      const mock = makeMockDb("TR", TR_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureTRElections } = await import("./perpetualElections");
      await ensureTRElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(2);
      for (const doc of inserted) {
        expect(doc.countryId).toBe("TR");
        expect(doc.electionType).toBe("milletMeclisi");
        expect(doc.status).toBe("active");
        expect(doc.endTurn).toBe(96); // end of 1954
        expect(doc.electionYear).toBe(1954);
        expect(doc.durationHours).toBe(48);
        expect(doc.primaryDurationHours).toBe(24);
      }
      const byState = new Map(inserted.map((d) => [d.state, d.totalSeats]));
      expect(byState.get("TR_MAR")).toBe(110);
      expect(byState.get("TR_ANK")).toBe(60);
    });

    it("FR: National Assembly (IV Republic) cycle 1 ends turn 192 (1956)", async () => {
      const mock = makeMockDb("FR", FR_REGIONS_1953, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureFRElections } = await import("./perpetualElections");
      await ensureFRElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(2);
      expect(inserted[0].electionType).toBe("assembleeNationale");
      expect(inserted[0].endTurn).toBe(192); // end of 1956
      expect(inserted[0].electionYear).toBe(1956);
    });

    it("IT: Chamber of Deputies cycle 1 ends turn 288 (1958 — June 1953 already past seed date)", async () => {
      const mock = makeMockDb("IT", IT_REGIONS_1953, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureITElections } = await import("./perpetualElections");
      await ensureITElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(2);
      expect(inserted[0].electionType).toBe("cameraDeputati");
      expect(inserted[0].endTurn).toBe(288); // end of 1958
      expect(inserted[0].electionYear).toBe(1958);
    });

    it("SE: Riksdag (Second Chamber era) cycle 1 ends turn 192 (1956) with era-correct seat counts", async () => {
      const mock = makeMockDb("SE", SE_REGIONS_1953, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureSEElections } = await import("./perpetualElections");
      await ensureSEElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(2);
      expect(inserted[0].electionType).toBe("riksdag");
      expect(inserted[0].endTurn).toBe(192); // end of 1956
      expect(inserted[0].electionYear).toBe(1956);
      const byState = new Map(inserted.map((d) => [d.state, d.totalSeats]));
      expect(byState.get("SE_STO")).toBe(40);
      expect(byState.get("SE_SKA")).toBe(30);
    });

    it("ES: spawns NOTHING in 1953 (Franco dictatorship — era-gated)", async () => {
      const mock = makeMockDb("ES", ES_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureESElections } = await import("./perpetualElections");
      await ensureESElections(NOW);
      expect(mock.insertCalls.flat()).toHaveLength(0);
      expect(mock.electionsCollection.insertMany).not.toHaveBeenCalled();
    });

    it("ES stays static across the whole 1953 sim horizon (still nothing at turn 250)", async () => {
      const mock = makeMockDb("ES", ES_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 250,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureESElections } = await import("./perpetualElections");
      await ensureESElections(NOW);
      expect(mock.insertCalls.flat()).toHaveLength(0);
    });
  });

  describe("1991-default anchors", () => {
    const WORLD = { preset: "1991-default", startingYear: 1991, currentTurn: 1 } as const;

    it.each([
      ["FR", "ensureFRElections", "assembleeNationale", 144, 1993], // 1993 GE
      ["IT", "ensureITElections", "cameraDeputati", 96, 1992], // 1992 GE
      ["ES", "ensureESElections", "congresoDiputados", 144, 1993], // 1993 GE
      ["SE", "ensureSEElections", "riksdag", 192, 1994], // 1994 GE
      ["TR", "ensureTRElections", "milletMeclisi", 240, 1995], // 1995 GE
    ] as const)("%s cycle 1 ends turn %i (%i)", async (cc, fnName, type, endTurn, year) => {
      const regions: MockRegion[] = [{ id: `${cc}_A`, houseDistricts: 25 }];
      const mock = makeMockDb(cc as CountryId, regions, [], [], { ...WORLD, status: "beta" });
      await mountDb(mock);
      const mod = await import("./perpetualElections");
      await (mod as unknown as Record<string, (n: Date) => Promise<void>>)[fnName](NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].electionType).toBe(type);
      expect(inserted[0].endTurn).toBe(endTurn);
      expect(inserted[0].electionYear).toBe(year);
      expect(inserted[0].totalSeats).toBe(25);
    });
  });

  describe("2019-default anchors", () => {
    const WORLD = { preset: "2019-default", startingYear: 2019, currentTurn: 1 } as const;

    it.each([
      ["FR", "ensureFRElections", 192, 2022],
      ["IT", "ensureITElections", 192, 2022],
      ["ES", "ensureESElections", 240, 2023],
      ["SE", "ensureSEElections", 192, 2022],
      ["TR", "ensureTRElections", 240, 2023],
    ] as const)("%s cycle 1 ends turn %i (%i)", async (cc, fnName, endTurn, year) => {
      const regions: MockRegion[] = [{ id: `${cc}_A`, houseDistricts: 30 }];
      const mock = makeMockDb(cc as CountryId, regions, [], [], { ...WORLD, status: "beta" });
      await mountDb(mock);
      const mod = await import("./perpetualElections");
      await (mod as unknown as Record<string, (n: Date) => Promise<void>>)[fnName](NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].endTurn).toBe(endTurn);
      expect(inserted[0].electionYear).toBe(year);
    });
  });

  describe("1979-default anchors (ES post-Franco democracy)", () => {
    it("ES cycle 1 ends turn 192 (1982 general — first cycle after the transition)", async () => {
      const mock = makeMockDb("ES", ES_REGIONS, [], [], {
        preset: "1979-default",
        startingYear: 1979,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureESElections } = await import("./perpetualElections");
      await ensureESElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(2);
      expect(inserted[0].electionType).toBe("congresoDiputados");
      expect(inserted[0].endTurn).toBe(192); // end of 1982
      expect(inserted[0].electionYear).toBe(1982);
    });
  });

  describe("steady-state cycling", () => {
    it("TR cycle 2 stays on the LARP calendar (endTurn 288) and opens its primary immediately", async () => {
      // 1953 preset: cycle 1 ended turn 96; two turns later the spawner runs.
      const currentTurn = 98;
      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "TR",
        electionType: "milletMeclisi",
        state: "TR_MAR",
        cycle: 1,
        status: "resolved",
        totalSeats: 110,
        endTime: new Date(NOW.getTime() - 2 * MS),
        durationHours: 48,
        updatedAt: new Date(NOW.getTime() - 2 * MS),
      } as Election;

      const mock = makeMockDb("TR", [TR_REGIONS[0]], [], [resolved], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureTRElections } = await import("./perpetualElections");
      await ensureTRElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(2);
      expect(inserted[0].status).toBe("active");
      expect(inserted[0].startTurn).toBe(currentTurn); // primary opens now
      expect(inserted[0].endTurn).toBe(96 + 192); // canonical 4-year period
      expect(inserted[0].electionYear).toBe(1958);
      expect(inserted[0].totalSeats).toBe(110); // carried from prev
    });

    it("does not spawn while a live election exists for the region", async () => {
      const live: Election = {
        _id: new ObjectId(),
        countryId: "SE",
        electionType: "riksdag",
        state: "SE_STO",
        cycle: 1,
        status: "active",
        totalSeats: 40,
        startTime: NOW,
        endTime: new Date(NOW.getTime() + 100 * MS),
        durationHours: 48,
        updatedAt: NOW,
      } as Election;
      const mock = makeMockDb("SE", SE_REGIONS_1953, [live], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 10,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureSEElections } = await import("./perpetualElections");
      await ensureSEElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1); // only the region without a live race
      expect(inserted[0].state).toBe("SE_SKA");
    });

    it("does not respawn in the same tick the prior cycle resolved (same-turn guard)", async () => {
      const justResolved: Election = {
        _id: new ObjectId(),
        countryId: "FR",
        electionType: "assembleeNationale",
        state: "FR_IDF",
        cycle: 1,
        status: "resolved",
        totalSeats: 70,
        endTime: NOW,
        durationHours: 48,
        updatedAt: NOW,
      } as Election;
      const mock = makeMockDb("FR", [FR_REGIONS_1953[0]], [], [justResolved], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 193,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureFRElections } = await import("./perpetualElections");
      await ensureFRElections(NOW);
      expect(mock.insertCalls.flat()).toHaveLength(0);
    });
  });

  // ─── #3791 defect 1: AT/FI/GR never held an election ──────────────────────
  //
  // Root cause: `countryGameStates.status` was never written for AT/FI/GR (no
  // entry in the seed-time enablement roster that FR/IT/ES/SE/TR use), so
  // `countryElectionsLive` fell back to their compiled config status
  // ("coming-soon") forever, even though they have real seeded states/parties
  // exactly like their FR/IT/ES/SE/TR siblings. Fixed in
  // `worldEntityManifest.ts` (promoteEuropeanSphereMacroToFullAutonomous).
  describe("GR/AT/FI runtime status gate — the fix for #3791 (three countries never held an election)", () => {
    it("spawns nothing while GR has no countryGameStates status (config falls back to coming-soon, the pre-fix state)", async () => {
      const mock = makeMockDb("GR", GR_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: null,
      });
      await mountDb(mock);
      const { ensureGRElections } = await import("./perpetualElections");
      await ensureGRElections(NOW);
      expect(mock.insertCalls.flat()).toHaveLength(0);
    });

    it("GR admits its Vouli election once countryGameStates.status resolves to beta (previously always missing)", async () => {
      const mock = makeMockDb("GR", GR_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureGRElections } = await import("./perpetualElections");
      await ensureGRElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(GR_REGIONS.length);
      for (const doc of inserted) {
        expect(doc.countryId).toBe("GR");
        expect(doc.electionType).toBe("vouli");
        expect(doc.status).toBe("active");
      }
    });
  });

  // ─── #3791 defect 2: upper chambers only ever lose members ────────────────
  //
  // No spawner existed for any Senate — `ensureBetaParliamentElections` only
  // ever ran for the LOWER chamber, so once a seeded senator's term lapsed
  // nothing refilled the seat. Fixed by `ensureBetaSenateElections` (new
  // sibling spawner, seats sourced from `stateSenateSeats`).
  describe("Senate spawners — upper chambers get a re-election path (#3791 defect 2 fix)", () => {
    it("FR Sénat spawns from stateSenateSeats (independent of the Assemblée's houseDistricts)", async () => {
      const mock = makeMockDb("FR", FR_SENATE_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureFRSenateElections } = await import("./perpetualElections");
      await ensureFRSenateElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(FR_SENATE_REGIONS.length);
      const byState = new Map(inserted.map((d) => [d.state, d.totalSeats]));
      expect(byState.get("FR_IDF")).toBe(40); // from stateSenateSeats, NOT houseDistricts (70)
      expect(byState.get("FR_NOR")).toBe(20);
      for (const doc of inserted) {
        expect(doc.electionType).toBe("senat");
        expect(doc.status).toBe("active");
      }
    });

    it("a vacant TR Senate seat (all prior terms lapsed) gets a NEW spawn on the next cycle — the vacancy-only-decay fix", async () => {
      // Mirrors the "TR cycle 2" lower-chamber steady-state test: a resolved
      // prior term two turns ago, spawner runs again, cycle 2 is created.
      // Before this fix there was no spawner at all, so a lapsed TR Senate
      // seat (measured: 16/16 = 100% vacant at turn 654) stayed vacant
      // forever — this proves the seat now gets a re-election path.
      const currentTurn = 290; // just past cycle 1's endTurn (288 = 1953 + 6y)
      const resolved: Election = {
        _id: new ObjectId(),
        countryId: "TR",
        electionType: "senato",
        state: "TR_MAR",
        cycle: 1,
        status: "resolved",
        totalSeats: 10,
        endTime: new Date(NOW.getTime() - 2 * MS),
        durationHours: 48,
        updatedAt: new Date(NOW.getTime() - 2 * MS),
      } as Election;

      const mock = makeMockDb("TR", [TR_SENATE_REGIONS[0]], [], [resolved], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureTRSenateElections } = await import("./perpetualElections");
      await ensureTRSenateElections(NOW);

      const inserted = mock.insertCalls.flat();
      expect(inserted).toHaveLength(1);
      expect(inserted[0].cycle).toBe(2);
      expect(inserted[0].status).toBe("active");
      expect(inserted[0].electionType).toBe("senato");
      expect(inserted[0].startTurn).toBe(currentTurn); // primary opens immediately
      expect(inserted[0].totalSeats).toBe(10); // carried from prev (stateSenateSeats)
    });

    it("IT Senato rides the SAME anchor as the Camera (concurrent election, not a simplification)", async () => {
      const regions: MockRegion[] = [{ id: "IT_NW", houseDistricts: 90, stateSenateSeats: 35 }];
      const mock = makeMockDb("IT", regions, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureITSenateElections, ensureITElections } = await import("./perpetualElections");
      await ensureITSenateElections(NOW);
      const senatoEndTurn = mock.insertCalls.flat()[0]?.endTurn;

      mock.insertCalls.length = 0;
      await ensureITElections(NOW);
      const cameraEndTurn = mock.insertCalls.flat()[0]?.endTurn;

      expect(senatoEndTurn).toBe(cameraEndTurn);
    });

    it("ES Senado is era-gated off in 1953-default exactly like the Congreso (Franco dictatorship)", async () => {
      const mock = makeMockDb("ES", ES_REGIONS, [], [], {
        preset: "1953-default",
        startingYear: 1953,
        currentTurn: 1,
        status: "beta",
      });
      await mountDb(mock);
      const { ensureESSenateElections } = await import("./perpetualElections");
      await ensureESSenateElections(NOW);
      expect(mock.insertCalls.flat()).toHaveLength(0);
    });
  });
});
