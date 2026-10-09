import type {
  ElectionResultsResponse,
  PresidentialNight,
  PresidentialNightStatus,
  ResultsCandidate,
  ResultsUnit,
} from "@/lib/elections/liveResults/types";

export const CAND_A = "cand-a";
export const CAND_B = "cand-b";
/** A vote total that must never reach the screen for a state that has not reported. */
export const POISON_VOTES = 987_654_321;

export const candidates: ResultsCandidate[] = [
  {
    id: CAND_A,
    name: "Alex Morrow",
    party: "p1",
    partyName: "Unity Party",
    partyColor: "#3B82F6",
    isNPP: false,
    totalVotes: 1_200_000,
    voteSharePct: 52,
    electoralVotes: 0,
  },
  {
    id: CAND_B,
    name: "Jordan Blake",
    party: "p2",
    partyName: "Heritage Alliance",
    partyColor: "#EF4444",
    isNPP: false,
    totalVotes: 1_100_000,
    voteSharePct: 48,
    electoralVotes: 0,
  },
];

export function unit(
  id: string,
  name: string,
  weight: number,
  nightStatus: PresidentialNightStatus,
  extra: Partial<ResultsUnit> = {}
): ResultsUnit {
  const hasNumbers =
    nightStatus === "leaning" || nightStatus === "too_close" || nightStatus === "called";
  return {
    id,
    name,
    weight,
    totalVotes: hasNumbers ? 500_000 : 0,
    reportingPct: nightStatus === "polls_open" ? 0 : hasNumbers ? 60 : 4,
    called: nightStatus === "called",
    calledFor: nightStatus === "called" ? CAND_A : undefined,
    leaderId: hasNumbers ? CAND_A : undefined,
    tied: false,
    leaderMargin: hasNumbers ? 40_000 : 0,
    leaderMarginPct: hasNumbers ? (nightStatus === "too_close" ? 1.2 : 8) : 0,
    candidates: hasNumbers
      ? [
          { candidateId: CAND_A, votes: 270_000, voteShare: 54 },
          { candidateId: CAND_B, votes: 230_000, voteShare: 46 },
        ]
      : [],
    pollsCloseAt: "2026-10-08T05:30:00.000Z",
    nightStatus,
    ...extra,
  };
}

export const WINDOW_START = "2026-10-08T05:00:00.000Z";
export const WINDOW_END = "2026-10-08T06:00:00.000Z";

export function nightFixture(over: Partial<PresidentialNight> = {}): ElectionResultsResponse {
  const units = [
    unit("GA", "Georgia", 16, "called"),
    unit("PA", "Pennsylvania", 19, "leaning"),
    unit("NV", "Nevada", 6, "too_close"),
    // Defence in depth: a payload that carried numbers for these must not show them.
    unit("OH", "Ohio", 17, "too_early", {
      totalVotes: POISON_VOTES,
      leaderId: CAND_B,
      candidates: [{ candidateId: CAND_B, votes: POISON_VOTES, voteShare: 99 }],
    }),
    unit("TX", "Texas", 40, "polls_open", {
      totalVotes: POISON_VOTES,
      leaderId: CAND_B,
      candidates: [{ candidateId: CAND_B, votes: POISON_VOTES, voteShare: 99 }],
    }),
    unit("CA", "California", 54, "polls_open"),
  ];
  const night: PresidentialNight = {
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    totalEv: 538,
    evNeeded: 270,
    calledEv: { [CAND_A]: 16 },
    statesCalled: 1,
    totalStates: units.length,
    statesPollsClosed: 4,
    nextClose: { at: "2026-10-08T05:40:00.000Z", stateIds: ["TX"] },
    feed: [
      { at: "2026-10-08T05:05:00.000Z", stateId: "GA", kind: "polls_close" },
      { at: "2026-10-08T05:20:00.000Z", stateId: "GA", kind: "call", candidateId: CAND_A },
    ],
    ...over,
  };
  return {
    election: {
      id: "e1",
      countryId: "US",
      electionType: "president",
      state: "US",
      status: "active",
      cycle: 1,
      electionYear: 2028,
      currentTurn: 35,
      startTurn: 1,
      endTurn: 36,
      totalSeats: 0,
      totalEv: 538,
      evNeeded: 270,
      finalHour: { progress: 0.4, endsAt: WINDOW_END },
      night,
    },
    candidates: candidates.map((c) =>
      c.id === CAND_A ? { ...c, electoralVotes: 16 } : { ...c, electoralVotes: 0 }
    ),
    units,
    national: null,
    summary: {
      totalVotes: 2_300_000,
      unitsReporting: 3,
      totalUnits: units.length,
      unitsCalled: 1,
      projectedWinner: null,
    },
    isAdmin: false,
    lastUpdated: "2026-10-08T05:24:00.000Z",
  };
}

/** The same race after resolution: no night, every state called, 100% reporting. */
export function settledFixture(winner: string | null = CAND_A): ElectionResultsResponse {
  const base = nightFixture();
  const units = base.units.map((u) =>
    unit(u.id, u.name, u.weight, "called", {
      nightStatus: undefined,
      reportingPct: 100,
      calledFor: winner ?? CAND_A,
    })
  );
  return {
    ...base,
    election: { ...base.election, status: "resolved", finalHour: null, night: null },
    candidates: base.candidates.map((c) => ({
      ...c,
      electoralVotes: winner == null ? 250 : c.id === winner ? 300 : 238,
    })),
    units,
    summary: { ...base.summary, unitsCalled: units.length, projectedWinner: winner },
  };
}
