import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
const mockGetCountryState = vi.fn();
const mockGetRegimeColl = vi.fn();
const mockGetLeaderColl = vi.fn();
const mockRegimeFindOne = vi.fn();
const mockLeaderFindOne = vi.fn();
const mockGetHog = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/countryState", () => ({
  getCountryState: (...args: unknown[]) => mockGetCountryState(...args),
}));
vi.mock("@/lib/db/collections/regimeEscalation", () => ({
  getRegimeEscalationCollection: (...args: unknown[]) => mockGetRegimeColl(...args),
}));
vi.mock("@/lib/db/collections/countryLeaderState", () => ({
  getCountryLeaderStatesCollection: (...args: unknown[]) => mockGetLeaderColl(...args),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: (...args: unknown[]) => mockGetHog(...args),
}));

import { GET } from "./route";

function request(): Request {
  return new Request("http://localhost/api/country/CN/regime/public");
}

describe("GET /api/country/[code]/regime/public", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockGetRegimeColl.mockReturnValue({ findOne: mockRegimeFindOne });
    mockGetLeaderColl.mockReturnValue({ findOne: mockLeaderFindOne });
    mockRegimeFindOne.mockResolvedValue(null);
    mockLeaderFindOne.mockResolvedValue({ popularLegitimacy: 75 });
    mockGetHog.mockResolvedValue(null);
  });

  it("returns 400 for an unknown country code", async () => {
    const res = await GET(request(), { params: Promise.resolve({ code: "XX" }) });
    expect(res.status).toBe(400);
  });

  it("returns { active: false } for a non-OPS country", async () => {
    mockGetCountryState.mockResolvedValue({
      countryId: "US",
      governmentType: "presidential",
      rulingPartyId: null,
    });
    const res = await GET(request(), { params: Promise.resolve({ code: "US" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { active: boolean };
    expect(json.active).toBe(false);
  });

  it("returns the band but never the raw scalar", async () => {
    mockGetCountryState.mockResolvedValue({
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
    });
    mockLeaderFindOne.mockResolvedValue({ popularLegitimacy: 42 });

    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.band).toBe("discontent"); // 42 is in 36..74 band
    expect(json).not.toHaveProperty("popularLegitimacy");
  });

  it("flags under-strain at internalChallenge / collapse", async () => {
    mockGetCountryState.mockResolvedValue({
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
    });
    mockRegimeFindOne.mockResolvedValue({
      currentStage: "internalChallenge",
      transitionHistory: [],
    });

    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    const json = (await res.json()) as { underStrain: boolean; stage: string };
    expect(json.stage).toBe("internalChallenge");
    expect(json.underStrain).toBe(true);
  });

  it("returns at most 3 recent transitions, newest first", async () => {
    mockGetCountryState.mockResolvedValue({
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
    });
    const at = new Date();
    mockRegimeFindOne.mockResolvedValue({
      currentStage: "discontent",
      transitionHistory: [
        { turn: 200, from: "stable", to: "discontent", reason: "popular<60", at },
        { turn: 150, from: "discontent", to: "stable", reason: "recovered", at },
        { turn: 100, from: "stable", to: "discontent", reason: "popular<60", at },
        { turn: 50, from: "discontent", to: "stable", reason: "recovered", at },
      ],
    });

    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    const json = (await res.json()) as { recentTransitions: { turn: number }[] };
    expect(json.recentTransitions).toHaveLength(3);
    expect(json.recentTransitions[0].turn).toBe(200);
  });

  it("falls back to INITIAL=75 when no leader-state exists yet", async () => {
    mockGetCountryState.mockResolvedValue({
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
    });
    mockLeaderFindOne.mockResolvedValue(null);

    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    const json = (await res.json()) as { band: string };
    expect(json.band).toBe("strong"); // 75 maps to strong band
  });
});
