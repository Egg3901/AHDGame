/**
 * The presidential night wiring in `buildResultsPayload`: US presidents in the
 * final hour get the broadcast; every other race keeps the generic drip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import type { Election, GameState } from "@/lib/db/types";

vi.mock("@/lib/elections/liveResults/electionNight", () => ({
  buildNationalElectionNight: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/elections/apportionment", () => ({
  loadApportionment: vi.fn().mockResolvedValue({
    electoralVoteUnits: [
      { unitId: "GA", ev: 16 },
      { unitId: "OH", ev: 17 },
      { unitId: "CA", ev: 54 },
    ],
  }),
}));

import { buildResultsPayload } from "./buildResultsPayload";

const NOW = new Date("2024-11-06T00:30:00Z");
const ID = new ObjectId();
const CANDS = [new ObjectId(), new ObjectId()];

function setup(countryId: string, status = "active") {
  const mock = createMockDb();
  mock
    .collection("electionCandidates")
    .find()
    .toArray.mockResolvedValue(
      CANDS.map((id, i) => ({
        _id: id,
        party: String(i),
        characterName: `Candidate ${i}`,
        status: "active",
      }))
    );
  const [a, b] = CANDS.map(String);
  mock.collection("electionVoteTallies").findOne.mockResolvedValue({
    totalVotes: { [a]: 3_000_000, [b]: 2_000_000 },
    totalVotesByUnit: {
      GA: { [a]: 1_000_000, [b]: 500_000 },
      OH: { [a]: 1_000_000, [b]: 900_000 },
      CA: { [a]: 1_000_000, [b]: 600_000 },
    },
  });
  const race = {
    _id: ID,
    countryId,
    electionType: "president",
    state: countryId,
    status,
    startTurn: 100,
    primaryEndTurn: 110,
    endTurn: 130,
    totalSeats: 1,
  } as Election;
  const gs = {
    currentTurn: 129,
    nextScheduledTurn: new Date(NOW.getTime() + 20 * 60 * 1000),
    pausedAt: null,
    fastMode: false,
    preset: "default",
  } as unknown as GameState;
  return { db: mock as unknown as Db, race, gs };
}

describe("presidential night payload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("US president in the final hour carries the night and hides the real tally", async () => {
    const { db, race, gs } = setup("US");
    const p = await buildResultsPayload(db, race, gs, { isAdmin: false, apportionmentYear: null });
    expect(p.election.night).toBeTruthy();
    expect(p.election.night!.totalEv).toBe(87);
    expect(p.election.night!.evNeeded).toBe(44);
    expect(p.units.every((u) => u.nightStatus && u.pollsCloseAt)).toBe(true);
    // 40 minutes into the hour: only some states have closed, so the displayed
    // popular vote is below the real 5,000,000.
    expect(p.summary.totalVotes).toBeLessThan(5_000_000);
    const shown = p.candidates.reduce((s, c) => s + c.totalVotes, 0);
    expect(shown).toBe(p.summary.totalVotes);
  });

  it("the same instant gives the same payload (cache-safe)", async () => {
    const a = setup("US");
    const b = setup("US");
    const pa = await buildResultsPayload(a.db, a.race, a.gs, {
      isAdmin: false,
      apportionmentYear: null,
    });
    const pb = await buildResultsPayload(b.db, b.race, b.gs, {
      isAdmin: false,
      apportionmentYear: null,
    });
    expect(pa).toEqual(pb);
  });

  it("a paused clock does not drip or open the night", async () => {
    const { db, race, gs } = setup("US");
    const p = await buildResultsPayload(
      db,
      race,
      { ...gs, pausedAt: new Date(NOW.getTime() - 1000) } as GameState,
      { isAdmin: false, apportionmentYear: null }
    );
    expect(p.election.night).toBeUndefined();
    expect(p.election.finalHour).toBeNull();
  });

  it("non-US presidents keep the generic drip", async () => {
    const { db, race, gs } = setup("FR");
    const p = await buildResultsPayload(db, race, gs, { isAdmin: false, apportionmentYear: null });
    expect(p.election.night).toBeUndefined();
    expect(p.election.finalHour).not.toBeNull();
    expect(p.units.every((u) => u.nightStatus === undefined)).toBe(true);
    expect(p.summary.totalVotes).toBe(5_000_000);
  });

  it("an ended US race shows the real result exactly, every decided state called", async () => {
    const { db, race, gs } = setup("US", "resolved");
    const p = await buildResultsPayload(db, race, gs, { isAdmin: false, apportionmentYear: null });
    expect(p.election.night).toBeUndefined();
    expect(p.summary.totalVotes).toBe(5_000_000);
    expect(p.units.every((u) => u.called && u.reportingPct === 100)).toBe(true);
    expect(p.summary.unitsCalled).toBe(3);
  });
});

describe("admin simulation replays the presidential night", () => {
  it("uses the broadcast model for US presidents and stays monotonic", async () => {
    const { buildSimulationScript, simulationFrame } = await import("./simulateResults");
    const base = {
      election: {
        id: "x",
        countryId: "US",
        electionType: "president",
        state: "US",
        status: "active",
        cycle: 1,
        electionYear: 2024,
        currentTurn: 129,
        startTurn: 100,
        endTurn: 130,
        totalSeats: 0,
        finalHour: null,
      },
      candidates: [],
      units: ["GA", "OH", "CA", "TX", "NY", "AK"].map((id) => ({
        id,
        name: id,
        weight: 10,
        totalVotes: 0,
        reportingPct: 0,
        called: false,
        tied: false,
        leaderMargin: 0,
        leaderMarginPct: 0,
        candidates: [],
      })),
      national: null,
      summary: { totalVotes: 0, unitsReporting: 0, totalUnits: 6, unitsCalled: 0 },
      isAdmin: true,
      lastUpdated: NOW.toISOString(),
    };
    const script = buildSimulationScript(base, 42);
    const start = simulationFrame(script, 0);
    expect(start.simulated).toBe(true);
    expect(start.units.every((u) => u.nightStatus === "polls_open")).toBe(true);
    let prevCalled = 0;
    for (let i = 1; i <= 50; i++) {
      const f = simulationFrame(script, i / 50);
      expect(f.election.night).toBeTruthy();
      expect(f.summary.unitsCalled).toBeGreaterThanOrEqual(prevCalled);
      prevCalled = f.summary.unitsCalled;
    }
  });
});
