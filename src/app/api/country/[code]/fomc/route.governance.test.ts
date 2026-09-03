/**
 * Contract tests for the `governance` object on GET /api/country/[code]/fomc.
 *
 * Five states: open (no meeting, cadence due), voting (ballots open),
 * awaiting resolution (viewer already voted, meeting still open), resolved
 * (history only), and ineligible (viewer holds no seat; non-committee bank).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockGetCentralBankScope = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: () => mockRequireAuth(),
}));
vi.mock("@/lib/centralBank/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/centralBank/helpers")>();
  return { ...actual, getCentralBankScope: () => mockGetCentralBankScope() };
});
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));

import { GET } from "./route";

const VIEWER_ID = new ObjectId();

function seat(i: number): Record<string, unknown> {
  return {
    seatId: `seat-${i + 1}`,
    isChair: i === 0,
    occupantType: i === 1 ? "player" : "npp",
    characterId: i === 1 ? VIEWER_ID : null,
    characterName: i === 1 ? "Voter" : `Governor ${i + 1}`,
    nppId: i === 1 ? null : new ObjectId(),
    alignment: "hawk",
    appointedByPresidentId: null,
    appointedAtTurn: 100,
    termExpiresAtTurn: 900,
  };
}

function votingMeeting(ballots: Array<{ seatId: string; vote: string }> = []) {
  return {
    meetingId: new ObjectId().toHexString(),
    openedAtTurn: 381,
    openedAt: new Date(),
    motion: "hike",
    proposedDelta: 0.5,
    status: "voting",
    ballots: ballots.map((b) => ({ ...b, auto: false, castAt: new Date() })),
    playerVoteDeadline: new Date(Date.now() + 3600_000),
    resolvesOnTurn: 405,
  };
}

function bankFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "US",
    countryId: "US",
    chairCharacterId: null,
    primeRate: 4,
    rateHistory: [],
    chairInfamy: 0,
    fomcBoard: Array.from({ length: 7 }, (_, i) => seat(i)),
    fomcTermStartedAtTurn: 192,
    lastFomcMeetingTurn: 380,
    rateChangesThisTerm: 2,
    activeFomcMeeting: null,
    fomcMeetingHistory: [],
    ...overrides,
  };
}

function dbWith(bank: Record<string, unknown> | null) {
  return {
    collection: (name: string) => ({
      findOne: async () => {
        if (name === "centralBanks") return bank;
        if (name === "gameState") return { _id: "current", currentTurn: 381 };
        return null;
      },
      find: () => ({ sort: () => ({ toArray: async () => [] }), toArray: async () => [] }),
    }),
  };
}

function actionOf(
  body: { governance: { allowedActions: Array<{ action: string }> } },
  action: string
) {
  return body.governance.allowedActions.find((a) => a.action === action) as {
    action: string;
    allowed: boolean;
    reason?: string;
    deadlineTurn?: number;
  };
}

describe("GET /api/country/[code]/fomc governance contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: {
        isAdmin: false,
        character: { _id: VIEWER_ID, countryId: "US", currentOffice: null },
      },
    });
    mockGetCentralBankScope.mockResolvedValue({ bankId: "US", memberCountries: ["US"] });
    mockGetCurrentTurn.mockResolvedValue(381);
  });

  it("open: no meeting, cadence deadline, ballot refused, rate by committee", async () => {
    mockGetDb.mockResolvedValue(dbWith(bankFixture()));
    const res = await GET(new Request("http://localhost/api/country/US/fomc"), {
      params: Promise.resolve({ code: "US" }),
    });
    const body = await res.json();
    expect(body.governance.institutionId).toBe("US");
    expect(body.governance.memberCountryIds).toContain("US");
    expect(body.governance.viewerRole).toBe("member");
    expect(body.governance.nextDeadline).toEqual({ turn: 388, kind: "cadence" });
    expect(actionOf(body, "open_meeting").allowed).toBe(true);
    const ballot = actionOf(body, "cast_ballot");
    expect(ballot.allowed).toBe(false);
    expect(ballot.reason).toBeTruthy();
    const setRate = actionOf(body, "set_rate");
    expect(setRate.allowed).toBe(false);
    expect(setRate.reason).toMatch(/committee/i);
    expect(body.governance.normalizedRateChoices.length).toBeGreaterThan(0);
    expect(body.governance.primeRateOnGrid).toBe(4);
  });

  it("voting: seated viewer may ballot with a deadline", async () => {
    mockGetDb.mockResolvedValue(dbWith(bankFixture({ activeFomcMeeting: votingMeeting() })));
    const res = await GET(new Request("http://localhost/api/country/US/fomc"), {
      params: Promise.resolve({ code: "US" }),
    });
    const body = await res.json();
    const ballot = actionOf(body, "cast_ballot");
    expect(ballot.allowed).toBe(true);
    expect(ballot.deadlineTurn).toBe(405);
    expect(body.governance.nextDeadline).toEqual({ turn: 405, kind: "meeting_deadline" });
  });

  it("awaiting resolution: viewer who already voted cannot vote again", async () => {
    mockGetDb.mockResolvedValue(
      dbWith(
        bankFixture({ activeFomcMeeting: votingMeeting([{ seatId: "seat-2", vote: "hike" }]) })
      )
    );
    const res = await GET(new Request("http://localhost/api/country/US/fomc"), {
      params: Promise.resolve({ code: "US" }),
    });
    const body = await res.json();
    const ballot = actionOf(body, "cast_ballot");
    expect(ballot.allowed).toBe(false);
    expect(ballot.reason).toMatch(/already voted/i);
    expect(body.governance.nextDeadline).toEqual({ turn: 405, kind: "meeting_deadline" });
  });

  it("resolved: no active meeting, cadence deadline again", async () => {
    mockGetDb.mockResolvedValue(
      dbWith(
        bankFixture({
          activeFomcMeeting: null,
          lastFomcMeetingTurn: 381,
          fomcMeetingHistory: [
            {
              meetingId: new ObjectId().toHexString(),
              openedAtTurn: 381,
              openedAt: new Date(),
              motion: "hike",
              proposedDelta: 0.5,
              status: "resolved",
              ballots: [],
              playerVoteDeadline: new Date(),
              resolvesOnTurn: 405,
              result: "passed",
              resolvedAt: new Date(),
              resolvedAtTurn: 382,
            },
          ],
        })
      )
    );
    const res = await GET(new Request("http://localhost/api/country/US/fomc"), {
      params: Promise.resolve({ code: "US" }),
    });
    const body = await res.json();
    expect(body.meeting).toBeNull();
    expect(actionOf(body, "cast_ballot").allowed).toBe(false);
    expect(body.governance.nextDeadline).toEqual({ turn: 389, kind: "cadence" });
  });

  it("ineligible: viewer with no seat cannot ballot", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: {
        isAdmin: false,
        character: { _id: new ObjectId(), countryId: "US", currentOffice: null },
      },
    });
    mockGetDb.mockResolvedValue(dbWith(bankFixture({ activeFomcMeeting: votingMeeting() })));
    const res = await GET(new Request("http://localhost/api/country/US/fomc"), {
      params: Promise.resolve({ code: "US" }),
    });
    const body = await res.json();
    expect(body.governance.viewerRole).toBe("outsider");
    const ballot = actionOf(body, "cast_ballot");
    expect(ballot.allowed).toBe(false);
    expect(ballot.reason).toMatch(/seated/i);
  });

  it("ineligible: non-committee bank exposes no governance", async () => {
    mockGetDb.mockResolvedValue(dbWith(null));
    const res = await GET(new Request("http://localhost/api/country/US/fomc"), {
      params: Promise.resolve({ code: "US" }),
    });
    const body = await res.json();
    expect(body.hasCommittee).toBe(false);
    expect(body.governance).toBeNull();
  });
});
