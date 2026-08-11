import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockIsSittingLeader = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockAnnounceConvention = vi.fn();

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
vi.mock("@/lib/onePartyState/constitutionalConvention", () => ({
  announceConvention: (...args: unknown[]) => mockAnnounceConvention(...args),
}));

import { POST } from "./route";

function request(): Request {
  return new Request("http://localhost/api/country/CN/convention/announce", { method: "POST" });
}

describe("POST /api/country/[code]/convention/announce", () => {
  const characterId = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { character: { _id: characterId, name: "Premier Li" } },
    });
    mockIsSittingLeader.mockResolvedValue(true);
    mockGetCurrentTurn.mockResolvedValue(300);
    mockAnnounceConvention.mockResolvedValue(undefined);
  });

  it("returns 400 for an invalid country code", async () => {
    const res = await POST(request(), { params: Promise.resolve({ code: "XX" }) });
    expect(res.status).toBe(400);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is not the sitting leader", async () => {
    mockIsSittingLeader.mockResolvedValue(false);
    const res = await POST(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(403);
  });

  it("returns 200 and invokes announceConvention with leader id + currentTurn", async () => {
    const res = await POST(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(200);
    expect(mockAnnounceConvention).toHaveBeenCalledTimes(1);
    const [, countryId, leaderCharacterId, currentTurn] = mockAnnounceConvention.mock.calls[0] as [
      unknown,
      string,
      ObjectId,
      number,
    ];
    expect(countryId).toBe("CN");
    expect(leaderCharacterId).toBe(characterId);
    expect(currentTurn).toBe(300);
  });

  it("returns 409 when the action throws 'collapse stage'", async () => {
    mockAnnounceConvention.mockRejectedValue(
      new Error("Cannot announce convention during collapse stage")
    );
    const res = await POST(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(409);
  });

  it("returns 409 when a convention is already in progress", async () => {
    mockAnnounceConvention.mockRejectedValue(new Error("Convention already in progress"));
    const res = await POST(request(), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(409);
  });
});
