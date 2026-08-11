import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockIsSittingLeader = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockLegalizeParty = vi.fn();
const mockReduceVoteMultipliers = vi.fn();
const mockHoldHonestByElection = vi.fn();
const mockAnticorruptionPurge = vi.fn();
const mockConstitutionalAmendment = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: (...args: unknown[]) => mockRequireAuth(...args),
}));
vi.mock("@/lib/governorOffice/isSittingLeader", () => ({
  isSittingLeader: (...args: unknown[]) => mockIsSittingLeader(...args),
}));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));
vi.mock("@/lib/onePartyState/reformActions", () => ({
  legalizePartyAction: (...args: unknown[]) => mockLegalizeParty(...args),
  reduceVoteMultipliersAction: (...args: unknown[]) => mockReduceVoteMultipliers(...args),
  holdHonestByElectionAction: (...args: unknown[]) => mockHoldHonestByElection(...args),
  anticorruptionPurgeAction: (...args: unknown[]) => mockAnticorruptionPurge(...args),
  constitutionalAmendmentAction: (...args: unknown[]) => mockConstitutionalAmendment(...args),
}));

import { POST } from "./route";

function request(action: string, body?: unknown): Request {
  return new Request(`http://localhost/api/country/CN/reform/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/reform/[action]", () => {
  const characterId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { character: { _id: characterId, name: "Premier Li" } },
    });
    mockIsSittingLeader.mockResolvedValue(true);
    mockGetCurrentTurn.mockResolvedValue(500);
    mockLegalizeParty.mockResolvedValue(undefined);
    mockReduceVoteMultipliers.mockResolvedValue(undefined);
    mockHoldHonestByElection.mockResolvedValue(undefined);
    mockAnticorruptionPurge.mockResolvedValue(undefined);
    mockConstitutionalAmendment.mockResolvedValue(undefined);
  });

  it("returns 400 for an invalid country code", async () => {
    const res = await POST(request("reduceVoteMultipliers"), {
      params: Promise.resolve({ code: "XX", action: "reduceVoteMultipliers" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an unknown action", async () => {
    const res = await POST(request("madeUpAction"), {
      params: Promise.resolve({ code: "CN", action: "madeUpAction" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(request("reduceVoteMultipliers"), {
      params: Promise.resolve({ code: "CN", action: "reduceVoteMultipliers" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not the sitting leader", async () => {
    mockIsSittingLeader.mockResolvedValue(false);
    const res = await POST(request("reduceVoteMultipliers"), {
      params: Promise.resolve({ code: "CN", action: "reduceVoteMultipliers" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 200 and invokes reduceVoteMultipliersAction with currentTurn + leaderId", async () => {
    const res = await POST(request("reduceVoteMultipliers"), {
      params: Promise.resolve({ code: "CN", action: "reduceVoteMultipliers" }),
    });
    expect(res.status).toBe(200);
    expect(mockReduceVoteMultipliers).toHaveBeenCalledTimes(1);
    const ctx = mockReduceVoteMultipliers.mock.calls[0][0] as {
      countryId: string;
      currentTurn: number;
      leaderCharacterId: ObjectId;
    };
    expect(ctx.countryId).toBe("CN");
    expect(ctx.currentTurn).toBe(500);
    expect(ctx.leaderCharacterId).toBe(characterId);
  });

  it("legalizeParty: requires partyId in body, 400 if missing", async () => {
    const res = await POST(request("legalizeParty", {}), {
      params: Promise.resolve({ code: "CN", action: "legalizeParty" }),
    });
    expect(res.status).toBe(400);
    expect(mockLegalizeParty).not.toHaveBeenCalled();
  });

  it("legalizeParty: passes partyId to the action handler", async () => {
    const res = await POST(request("legalizeParty", { partyId: 7 }), {
      params: Promise.resolve({ code: "CN", action: "legalizeParty" }),
    });
    expect(res.status).toBe(200);
    expect(mockLegalizeParty).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it("returns 409 when the action handler throws a cooldown error", async () => {
    mockReduceVoteMultipliers.mockRejectedValue(
      new Error("reduceVoteMultipliersAction: on cooldown")
    );
    const res = await POST(request("reduceVoteMultipliers"), {
      params: Promise.resolve({ code: "CN", action: "reduceVoteMultipliers" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 409 when constitutional amendment is already used", async () => {
    mockConstitutionalAmendment.mockRejectedValue(
      new Error("constitutionalAmendmentAction: already used")
    );
    const res = await POST(request("constitutionalAmendment"), {
      params: Promise.resolve({ code: "CN", action: "constitutionalAmendment" }),
    });
    expect(res.status).toBe(409);
  });
});
