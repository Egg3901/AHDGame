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
  return {
    ...actual,
    getCentralBankScope: () => mockGetCentralBankScope(),
  };
});
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));

import { GET } from "./route";

function seat(i: number): Record<string, unknown> {
  return {
    seatId: `seat-${i + 1}`,
    isChair: i === 0,
    occupantType: i < 6 ? "npp" : "vacant",
    characterId: null,
    characterName: i < 6 ? `Governor ${i + 1}` : null,
    nppId: null,
    alignment: i % 2 === 0 ? "hawk" : "dove",
    appointedByPresidentId: null,
    appointedAtTurn: 100,
    termExpiresAtTurn: 500,
  };
}

function resolvedMeeting(turn: number, passed: boolean): Record<string, unknown> {
  const votes = passed ? ["hike", "hike", "hike", "hike"] : ["cut", "cut", "hold", "hold"];
  return {
    meetingId: new ObjectId().toHexString(),
    openedAtTurn: turn,
    openedAt: new Date(Date.UTC(2026, 0, 1)),
    motion: passed ? "hike" : "cut",
    proposedDelta: passed ? 0.5 : -0.25,
    status: "resolved",
    ballots: votes.map((vote, i) => ({
      seatId: `seat-${i + 1}`,
      vote,
      auto: true,
      castAt: new Date(Date.UTC(2026, 0, 1)),
    })),
    playerVoteDeadline: new Date(Date.UTC(2026, 0, 2)),
    resolvesOnTurn: turn + 24,
    result: passed ? "passed" : "failed",
    resolvedAt: new Date(Date.UTC(2026, 0, 2)),
    resolvedAtTurn: turn + 1,
  };
}

function bankFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "US",
    primeRate: 3.65,
    rateChangesThisTerm: 16,
    fomcBoard: Array.from({ length: 7 }, (_, i) => seat(i)),
    fomcTermStartedAtTurn: 192,
    lastFomcMeetingTurn: 380,
    lastRateChangeTurn: 380,
    activeFomcMeeting: null,
    fomcMeetingHistory: [
      resolvedMeeting(364, true),
      resolvedMeeting(372, false),
      resolvedMeeting(380, true),
    ],
    ...overrides,
  };
}

function dbWith(bank: Record<string, unknown> | null) {
  return {
    collection: (name: string) => ({
      findOne: async (filter: Record<string, unknown>) => {
        if (name === "centralBanks") return bank;
        if (name === "gameState") return { _id: "current", currentTurn: 381 };
        if (name === "npps") return null;
        void filter;
        return null;
      },
      find: () => ({ sort: () => ({ toArray: async () => [] }), toArray: async () => [] }),
    }),
  };
}

function routeContext() {
  const params = Promise.resolve({ code: "US" });
  const req = new Request("http://localhost/api/country/US/fomc");
  return { req, ctx: { params } };
}

describe("GET /api/country/[code]/fomc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { character: { _id: new ObjectId(), countryId: "US", currentOffice: null } },
    });
    mockGetCentralBankScope.mockResolvedValue({ bankId: "US", memberCountries: ["US"] });
    mockGetCurrentTurn.mockResolvedValue(381);
  });

  it("reports hasCommittee false when the bank has no board", async () => {
    mockGetDb.mockResolvedValue(dbWith(null));
    const { req, ctx } = routeContext();
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).hasCommittee).toBe(false);
  });

  it("exposes scheduling context, term window, and per-meeting tallies", async () => {
    mockGetDb.mockResolvedValue(dbWith(bankFixture()));
    const { req, ctx } = routeContext();
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.currentTurn).toBe(381);
    // No active meeting, last met on turn 380, cadence every 8 turns.
    expect(body.nextMeetingAtTurn).toBe(388);
    // Term started at turn 192 and runs 192 turns.
    expect(body.termEndsAtTurn).toBe(384);
    // Majority of the full 7-seat board (ticket #1238: the understaffed-board
    // banner reads this instead of re-deriving the threshold client-side).
    expect(body.majorityNeeded).toBe(4);

    expect(body.meetingHistory).toHaveLength(3);
    // Newest-last storage order preserved; client renders newest first.
    expect(body.meetingHistory.map((m: { openedAtTurn: number }) => m.openedAtTurn)).toEqual([
      364, 372, 380,
    ]);
    const carried = body.meetingHistory[0];
    expect(carried.result).toBe("passed");
    expect(carried.agree).toBe(4);
    expect(carried.disagree).toBe(0);
    expect(carried.abstain).toBe(3); // vacant seats abstain against

    const failed = body.meetingHistory[1];
    expect(failed.result).toBe("failed");
    // Motion was cut; two cut ballots agree, two hold ballots count against.
    expect(failed.agree).toBe(2);
    expect(failed.disagree).toBe(2);
  });

  it("does not advertise a next session while one is active", async () => {
    const bank = bankFixture({
      activeFomcMeeting: {
        meetingId: new ObjectId().toHexString(),
        openedAtTurn: 381,
        openedAt: new Date(),
        motion: "hold",
        proposedDelta: 0,
        status: "voting",
        ballots: [],
        playerVoteDeadline: new Date(Date.now() + 3600_000),
        resolvesOnTurn: 405,
      },
    });
    mockGetDb.mockResolvedValue(dbWith(bank));
    const { req, ctx } = routeContext();
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.nextMeetingAtTurn).toBeNull();
    expect(body.meeting.agree).toBe(0);
    expect(body.meeting.disagree).toBe(0);
    expect(body.meeting.needed).toBe(4);
  });

  it("caps meeting history at 10 sessions", async () => {
    const longHistory = Array.from({ length: 24 }, (_, i) => resolvedMeeting(100 + i * 8, true));
    mockGetDb.mockResolvedValue(dbWith(bankFixture({ fomcMeetingHistory: longHistory })));
    const { req, ctx } = routeContext();
    const res = await GET(req, ctx);
    const body = await res.json();
    expect(body.meetingHistory).toHaveLength(10);
    // 24 meetings at turns 100..284; the last 10 survive, newest last.
    expect(body.meetingHistory[9].openedAtTurn).toBe(284);
  });

  it("returns 404 for an unknown country code", async () => {
    mockGetDb.mockResolvedValue(dbWith(bankFixture()));
    const params = Promise.resolve({ code: "XX" });
    const res = await GET(new Request("http://localhost/api/country/XX/fomc"), { params });
    expect(res.status).toBe(404);
  });
});
