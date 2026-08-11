import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockIsSittingLeader = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockResolveDecision = vi.fn();
const mockFindOne = vi.fn();
const mockFindOneAndUpdate = vi.fn();
const mockGetRegimeColl = vi.fn();

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
vi.mock("@/lib/onePartyState/decisionQueue", () => ({
  resolveActiveDecision: (...args: unknown[]) => mockResolveDecision(...args),
}));
vi.mock("@/lib/db/collections/regimeEscalation", () => ({
  getRegimeEscalationCollection: (...args: unknown[]) => mockGetRegimeColl(...args),
}));

import { POST } from "./route";

function request(body: unknown = { optionId: "acknowledge" }): Request {
  return new Request("http://localhost/api/country/CN/regime/decision/x/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/regime/decision/[id]/resolve", () => {
  const characterId = new ObjectId();
  const activeDecisionId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { character: { _id: characterId, name: "Premier Li" } },
    });
    mockIsSittingLeader.mockResolvedValue(true);
    mockGetCurrentTurn.mockResolvedValue(150);
    mockResolveDecision.mockResolvedValue(undefined);
    mockFindOne.mockResolvedValue({
      activeDecision: {
        id: activeDecisionId,
        kind: "stage1.addressDiscontent",
        payload: {},
      },
    });
    mockFindOneAndUpdate.mockResolvedValue(null);
    mockGetRegimeColl.mockReturnValue({
      findOne: mockFindOne,
      findOneAndUpdate: mockFindOneAndUpdate,
    });
  });

  it("returns 400 for an invalid country", async () => {
    const res = await POST(request(), {
      params: Promise.resolve({ code: "XX", id: activeDecisionId.toHexString() }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid decision-id ObjectId string", async () => {
    const res = await POST(request(), {
      params: Promise.resolve({ code: "CN", id: "not-an-objectid" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(request(), {
      params: Promise.resolve({ code: "CN", id: activeDecisionId.toHexString() }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not the sitting leader", async () => {
    mockIsSittingLeader.mockResolvedValue(false);
    const res = await POST(request(), {
      params: Promise.resolve({ code: "CN", id: activeDecisionId.toHexString() }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 when no active decision exists", async () => {
    mockFindOne.mockResolvedValue({ activeDecision: null });
    const res = await POST(request(), {
      params: Promise.resolve({ code: "CN", id: activeDecisionId.toHexString() }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 when decision-id in URL doesn't match the active slot", async () => {
    const staleId = new ObjectId();
    const res = await POST(request(), {
      params: Promise.resolve({ code: "CN", id: staleId.toHexString() }),
    });
    expect(res.status).toBe(409);
  });

  it("returns 200 and calls resolveActiveDecision with the optionId + currentTurn", async () => {
    const res = await POST(request({ optionId: "acknowledge" }), {
      params: Promise.resolve({ code: "CN", id: activeDecisionId.toHexString() }),
    });
    expect(res.status).toBe(200);
    expect(mockResolveDecision).toHaveBeenCalledTimes(1);
    const [, countryId, optionId, turn] = mockResolveDecision.mock.calls[0] as [
      unknown,
      string,
      string,
      number,
    ];
    expect(countryId).toBe("CN");
    expect(optionId).toBe("acknowledge");
    expect(turn).toBe(150);
  });

  it("merges supplied payload into activeDecision.payload before resolving", async () => {
    await POST(request({ optionId: "selectiveConcession", payload: { bannedPartyId: 7 } }), {
      params: Promise.resolve({ code: "CN", id: activeDecisionId.toHexString() }),
    });

    // findOneAndUpdate was called to write the merged payload
    expect(mockFindOneAndUpdate).toHaveBeenCalled();
    const updateCall = mockFindOneAndUpdate.mock.calls[0];
    const set = (updateCall[1] as { $set: { "activeDecision.payload": Record<string, unknown> } })
      .$set;
    expect(set["activeDecision.payload"]).toEqual({ bannedPartyId: 7 });
  });

  it("returns 409 when the registry throws 'unknown option'", async () => {
    mockResolveDecision.mockRejectedValue(new Error("No handler for unknown option 'bogus'"));
    const res = await POST(request({ optionId: "bogus" }), {
      params: Promise.resolve({ code: "CN", id: activeDecisionId.toHexString() }),
    });
    expect(res.status).toBe(409);
  });
});
