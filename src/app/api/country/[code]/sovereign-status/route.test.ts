import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockLoadSnapshot = vi.fn();
const mockComputeDemand = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));
vi.mock("@/lib/sovereignDefault/snapshotLoader", () => ({
  loadCountrySovereignSnapshot: (...args: unknown[]) => mockLoadSnapshot(...args),
}));
vi.mock("@/lib/sovereignDefault/marketDemand", () => ({
  computeMarketDemand: (...args: unknown[]) => mockComputeDemand(...args),
}));

import { GET } from "./route";

describe("GET /api/country/[code]/sovereign-status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stub `.collection(...)` for the federalBudget findOne and the
    // sovereignCrisisDecisions find().sort().limit().toArray() chain that
    // the route now performs to surface crisis state on top of the demand.
    mockGetDb.mockResolvedValue({
      collection: () => ({
        findOne: () => Promise.resolve(null),
        find: () => ({
          sort: () => ({
            limit: () => ({
              toArray: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    });
    mockRequireAuth.mockResolvedValue({ ok: true });
    mockGetCurrentTurn.mockResolvedValue(1000);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const params = Promise.resolve({ code: "US" });
    const req = new Request("http://localhost/api/country/US/sovereign-status");
    const res = await GET(req, { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid country code", async () => {
    const params = Promise.resolve({ code: "XX" });
    const req = new Request("http://localhost/api/country/XX/sovereign-status");
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid country/i);
  });

  it("returns 404 when the country has no federal budget", async () => {
    mockLoadSnapshot.mockResolvedValue(null);
    const params = Promise.resolve({ code: "US" });
    const req = new Request("http://localhost/api/country/US/sovereign-status");
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
  });

  it("returns 200 with demand result when snapshot loads", async () => {
    mockLoadSnapshot.mockResolvedValue({
      countryCode: "US",
      currentTurn: 1000,
      debtToGdp: 1.2,
      inflationRate: 0.03,
      trust: 0.55,
      sovereignCouponRate: 4.5,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
    });
    mockComputeDemand.mockReturnValue({
      demandRatio: 0.95,
      components: [{ id: "base", label: "Base", contribution: 1.2 }],
    });

    const params = Promise.resolve({ code: "US" });
    const req = new Request("http://localhost/api/country/US/sovereign-status");
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countryCode).toBe("US");
    expect(body.demand.demandRatio).toBeCloseTo(0.95);
    expect(body.snapshot.debtToGdp).toBeCloseTo(1.2);
  });

  it("uppercases the country code from the URL", async () => {
    mockLoadSnapshot.mockResolvedValue(null);
    const params = Promise.resolve({ code: "us" });
    const req = new Request("http://localhost/api/country/us/sovereign-status");
    await GET(req, { params });
    expect(mockLoadSnapshot).toHaveBeenCalledWith(expect.anything(), "US", 1000);
  });

  it("includes recovery fields when in recovering state (phase 9a)", async () => {
    mockGetDb.mockResolvedValue({
      collection: () => ({
        findOne: () =>
          Promise.resolve({
            sovereignCrisisState: "recovering",
            recoveryStartedAt: { turn: 100 },
            recoveryFiscalDisciplineStreak: 3,
            marketAccessLockedUntilTurn: 148,
            recoveryGdpPenaltyPercent: 0.12,
            recoveryGdpPenaltyTurnsRemaining: 2,
            imfSovereignBailoutActive: false,
            imfBoardOverrideWindowEndAt: null,
            crisisAutoActionAt: null,
          }),
        find: () => ({
          sort: () => ({ limit: () => ({ toArray: () => Promise.resolve([]) }) }),
        }),
      }),
    });
    mockLoadSnapshot.mockResolvedValue({
      countryCode: "US",
      currentTurn: 1000,
      debtToGdp: 0.6,
      inflationRate: 0.05,
      trust: 0.5,
      sovereignCouponRate: 4.0,
      fxDepreciationRate10t: 0,
      turnsSinceLastDefault: null,
    });
    mockComputeDemand.mockReturnValue({
      demandRatio: 1.0,
      components: [],
    });

    const params = Promise.resolve({ code: "US" });
    const req = new Request("http://localhost/api/country/US/sovereign-status");
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.crisisState).toBe("recovering");
    expect(body.recoveryStartedAt).toEqual({ turn: 100 });
    expect(body.recoveryFiscalDisciplineStreak).toBe(3);
    expect(body.marketAccessLockedUntilTurn).toBe(148);
    expect(body.recoveryGdpPenaltyPercent).toBeCloseTo(0.12);
    expect(body.recoveryGdpPenaltyTurnsRemaining).toBe(2);
  });
});
