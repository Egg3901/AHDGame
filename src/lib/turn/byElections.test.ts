/**
 * By-election watcher — multi-country (US + RU) vacancy detection and spawn.
 *
 * The watcher walks BY_ELECTION_COUNTRIES: US governor tombstones (including
 * legacy rows without countryId) and RU First Secretary tombstones each spawn
 * a `special_governor` race scoped to their own country. RU is status-gated —
 * a coming-soon world never spawns.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Election } from "@/lib/db/types";
import {
  BY_ELECTION_COUNTRIES,
  BY_ELECTION_RETRY_COOLDOWN_TURNS,
  SPECIAL_GOVERNOR_ELECTION_TYPE,
  SPECIAL_GOVERNOR_FILING_TURNS,
  SPECIAL_GOVERNOR_GENERAL_TURNS,
  processByElectionWatcher,
  spawnGovernorByElection,
} from "./byElections";

vi.mock("@/lib/countryAccess", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCountryAccessFromDb: vi.fn(),
}));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

/** Does a watcher scope filter match a row's countryId? */
function scopeMatches(filter: Record<string, unknown>, rowCountry: string | undefined): boolean {
  const or = filter.$or as { countryId?: unknown }[] | undefined;
  if (or) {
    return or.some((clause) =>
      typeof clause.countryId === "string"
        ? clause.countryId === rowCountry
        : rowCountry === undefined
    );
  }
  return filter.countryId === rowCountry;
}

interface OfficialRow {
  countryId?: string;
  officeType: string;
  state: string;
  characterId: unknown;
  nppId: unknown;
}

const NOW = new Date("2026-07-20T12:00:00Z");
const TURN = 1000;

describe("by-election watcher — US + RU", () => {
  let db: MockDb;
  let officialRows: OfficialRow[];
  let liveGovernorRaces: { countryId?: string; state: string }[];
  let priorSpecials: Partial<Election>[];

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    officialRows = [];
    liveGovernorRaces = [];
    priorSpecials = [];

    db.collection("electedOfficials");
    db.collection("elections");
    db.collectionMocks.electedOfficials!.find.mockImplementation(
      (filter: Record<string, unknown>) =>
        cursor(officialRows.filter((r) => scopeMatches(filter, r.countryId)))
    );
    db.collectionMocks.elections!.findOne.mockImplementation(
      async (filter: Record<string, unknown>) =>
        liveGovernorRaces.find(
          (r) => scopeMatches(filter, r.countryId) && r.state === filter.state
        ) ?? null
    );
    db.collectionMocks.elections!.find.mockImplementation((filter: Record<string, unknown>) =>
      cursor(
        priorSpecials.filter((r) => scopeMatches(filter, r.countryId) && r.state === filter.state)
      )
    );

    const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({ status: "beta" } as never);
  });

  it("watches exactly US and RU", () => {
    expect(BY_ELECTION_COUNTRIES).toEqual(["US", "RU"]);
  });

  it("spawns a US special for a legacy tombstone row without countryId", async () => {
    officialRows.push({ officeType: "governor", state: "CA", characterId: null, nppId: null });

    const { spawned } = await processByElectionWatcher(db as unknown as Db, TURN, NOW);
    expect(spawned).toBe(1);

    const doc = db.collectionMocks.elections!.insertOne.mock.calls[0]![0] as Election;
    expect(doc).toMatchObject({
      electionType: SPECIAL_GOVERNOR_ELECTION_TYPE,
      countryId: "US",
      state: "CA",
      cycle: TURN,
      totalSeats: 1,
      primaryEndTurn: TURN + SPECIAL_GOVERNOR_FILING_TURNS,
      endTurn: TURN + SPECIAL_GOVERNOR_FILING_TURNS + SPECIAL_GOVERNOR_GENERAL_TURNS,
    });
  });

  it("spawns an RU special for a vacant First Secretary seat, scoped to RU", async () => {
    officialRows.push({
      countryId: "RU",
      officeType: "governor",
      state: "TRA",
      characterId: null,
      nppId: null,
    });

    const { spawned } = await processByElectionWatcher(db as unknown as Db, TURN, NOW);
    expect(spawned).toBe(1);

    const doc = db.collectionMocks.elections!.insertOne.mock.calls[0]![0] as Election;
    expect(doc).toMatchObject({
      electionType: SPECIAL_GOVERNOR_ELECTION_TYPE,
      countryId: "RU",
      state: "TRA",
    });
    expect(doc.seatId).toContain("RU");
  });

  it("does NOT spawn for RU when the country is coming-soon", async () => {
    const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({ status: "coming-soon" } as never);
    officialRows.push({
      countryId: "RU",
      officeType: "governor",
      state: "TRA",
      characterId: null,
      nppId: null,
    });

    const { spawned } = await processByElectionWatcher(db as unknown as Db, TURN, NOW);
    expect(spawned).toBe(0);
    expect(db.collectionMocks.elections!.insertOne).not.toHaveBeenCalled();
  });

  it("suppresses when a regular governor race is live for that region", async () => {
    officialRows.push({
      countryId: "RU",
      officeType: "governor",
      state: "CEN",
      characterId: null,
      nppId: null,
    });
    liveGovernorRaces.push({ countryId: "RU", state: "CEN" });

    const { spawned } = await processByElectionWatcher(db as unknown as Db, TURN, NOW);
    expect(spawned).toBe(0);
  });

  it("suppresses within the retry cooldown after a resolved special", async () => {
    officialRows.push({
      countryId: "RU",
      officeType: "governor",
      state: "CEN",
      characterId: null,
      nppId: null,
    });
    priorSpecials.push({
      countryId: "RU",
      state: "CEN",
      status: "completed",
      endTurn: TURN - BY_ELECTION_RETRY_COOLDOWN_TURNS + 1,
    });

    const { spawned } = await processByElectionWatcher(db as unknown as Db, TURN, NOW);
    expect(spawned).toBe(0);
  });

  it("a filled seat and a foreign-country vacancy never cross-trigger", async () => {
    // Filled RU seat + vacant US seat: only the US special spawns.
    officialRows.push(
      { countryId: "RU", officeType: "governor", state: "TRA", characterId: "c1", nppId: null },
      { countryId: "US", officeType: "governor", state: "TX", characterId: null, nppId: null }
    );

    const { spawned } = await processByElectionWatcher(db as unknown as Db, TURN, NOW);
    expect(spawned).toBe(1);
    const doc = db.collectionMocks.elections!.insertOne.mock.calls[0]![0] as Election;
    expect(doc).toMatchObject({ countryId: "US", state: "TX" });
  });
});

describe("spawnGovernorByElection", () => {
  it("defaults to US for existing callers", async () => {
    const db = createMockDb();
    db.collection("elections");
    await spawnGovernorByElection(db as unknown as Db, "CA", TURN, NOW);
    const doc = db.collectionMocks.elections!.insertOne.mock.calls[0]![0] as Election;
    expect(doc.countryId).toBe("US");
  });
});
