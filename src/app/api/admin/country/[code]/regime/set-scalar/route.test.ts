import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAdmin = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockGetCountryState = vi.fn();
const mockGetLeaderColl = vi.fn();
const mockLeaderFindOne = vi.fn();
const mockGetHog = vi.fn();
const mockAdjustConfidence = vi.fn();
const mockAdjustPopular = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));
vi.mock("@/lib/countryState", () => ({
  getCountryState: (...args: unknown[]) => mockGetCountryState(...args),
}));
vi.mock("@/lib/db/collections/countryLeaderState", () => ({
  getCountryLeaderStatesCollection: (...args: unknown[]) => mockGetLeaderColl(...args),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: (...args: unknown[]) => mockGetHog(...args),
}));
vi.mock("@/lib/turn/rulingPartyConfidence", () => ({
  adjustLeaderConfidence: (...args: unknown[]) => mockAdjustConfidence(...args),
}));
vi.mock("@/lib/turn/popularLegitimacy", () => ({
  adjustPopularLegitimacy: (...args: unknown[]) => mockAdjustPopular(...args),
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/admin/country/CN/regime/set-scalar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/country/[code]/regime/set-scalar", () => {
  const leaderCharId = new ObjectId();

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
    mockGetCountryState.mockResolvedValue({ countryId: "CN", rulingPartyId: 1 });
    mockGetLeaderColl.mockReturnValue({ findOne: mockLeaderFindOne });
    mockGetHog.mockResolvedValue(leaderCharId);
    mockLeaderFindOne.mockResolvedValue({
      leaderCharacterId: leaderCharId,
      popularLegitimacy: 60,
      partyConfidence: 50,
    });
    mockAdjustConfidence.mockResolvedValue(undefined);
    mockAdjustPopular.mockResolvedValue(undefined);
  });

  it("returns 403 for non-admin", async () => {
    mockRequireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    const res = await POST(request({ scalar: "popularLegitimacy", value: 50 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid scalar name", async () => {
    const res = await POST(request({ scalar: "bogus", value: 50 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 only when neither head of government nor leader-state row can be resolved", async () => {
    mockGetHog.mockResolvedValue(null);
    mockLeaderFindOne.mockResolvedValue(null);
    mockGetCountryState.mockResolvedValue({ countryId: "CN", rulingPartyId: null });
    const res = await POST(request({ scalar: "popularLegitimacy", value: 30 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(404);
  });

  it("self-heals when head of government exists but no leader-state row exists yet", async () => {
    // HoG resolver finds the character, but the countryLeaderStates row
    // is missing. Route should delegate to adjustPopularLegitimacy
    // (which has its own self-heal), computing delta from INITIAL (75).
    mockLeaderFindOne.mockResolvedValue(null);
    const res = await POST(request({ scalar: "popularLegitimacy", value: 50 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(200);
    const [, , character, delta] = mockAdjustPopular.mock.calls[0] as [
      unknown,
      string,
      ObjectId,
      number,
      string,
    ];
    expect(character).toBe(leaderCharId);
    // 50 - INITIAL(75) = -25
    expect(delta).toBe(-25);
  });

  it("applies a popularLegitimacy delta = target - current", async () => {
    // current = 60, target = 30 → delta = -30
    await POST(request({ scalar: "popularLegitimacy", value: 30 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    const [, , , delta, reason] = mockAdjustPopular.mock.calls[0] as [
      unknown,
      string,
      ObjectId,
      number,
      string,
    ];
    expect(delta).toBe(-30);
    expect(reason).toMatch(/admin override/);
  });

  it("applies a partyConfidence delta = target - current", async () => {
    // current = 50, target = 80 → delta = +30
    await POST(request({ scalar: "partyConfidence", value: 80 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    const [, , , delta] = mockAdjustConfidence.mock.calls[0] as [
      unknown,
      string,
      ObjectId,
      number,
      string,
    ];
    expect(delta).toBe(30);
  });
});
