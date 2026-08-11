import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
const mockRequireAdmin = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockGetRegimeColl = vi.fn();
const mockRegimeFindOne = vi.fn();
const mockRegimeFindOneAndUpdate = vi.fn();
const mockGetHog = vi.fn();
const mockOfferDecision = vi.fn();
const mockFireFactionSplit = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));
vi.mock("@/lib/db/collections/regimeEscalation", () => ({
  getRegimeEscalationCollection: (...args: unknown[]) => mockGetRegimeColl(...args),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: (...args: unknown[]) => mockGetHog(...args),
}));
vi.mock("@/lib/onePartyState/decisionQueue", () => ({
  offerDecision: (...args: unknown[]) => mockOfferDecision(...args),
}));
vi.mock("@/lib/onePartyState/factionSplit", () => ({
  fireFactionSplit: (...args: unknown[]) => mockFireFactionSplit(...args),
}));

import { POST } from "./route";

function request(body: unknown = { toStage: "discontent" }): Request {
  return new Request("http://localhost/api/admin/country/CN/regime/force-stage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/country/[code]/regime/force-stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      admin: {
        userId: "u1",
        username: "root",
        email: "root@example.com",
        role: "admin",
        isAdmin: true,
      },
    });
    mockGetCurrentTurn.mockResolvedValue(500);
    mockGetRegimeColl.mockReturnValue({
      findOne: mockRegimeFindOne,
      findOneAndUpdate: mockRegimeFindOneAndUpdate,
    });
    mockRegimeFindOne.mockResolvedValue({ currentStage: "stable", transitionHistory: [] });
    mockRegimeFindOneAndUpdate.mockResolvedValue(null);
    mockGetHog.mockResolvedValue(null);
    mockOfferDecision.mockResolvedValue(undefined);
    mockFireFactionSplit.mockResolvedValue(null);
  });

  it("returns 403 when caller is not admin", async () => {
    mockRequireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const res = await POST(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(403);
  });

  it("returns 400 for an invalid country", async () => {
    const res = await POST(request(), { params: Promise.resolve({ code: "XX" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid toStage", async () => {
    const res = await POST(request({ toStage: "bogus" }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(400);
  });

  it("writes the new stage, resets dwell counters, and stamps an admin-tagged transition", async () => {
    const res = await POST(request({ toStage: "internalChallenge" }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(200);

    const updates = mockRegimeFindOneAndUpdate.mock.calls[0];
    const set = (
      updates[1] as {
        $set: {
          currentStage: string;
          dwellCounters: { stage1: number; stage4: number };
          transitionHistory: { reason: string; from: string; to: string }[];
        };
      }
    ).$set;
    expect(set.currentStage).toBe("internalChallenge");
    expect(set.dwellCounters.stage1).toBe(0);
    expect(set.dwellCounters.stage4).toBe(0);
    expect(set.transitionHistory[0].reason).toMatch(/admin override/);
    expect(set.transitionHistory[0].from).toBe("stable");
    expect(set.transitionHistory[0].to).toBe("internalChallenge");
  });

  it("offers the matching stage decision when a head-of-government is resolvable", async () => {
    const { ObjectId } = await import("mongodb");
    const hogId = new ObjectId();
    mockGetHog.mockResolvedValue(hogId);
    mockFireFactionSplit.mockResolvedValue({
      newPartySequentialId: 9,
      defectorCount: 4,
      defectorCharacterIds: [],
    });
    const res = await POST(request({ toStage: "internalChallenge" }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(200);
    expect(mockFireFactionSplit).toHaveBeenCalledTimes(1);
    expect(mockOfferDecision).toHaveBeenCalledTimes(1);
    const [, , offer] = mockOfferDecision.mock.calls[0] as [
      unknown,
      string,
      {
        kind: string;
        leaderCharacterId: unknown;
        payload: { defectedPartySequentialId?: number; defectorCount?: number };
      },
    ];
    expect(offer.kind).toBe("stage3.respondToFactionSplit");
    expect(offer.leaderCharacterId).toBe(hogId);
    expect(offer.payload.defectedPartySequentialId).toBe(9);
    expect(offer.payload.defectorCount).toBe(4);
  });

  it("force-stage to 'collapse' offers the stage-4 decision (no faction split)", async () => {
    const { ObjectId } = await import("mongodb");
    mockGetHog.mockResolvedValue(new ObjectId());
    const res = await POST(request({ toStage: "collapse" }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(200);
    expect(mockFireFactionSplit).not.toHaveBeenCalled();
    expect(mockOfferDecision).toHaveBeenCalledTimes(1);
    const [, , offer] = mockOfferDecision.mock.calls[0] as [unknown, string, { kind: string }];
    expect(offer.kind).toBe("stage4.faceCollapse");
  });

  it("force-stage to 'stable' does not offer a decision", async () => {
    const { ObjectId } = await import("mongodb");
    mockGetHog.mockResolvedValue(new ObjectId());
    mockRegimeFindOne.mockResolvedValue({
      currentStage: "discontent",
      transitionHistory: [],
    });
    await POST(request({ toStage: "stable" }), { params: Promise.resolve({ code: "CN" }) });
    expect(mockOfferDecision).not.toHaveBeenCalled();
  });

  it("re-issuing the same stage refreshes the offer (QA convenience)", async () => {
    const { ObjectId } = await import("mongodb");
    mockGetHog.mockResolvedValue(new ObjectId());
    mockRegimeFindOne.mockResolvedValue({
      currentStage: "collapse",
      transitionHistory: [],
    });
    await POST(request({ toStage: "collapse" }), { params: Promise.resolve({ code: "CN" }) });
    expect(mockOfferDecision).toHaveBeenCalledTimes(1);
    const [, , offer] = mockOfferDecision.mock.calls[0] as [unknown, string, { kind: string }];
    expect(offer.kind).toBe("stage4.faceCollapse");
  });

  it("clears existing activeDecision + decisionQueue so the fresh offer lands on active slot", async () => {
    const { ObjectId } = await import("mongodb");
    mockGetHog.mockResolvedValue(new ObjectId());
    const res = await POST(request({ toStage: "discontent" }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(200);
    const set = (
      mockRegimeFindOneAndUpdate.mock.calls[0][1] as {
        $set: { activeDecision: unknown; decisionQueue: unknown[] };
      }
    ).$set;
    expect(set.activeDecision).toBeNull();
    expect(set.decisionQueue).toEqual([]);
  });

  it("skips the decision-offer when no head-of-government can be resolved", async () => {
    mockGetHog.mockResolvedValue(null);
    await POST(request({ toStage: "discontent" }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(mockOfferDecision).not.toHaveBeenCalled();
  });
});
