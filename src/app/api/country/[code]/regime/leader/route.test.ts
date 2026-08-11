import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockRequireAdmin = vi.fn();
const mockIsSittingLeader = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockGetCountryState = vi.fn();
const mockGetRegimeColl = vi.fn();
const mockGetLeaderColl = vi.fn();
const mockGetHandler = vi.fn();
const mockIsActionAvailable = vi.fn();
const mockRegimeFindOne = vi.fn();
const mockLeaderFindOne = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: (...args: unknown[]) => mockRequireAuth(...args),
}));
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: (...args: unknown[]) => mockRequireAdmin(...args),
}));
vi.mock("@/lib/governorOffice/isSittingLeader", () => ({
  isSittingLeader: (...args: unknown[]) => mockIsSittingLeader(...args),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));
vi.mock("@/lib/countryState", () => ({
  getCountryState: (...args: unknown[]) => mockGetCountryState(...args),
}));
vi.mock("@/lib/db/collections/regimeEscalation", () => ({
  getRegimeEscalationCollection: (...args: unknown[]) => mockGetRegimeColl(...args),
}));
vi.mock("@/lib/db/collections/countryLeaderState", () => ({
  getCountryLeaderStatesCollection: (...args: unknown[]) => mockGetLeaderColl(...args),
}));
vi.mock("@/lib/onePartyState/decisionEvents/registry", () => ({
  getDecisionHandler: (...args: unknown[]) => mockGetHandler(...args),
  registerDecisionHandler: vi.fn(),
}));
// The route side-effect-imports the decisionEvents barrel to populate
// the registry; mock it to a no-op so the test doesn't actually try to
// load the real handlers (which would pull in DB modules).
vi.mock("@/lib/onePartyState/decisionEvents", () => ({}));
vi.mock("@/lib/onePartyState/reformCooldowns", () => ({
  isActionAvailable: (...args: unknown[]) => mockIsActionAvailable(...args),
}));

import { GET } from "./route";

function request(): Request {
  return new Request("http://localhost/api/country/CN/regime/leader");
}

describe("GET /api/country/[code]/regime/leader", () => {
  const characterId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { character: { _id: characterId, name: "Premier Li" } },
    });
    mockIsSittingLeader.mockResolvedValue(true);
    mockRequireAdmin.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });
    mockGetCurrentTurn.mockResolvedValue(500);
    mockGetCountryState.mockResolvedValue({
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
      reformCooldowns: {},
    });
    mockGetRegimeColl.mockReturnValue({ findOne: mockRegimeFindOne });
    mockGetLeaderColl.mockReturnValue({ findOne: mockLeaderFindOne });
    mockRegimeFindOne.mockResolvedValue(null);
    mockLeaderFindOne.mockResolvedValue({
      popularLegitimacy: 55,
      partyConfidence: 60,
      popularLegitimacyHistory: [],
      confidenceHistory: [],
    });
    mockGetHandler.mockReturnValue(undefined);
    mockIsActionAvailable.mockResolvedValue(true);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not the sitting leader", async () => {
    mockIsSittingLeader.mockResolvedValue(false);
    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(403);
  });

  it("returns 200 for a site admin who is not the sitting leader", async () => {
    mockIsSittingLeader.mockResolvedValue(false);
    mockRequireAdmin.mockResolvedValue({ ok: true, admin: { userId: "admin-1" } });
    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(200);
  });

  it("grants an admin read access even without an active character", async () => {
    // Mod accounts may have no character at all — requireHumanSessionWithCharacter
    // 401s for them, but the admin override still lets them view diagnostics.
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    mockRequireAdmin.mockResolvedValue({ ok: true, admin: { userId: "admin-1" } });
    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(200);
  });

  it("returns the raw scalars + bands for the sitting leader", async () => {
    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      scalars: {
        popularLegitimacy: number;
        popularBand: string;
        partyConfidence: number;
        confidenceBand: string;
      };
    };
    expect(json.scalars.popularLegitimacy).toBe(55);
    expect(json.scalars.popularBand).toBe("discontent");
    expect(json.scalars.partyConfidence).toBe(60);
    // 60 maps to 'watchful' band in CONFIDENCE_BANDS (50..64)
    expect(json.scalars.confidenceBand).toBe("watchful");
  });

  it("attaches the active decision's registered options when a handler exists", async () => {
    const decisionId = new ObjectId();
    mockRegimeFindOne.mockResolvedValue({
      currentStage: "discontent",
      activeDecision: {
        id: decisionId,
        kind: "stage1.addressDiscontent",
        offeredAtTurn: 480,
        expiresAtTurn: 528,
        payload: {},
      },
      transitionHistory: [],
    });
    mockGetHandler.mockReturnValue({
      kind: "stage1.addressDiscontent",
      options: [
        { id: "acknowledge", label: "Acknowledge", description: "..." },
        { id: "crackDown", label: "Crack down", description: "..." },
        { id: "ignore", label: "Ignore", description: "..." },
      ],
      defaultOptionId: "ignore",
    });

    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    const json = (await res.json()) as {
      activeDecision: {
        id: string;
        options: { id: string }[];
      } | null;
    };
    expect(json.activeDecision).not.toBeNull();
    expect(json.activeDecision!.id).toBe(decisionId.toHexString());
    expect(json.activeDecision!.options.map((o) => o.id)).toEqual([
      "acknowledge",
      "crackDown",
      "ignore",
    ]);
  });

  it("reports reform availability + cooldown turns from countryState", async () => {
    mockGetCountryState.mockResolvedValue({
      countryId: "CN",
      governmentType: "onePartyState",
      rulingPartyId: 1,
      reformCooldowns: {
        reduceVoteMultipliers: 700, // cooldown until turn 700
        constitutionalAmendment: "used",
      },
    });
    mockIsActionAvailable.mockImplementation((_db, _country, action) => {
      if (action === "reduceVoteMultipliers") return Promise.resolve(false);
      if (action === "constitutionalAmendment") return Promise.resolve(false);
      return Promise.resolve(true);
    });

    const res = await GET(request(), { params: Promise.resolve({ code: "CN" }) });
    const json = (await res.json()) as {
      reformAvailability: Record<
        string,
        { available: boolean; cooldownUntil?: number; note?: string }
      >;
    };
    expect(json.reformAvailability.reduceVoteMultipliers.available).toBe(false);
    expect(json.reformAvailability.reduceVoteMultipliers.cooldownUntil).toBe(700);
    expect(json.reformAvailability.constitutionalAmendment.available).toBe(false);
    expect(json.reformAvailability.constitutionalAmendment.note).toMatch(/Already used/);
    expect(json.reformAvailability.anticorruptionPurge.available).toBe(true);
  });
});
