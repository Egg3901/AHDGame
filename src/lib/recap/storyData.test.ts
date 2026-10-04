import { describe, it, expect } from "vitest";
import type { CareerEvent } from "@/lib/db/types/character";
import {
  MAX_BINS,
  buildActivity,
  buildCareer,
  buildLegislation,
  buildRaces,
  buildWealth,
  dateOfTurn,
  turnOfDate,
  type BillVoteRow,
  type RaceInput,
  type RecapClock,
} from "./storyData";

const T0 = Date.UTC(2026, 7, 1);
const HOUR = 3_600_000;

function clock(over: Partial<RecapClock> = {}): RecapClock {
  return {
    currentTurn: 1329,
    startingYear: 1953,
    preIterationTurns: 48,
    // Turn t was first seen at T0 + t hours, except a 10-day pause after turn 500.
    turnTimeline: Array.from({ length: 1329 }, (_, i) => {
      const t = i + 1;
      return [T0 + t * HOUR + (t > 500 ? 240 * HOUR : 0), t] as [number, number];
    }),
    lastTurnProcessed: null,
    msPerTurn: HOUR,
    ...over,
  };
}

describe("clock", () => {
  it("honors the pre-iteration offset on the calendar", () => {
    expect(dateOfTurn(1329, clock())).toEqual({ year: 1979, month: 8 });
    expect(dateOfTurn(10, clock())).toEqual({ year: 1953, month: 0 });
  });

  it("maps wall-clock dates through observed turns, so a pause does not skew them", () => {
    const c = clock();
    // Turn 600 happened 600h + 240h after T0.
    expect(turnOfDate(new Date(T0 + 840 * HOUR + 60_000), c)).toBe(600);
    // A fixed hour-per-turn conversion would have said 840.
  });

  it("falls back to the last-turn anchor without a timeline", () => {
    const c = clock({ turnTimeline: [], lastTurnProcessed: new Date(T0 + 1329 * HOUR) });
    expect(turnOfDate(new Date(T0 + 1300 * HOUR), c)).toBe(1300);
  });
});

describe("buildActivity", () => {
  it("bins a life into at most MAX_BINS and finds the streak and busiest stretch", () => {
    const perTurn = new Map<number, number>();
    for (let t = 100; t <= 140; t++) perTurn.set(t, 2); // 41-turn streak
    perTurn.set(900, 50);
    const a = buildActivity(perTurn, 50, clock())!;
    expect(a.bins.length).toBeLessThanOrEqual(MAX_BINS);
    expect(a.bins.reduce((s, n) => s + n, 0)).toBe(41 * 2 + 50);
    expect(a.activeTurns).toBe(42);
    expect(a.longestStreak).toBe(41);
    expect(a.busiest?.actions).toBe(50);
  });

  it("returns null with no actions", () => {
    expect(buildActivity(new Map(), 1, clock())).toBeNull();
  });
});

describe("buildCareer", () => {
  const at = (turn: number) => new Date(T0 + turn * HOUR + (turn > 500 ? 240 * HOUR : 0) + 1000);
  const ev = (o: Partial<CareerEvent>): CareerEvent =>
    ({ type: "elected", officeLabel: "x", ...o }) as CareerEvent;

  it("records only first-time steps up the ladder", () => {
    const history = [
      ev({
        type: "elected",
        office: { type: "volkskammerDeputy" },
        officeLabel: "Deputy (BE)",
        date: at(60),
      }),
      ev({
        type: "appointed",
        office: { type: "generalSecretary" },
        officeLabel: "General Secretary",
        date: at(90),
      }),
      ev({
        type: "elected",
        office: { type: "volkskammerDeputy" },
        officeLabel: "Deputy (BE)",
        date: at(700),
      }),
    ];
    const { climb, marks } = buildCareer(history, clock(), new Map());
    expect(climb.map((s) => s.label)).toEqual(["Deputy (BE)", "General Secretary"]);
    expect(climb[1].rank).toBe(8);
    expect(climb[1].turn).toBe(90);
    expect(marks.map((m) => m.kind)).toEqual(["won", "appointed", "won"]);
    expect(marks[2].turn).toBe(700);
  });

  it("prefers the election's end turn over the event timestamp", () => {
    const history = [
      ev({
        type: "elected",
        office: { type: "house", state: "OH", seatsHeld: 1 },
        electionId: "e1" as never,
        date: at(60),
      }),
    ];
    const { climb } = buildCareer(history, clock(), new Map([["e1", 72]]));
    expect(climb[0].turn).toBe(72);
  });
});

describe("buildRaces", () => {
  const cand = (id: string, name: string, votes: number, share: number, isNPP = false) => ({
    id,
    name,
    partyName: name === "Me" ? "Labour" : "Tory",
    partyColor: "#123456",
    isNPP,
    totalVotes: votes,
    voteSharePct: share,
  });
  const race = (o: Partial<RaceInput> & { candidates: RaceInput["candidates"] }): RaceInput => ({
    electionId: Math.random().toString(),
    candidateId: "me",
    label: "Seat",
    year: 1960,
    turn: 100,
    region: "OH",
    seats: 1,
    isPresidential: false,
    careerWon: null,
    ...o,
  });

  it("picks best win, closest race, first win and a repeat rival", () => {
    const identity = new Map([
      ["r1", "rivalChar"],
      ["r2", "rivalChar"],
      ["r3", "rivalChar"],
    ]);
    const races = buildRaces(
      [
        race({
          turn: 100,
          label: "A",
          candidates: [cand("me", "Me", 600, 60), cand("r1", "Rival", 400, 40)],
        }),
        race({
          turn: 200,
          label: "B",
          candidates: [cand("me", "Me", 501, 50.05), cand("r2", "Rival", 500, 49.95)],
        }),
        race({
          turn: 300,
          label: "C",
          region: "PA",
          candidates: [cand("me", "Me", 300, 30), cand("r3", "Rival", 700, 70)],
        }),
        race({
          turn: 400,
          label: "D",
          candidates: [cand("me", "Me", 900, 90), cand("n1", "Npc", 100, 10, true)],
        }),
      ],
      identity
    )!;
    expect(races.contested).toBe(4);
    expect(races.totalVotes).toBe(600 + 501 + 300 + 900);
    expect(races.bestWin?.label).toBe("D");
    expect(races.closest?.label).toBe("B");
    expect(races.closest?.marginVotes).toBe(1);
    expect(races.firstWin?.label).toBe("A");
    expect(races.winsByRegion).toEqual({ OH: 3 });
    expect(races.rival).toMatchObject({ name: "Rival", meetings: 3, ahead: 2, behind: 1 });
    expect(races.rival?.history[0].label).toBe("C");
  });

  it("trusts career history for the outcome and keeps you in the shown field", () => {
    const field = [
      cand("a", "A", 900, 30),
      cand("b", "B", 800, 27),
      cand("c", "C", 700, 23),
      cand("d", "D", 500, 17),
      cand("me", "Me", 100, 3),
    ];
    const races = buildRaces([race({ seats: 5, careerWon: true, candidates: field })], new Map())!;
    expect(races.firstWin?.field.some((f) => f.isYou)).toBe(true);
    expect(races.firstWin?.field).toHaveLength(4);
    // Multi-seat races never become the best win or the closest race.
    expect(races.bestWin).toBeNull();
    expect(races.closest).toBeNull();
  });

  it("returns null with no races", () => {
    expect(buildRaces([], new Map())).toBeNull();
  });
});

describe("buildLegislation", () => {
  const partyOf = (k: string) => (k.startsWith("tory") ? "UK:2" : "UK:1");
  const bill = (o: Partial<BillVoteRow>): BillVoteRow => ({
    title: "Act",
    passed: true,
    failedOnFloor: false,
    year: 1960,
    sponsorId: null,
    chambers: [],
    ...o,
  });

  it("counts votes, party loyalty and decisive votes", () => {
    const bills: BillVoteRow[] = [];
    for (let i = 0; i < 6; i++) {
      bills.push(
        bill({
          title: `Bill ${i}`,
          chambers: [
            {
              votes: {
                me: i === 0 ? "against" : "for",
                lab1: "for",
                lab2: "for",
                tory1: "against",
              },
              weights: {},
              totals: { for: 30, against: 10, abstain: 0 },
            },
          ],
        })
      );
    }
    bills.push(
      bill({
        title: "Close Act",
        sponsorId: "me",
        chambers: [
          {
            votes: { me: "for", lab1: "for", tory1: "against" },
            weights: { me: 13, lab1: 40, tory1: 50 },
            totals: { for: 53, against: 50, abstain: 0 },
          },
        ],
      })
    );
    const leg = buildLegislation("me", bills, partyOf)!;
    expect(leg.votesCast).toBe(7);
    expect(leg.votedAgainst).toBe(1);
    expect(leg.partyLoyaltyPct).toBeCloseTo((6 / 7) * 100);
    expect(leg.decisive.map((d) => d.title)).toEqual(["Close Act"]);
    expect(leg.signature).toMatchObject({ title: "Close Act", passed: true, for: 53, against: 50 });
  });

  it("returns null for a character who never voted or sponsored", () => {
    expect(buildLegislation("me", [bill({})], partyOf)).toBeNull();
  });
});

describe("buildWealth", () => {
  it("bins the series and records the peak", () => {
    const rows: Array<[number, number]> = Array.from({ length: 300 }, (_, i) => [
      100 + i * 4,
      i === 150 ? 9000 : 1000 + i,
    ]);
    const w = buildWealth(rows, clock())!;
    expect(w.points.length).toBeLessThanOrEqual(MAX_BINS);
    expect(w.peak?.value).toBe(9000);
  });

  it("returns null for a flat or single-point series", () => {
    expect(buildWealth([[1, 5]], clock())).toBeNull();
    expect(
      buildWealth(
        [
          [1, 5],
          [9, 5],
        ],
        clock()
      )
    ).toBeNull();
  });
});
