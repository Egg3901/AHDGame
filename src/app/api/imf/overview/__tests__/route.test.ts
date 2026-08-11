import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));
vi.mock("@/lib/imf/resolveImfCorporation", () => ({
  getImfCorporation: vi.fn(),
}));
// Turn-first override-window filter calls getCurrentTurn; fixtures use realtimeMs
// windows (no .turn) so the route falls back to the wall-clock filter here.
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: vi.fn(async () => 0),
}));

import { GET } from "../route";
import { requireAuth } from "@/lib/api/requireAuth";
import { getDb } from "@/lib/mongodb";
import { getImfCorporation } from "@/lib/imf/resolveImfCorporation";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/imf/overview", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response("nope", { status: 401 }),
    } as never);
    const res = await GET(new Request("http://test/api/imf/overview"));
    expect(res.status).toBe(401);
  });

  it("200 with imfCorp null when corp is missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: {} } as never);
    vi.mocked(getDb).mockResolvedValue({} as never);
    vi.mocked(getImfCorporation).mockResolvedValue(null);
    const res = await GET(new Request("http://test/api/imf/overview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imfCorp).toBeNull();
    expect(body.boardMembers).toEqual([]);
    expect(body.activeSovereignBailouts).toEqual([]);
    expect(body.pendingBoardOverrides).toEqual([]);
  });

  it("200 returns IMF corp + board members + bailouts + overrides", async () => {
    const charId = new ObjectId();
    const imfId = new ObjectId();
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: {} } as never);
    vi.mocked(getImfCorporation).mockResolvedValue({
      _id: imfId,
      liquidCapital: 5_000_000_000,
      liquidCurrencyCode: "USD",
      shareholders: [{ characterId: charId, shares: 50 }],
    } as never);

    const charactersFind = vi.fn().mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, name: "Admin Alex" }]),
      }),
    });
    const budgetsFind = vi.fn().mockImplementation((filter: Record<string, unknown>) => ({
      toArray: vi.fn().mockResolvedValue(
        filter.imfSovereignBailoutActive
          ? [
              {
                _id: "federal",
                countryId: "US",
                imfSovereignFacilityPrincipalOutstanding: 2_000_000_000_000,
                imfSovereignFacilityAnnualRate: 6,
                imfSovereignFacilityAmortizationTurnsRemaining: 240,
                imfSovereignFacilityIncomeCaptureFraction: 0.2,
                crisisChoice: "bailout",
                recoveryStartedAt: { turn: 600 },
              },
            ]
          : [
              {
                _id: "JP",
                countryId: "JP",
                imfBoardOverrideWindowEndAt: { realtimeMs: Date.now() + 3_600_000 },
                imfBoardOverrideAt: null,
                imfSovereignFacilityPrincipalOutstanding: 1_000_000_000_000,
                imfSovereignFacilityAnnualRate: 6,
                imfSovereignFacilityIncomeCaptureFraction: 0.2,
                crisisChoice: "bailout",
              },
            ]
      ),
    }));

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn((name: string) => {
        if (name === "characters") return { find: charactersFind };
        if (name === "federalBudget") return { find: budgetsFind };
        throw new Error(`unexpected: ${name}`);
      }),
    } as never);

    const res = await GET(new Request("http://test/api/imf/overview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imfCorp).toEqual({
      id: imfId.toString(),
      sequentialId: null,
      liquidCapital: 5_000_000_000,
      liquidCurrencyCode: "USD",
    });
    expect(body.boardMembers).toEqual([
      { characterId: charId.toString(), name: "Admin Alex", sequentialId: null },
    ]);
    expect(body.activeSovereignBailouts).toHaveLength(1);
    expect(body.activeSovereignBailouts[0].countryCode).toBe("US");
    expect(body.pendingBoardOverrides).toHaveLength(1);
    expect(body.pendingBoardOverrides[0].countryCode).toBe("JP");
  });
});
