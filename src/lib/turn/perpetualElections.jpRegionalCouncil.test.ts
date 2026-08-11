/**
 * Tests for ensureJPRegionalCouncilElections — JP prefectural-assembly
 * (Regional Council) spawner.
 *
 * JP Regional Council elections were never spawned: the config, seats, labels,
 * Discord, whips, seeded officeholders, and country-agnostic resolution path all
 * exist, but no spawner existed and the JP election-phase registry had no
 * regional-council entry. The spawner mirrors the UK pattern but synchronizes to
 * the Shugiin (lower chamber) cycle instead of Commons.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Election } from "@/lib/db/types";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";
import { DEFAULT_CYCLE_ANCHOR_CONTEXT } from "@/lib/elections/cycleAnchorContext";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

const NOW = new Date("2026-04-01T00:00:00Z");
const OLD = new Date("2026-03-01T00:00:00Z"); // > 1 turn before NOW → not justResolvedInSameTurn

/**
 * Filter-aware mock db. Distinguishes live council vs live shugiin vs completed
 * council finds by inspecting `filter.electionType` + `filter.status`.
 */
function makeMockDb(opts: {
  states: Array<Record<string, unknown>>;
  liveCouncil?: Array<Partial<Election>>;
  completedCouncil?: Array<Partial<Election>>;
  liveShugiin?: Array<Partial<Election>>;
  currentTurn: number;
}) {
  const { states, liveCouncil = [], completedCouncil = [], liveShugiin = [], currentTurn } = opts;
  const insertCalls: Omit<Election, "_id">[][] = [];

  function matchesShugiin(electionType: unknown): boolean {
    if (typeof electionType === "string") return electionType === "shugiin";
    const inList = (electionType as { $in?: string[] } | undefined)?.$in ?? [];
    return inList.includes("shugiin");
  }

  const electionsCollection = {
    find: vi.fn().mockImplementation((filter: Record<string, unknown>) => {
      if (filter.$or) return { toArray: vi.fn().mockResolvedValue([]) };
      const statusIn = (filter.status as { $in?: string[] } | undefined)?.$in ?? [];
      const isCompleted = statusIn.includes("completed") || statusIn.includes("resolved");
      const isShugiin = matchesShugiin(filter.electionType);
      let rows: Array<Partial<Election>>;
      if (isShugiin) {
        rows = liveShugiin; // shugiin is only queried for the live sync source
      } else {
        rows = isCompleted ? completedCouncil : liveCouncil;
      }
      return { sort: vi.fn().mockReturnThis(), toArray: vi.fn().mockResolvedValue(rows) };
    }),
    insertMany: vi.fn().mockImplementation((docs: Omit<Election, "_id">[]) => {
      insertCalls.push(docs);
      return Promise.resolve({ insertedIds: {} });
    }),
    findOne: vi.fn().mockResolvedValue(null),
  };
  const statesCollection = {
    find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(states) }),
    findOne: vi.fn().mockResolvedValue(null),
    bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
  const gameStateCollection = { findOne: vi.fn().mockResolvedValue({ currentTurn }) };
  return { electionsCollection, statesCollection, gameStateCollection, insertCalls };
}

async function mount(mock: ReturnType<typeof makeMockDb>) {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue({
    collection: vi.fn().mockImplementation((name: string) => {
      if (name === "elections") return mock.electionsCollection;
      if (name === "states") return mock.statesCollection;
      if (name === "gameState") return mock.gameStateCollection;
      return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
    }),
  } as never);
}

function canon(electionType: string, cycle: number, extra: Record<string, unknown> = {}) {
  return canonicalTurnsForCycle({
    electionType,
    cycle,
    ctx: DEFAULT_CYCLE_ANCHOR_CONTEXT,
    ...extra,
  })!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureJPRegionalCouncilElections", () => {
  it("mirrors the live Shugiin race timing/cycle/year for each JP region", async () => {
    // A live Shugiin race exists for HOK; the council must copy its schedule.
    const shugiin = {
      state: "HOK",
      electionType: "shugiin" as const,
      countryId: "JP" as const,
      cycle: 3,
      electionYear: 2024,
      status: "active" as const,
      startTime: new Date("2026-04-01T00:00:00Z"),
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      endTime: new Date("2026-04-03T00:00:00Z"),
      startTurn: 500,
      primaryEndTurn: 524,
      endTurn: 548,
    };

    const mock = makeMockDb({
      states: [{ _id: "HOK", stateSenateSeats: 100 }],
      liveShugiin: [shugiin],
      currentTurn: 500,
    });
    await mount(mock);

    const { ensureJPRegionalCouncilElections } = await import("./perpetualElections");
    await ensureJPRegionalCouncilElections(NOW);

    const doc = mock.insertCalls.flat().find((d) => d.state === "HOK")!;
    expect(doc).toBeDefined();
    expect(doc.countryId).toBe("JP");
    expect(doc.electionType).toBe("regionalCouncil");
    expect(doc.seatId).toBe("JP-regionalCouncil-HOK");
    expect(doc.status).toBe("active");
    // Cycle + year copied from the Shugiin it mirrors (JP-correct calendar).
    expect(doc.cycle).toBe(3);
    expect(doc.electionYear).toBe(2024);
    // Timing mirrors the Shugiin exactly.
    expect(doc.startTurn).toBe(shugiin.startTurn);
    expect(doc.primaryEndTurn).toBe(shugiin.primaryEndTurn);
    expect(doc.endTurn).toBe(shugiin.endTurn);
    expect(new Date(doc.startTime!).getTime()).toBe(shugiin.startTime.getTime());
    expect(new Date(doc.endTime!).getTime()).toBe(shugiin.endTime.getTime());
    // Seats from the region's stateSenateSeats.
    expect(doc.totalSeats).toBe(100);
  });

  it("spawns a council race for every JP region with a live Shugiin", async () => {
    const mkShugiin = (state: string) => ({
      state,
      electionType: "shugiin" as const,
      countryId: "JP" as const,
      cycle: 1,
      electionYear: 2024,
      status: "active" as const,
      startTime: NOW,
      primaryEndTime: new Date("2026-04-02T00:00:00Z"),
      endTime: new Date("2026-04-03T00:00:00Z"),
      startTurn: 100,
      primaryEndTurn: 124,
      endTurn: 148,
    });
    const regions = ["HOK", "TOH", "KAN", "CHU", "KNS", "CGK", "SHI", "KYU"];

    const mock = makeMockDb({
      states: regions.map((r) => ({ _id: r, stateSenateSeats: 50 })),
      liveShugiin: regions.map(mkShugiin),
      currentTurn: 100,
    });
    await mount(mock);

    const { ensureJPRegionalCouncilElections } = await import("./perpetualElections");
    await ensureJPRegionalCouncilElections(NOW);

    const inserted = mock.insertCalls.flat();
    expect(inserted).toHaveLength(8);
    expect(new Set(inserted.map((d) => d.state))).toEqual(new Set(regions));
    expect(inserted.every((d) => d.electionType === "regionalCouncil")).toBe(true);
    expect(inserted.every((d) => d.countryId === "JP")).toBe(true);
  });

  it("does not spawn when a live council already exists (idempotent)", async () => {
    const mock = makeMockDb({
      states: [{ _id: "HOK", stateSenateSeats: 100 }],
      liveCouncil: [{ state: "HOK", electionType: "regionalCouncil", countryId: "JP" }],
      liveShugiin: [
        {
          state: "HOK",
          electionType: "shugiin",
          countryId: "JP",
          cycle: 3,
          status: "active",
          startTime: NOW,
          primaryEndTime: NOW,
          endTime: NOW,
          startTurn: 500,
          primaryEndTurn: 524,
          endTurn: 548,
        },
      ],
      currentTurn: 500,
    });
    await mount(mock);

    const { ensureJPRegionalCouncilElections } = await import("./perpetualElections");
    await ensureJPRegionalCouncilElections(NOW);

    expect(mock.insertCalls.flat()).toHaveLength(0);
  });

  it("falls back to the Shugiin canonical cycle when no live Shugiin exists", async () => {
    const exp1 = canon("shugiin", 1);
    const exp2 = canon("shugiin", 2);
    const currentTurn = exp2.startTurn;

    const mock = makeMockDb({
      states: [{ _id: "HOK", stateSenateSeats: 100 }],
      completedCouncil: [
        {
          state: "HOK",
          electionType: "regionalCouncil",
          countryId: "JP",
          cycle: 1,
          endTurn: exp1.endTurn,
          updatedAt: OLD,
        },
      ],
      // No live Shugiin → independent canonical path on the Shugiin schedule.
      currentTurn,
    });
    await mount(mock);

    const { ensureJPRegionalCouncilElections } = await import("./perpetualElections");
    await ensureJPRegionalCouncilElections(NOW);

    const doc = mock.insertCalls.flat().find((d) => d.state === "HOK")!;
    expect(doc).toBeDefined();
    expect(doc.electionType).toBe("regionalCouncil");
    expect(doc.countryId).toBe("JP");
    expect(doc.cycle).toBe(2);
    expect(doc.endTurn).toBe(exp2.endTurn);
    expect(doc.primaryEndTurn).toBe(exp2.primaryEndTurn);
    expect(doc.totalSeats).toBe(100);
  });
});

describe("COUNTRY_ELECTION_PHASES registry", () => {
  it("registers the JP regional-council phase after jpElections", async () => {
    const { COUNTRY_ELECTION_PHASES } = await import("./countryPhases");
    const jpPhases = COUNTRY_ELECTION_PHASES.JP ?? [];
    const names = jpPhases.map((p) => p.name);
    expect(names).toContain("jpRegionalCouncilElections");
    // Must run after jpElections so the live Shugiin race exists to mirror.
    expect(names.indexOf("jpRegionalCouncilElections")).toBeGreaterThan(
      names.indexOf("jpElections")
    );
  });
});
