import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/lib/imf/resolveImfCorporation", () => ({
  getImfCorporation: vi.fn(),
}));
vi.mock("@/lib/sovereignDefault/sideEffects/trustHit", () => ({
  applyCrossCountryTrustHit: vi.fn().mockResolvedValue({ statesUpdated: 0 }),
}));
vi.mock("@/lib/sovereignDefault/crisisNews", () => ({
  emitImfBoardStatementNews: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn().mockResolvedValue(700),
}));

import { POST } from "../route";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";
import { applyCrossCountryTrustHit } from "@/lib/sovereignDefault/sideEffects/trustHit";

const BOARD_ID = new ObjectId();
const NON_BOARD_ID = new ObjectId();

function mockReq(body: unknown): Request {
  return new Request("http://test/api/imf/board/override", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockDbWithBudget(budget: Record<string, unknown> | null) {
  const sets: Array<Record<string, unknown>> = [];
  return {
    sets,
    db: {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockResolvedValue(budget),
        updateOne: vi.fn(async (_f, u: Record<string, unknown>) => {
          sets.push(u.$set as Record<string, unknown>);
          return { acknowledged: true, modifiedCount: 1 };
        }),
      })),
    } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/imf/board/override", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response("nope", { status: 401 }),
    } as never);
    const res = await POST(mockReq({ countryCode: "US", action: "endorse" }));
    expect(res.status).toBe(401);
  });

  it("403 when character is not a Board member", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: NON_BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    vi.mocked(getDb).mockResolvedValue({} as never);
    const res = await POST(mockReq({ countryCode: "US", action: "endorse" }));
    expect(res.status).toBe(403);
  });

  it("404 when budget missing", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    const { db } = mockDbWithBudget(null);
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ countryCode: "US", action: "endorse" }));
    expect(res.status).toBe(404);
  });

  it("409 when window already closed (expired)", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    const { db } = mockDbWithBudget({
      _id: "federal",
      countryId: "US",
      imfBoardOverrideAt: null,
      imfBoardOverrideWindowEndAt: { realtimeMs: Date.now() - 1000 },
      imfSovereignFacilityAnnualRate: 6,
      imfSovereignFacilityIncomeCaptureFraction: 0.2,
    });
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ countryCode: "US", action: "endorse" }));
    expect(res.status).toBe(409);
  });

  it("409 when already actioned this window", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    const { db } = mockDbWithBudget({
      _id: "federal",
      countryId: "US",
      imfBoardOverrideAt: { turn: 600, realtimeMs: Date.now() - 1000 },
      imfBoardOverrideWindowEndAt: { realtimeMs: Date.now() + 60000 },
    });
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ countryCode: "US", action: "endorse" }));
    expect(res.status).toBe(409);
  });

  it("200 modify-terms clamps deltas and updates facility fields", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    const { db, sets } = mockDbWithBudget({
      _id: "federal",
      countryId: "US",
      imfBoardOverrideAt: null,
      imfBoardOverrideWindowEndAt: { realtimeMs: Date.now() + 60000 },
      imfSovereignFacilityAnnualRate: 6,
      imfSovereignFacilityIncomeCaptureFraction: 0.2,
    });
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(
      mockReq({
        countryCode: "US",
        action: "modify-terms",
        rateDelta: 5,
        captureDelta: 0.5,
      })
    );
    expect(res.status).toBe(200);
    const set = sets[0];
    expect(set.imfSovereignFacilityAnnualRate).toBeCloseTo(8); // 6 + 2pp clamp
    expect(set.imfSovereignFacilityIncomeCaptureFraction).toBeCloseTo(0.3); // 0.2 + 0.1
    expect(set.imfBoardOverrideKind).toBe("termsModified");
  });

  it("200 endorse applies positive trust delta and stamps statement", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    const { db, sets } = mockDbWithBudget({
      _id: "federal",
      countryId: "US",
      imfBoardOverrideAt: null,
      imfBoardOverrideWindowEndAt: { realtimeMs: Date.now() + 60000 },
    });
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(
      mockReq({ countryCode: "US", action: "endorse", statement: "well-done" })
    );
    expect(res.status).toBe(200);
    expect(sets[0].imfBoardOverrideKind).toBe("publicEndorsement");
    expect(sets[0].imfBoardPublicStatement).toBe("well-done");
    const trustCalls = vi.mocked(applyCrossCountryTrustHit).mock.calls;
    expect(trustCalls).toHaveLength(1);
    expect(trustCalls[0][2]).toBeGreaterThan(0);
  });

  it("409 when concurrent updateOne races (modifiedCount=0)", async () => {
    // Regression: simulates two parallel Board members both passing the
    // in-memory `imfBoardOverrideAt: null` check. The second writer's filter
    // (`{ imfBoardOverrideAt: null }` in updateOne) excludes it and the route
    // returns 409 instead of double-applying the override.
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    const db = {
      collection: vi.fn(() => ({
        findOne: vi.fn().mockResolvedValue({
          _id: "federal",
          countryId: "US",
          imfBoardOverrideAt: null,
          imfBoardOverrideWindowEndAt: { realtimeMs: Date.now() + 60000 },
        }),
        updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 0 }),
      })),
    } as never;
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(mockReq({ countryCode: "US", action: "endorse" }));
    expect(res.status).toBe(409);
    // Regression: the cross-country trust-hit side-effect must NOT fire when
    // the atomic write loses the race. Trust hits are runs only after the
    // updateOne reports modifiedCount > 0.
    expect(applyCrossCountryTrustHit).not.toHaveBeenCalled();
  });

  it("200 criticize applies negative trust delta", async () => {
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: BOARD_ID } },
    } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      shareholders: [{ characterId: BOARD_ID, shares: 50 }],
    } as never);
    const { db, sets } = mockDbWithBudget({
      _id: "federal",
      countryId: "US",
      imfBoardOverrideAt: null,
      imfBoardOverrideWindowEndAt: { realtimeMs: Date.now() + 60000 },
    });
    vi.mocked(getDb).mockResolvedValue(db);
    const res = await POST(
      mockReq({ countryCode: "US", action: "criticize", statement: "needs cuts" })
    );
    expect(res.status).toBe(200);
    expect(sets[0].imfBoardOverrideKind).toBe("publicCriticism");
    const trustCalls = vi.mocked(applyCrossCountryTrustHit).mock.calls;
    expect(trustCalls[0][2]).toBeLessThan(0);
  });
});
