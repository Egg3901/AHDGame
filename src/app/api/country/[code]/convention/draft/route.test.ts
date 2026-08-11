import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockIsSittingLeader = vi.fn();
const mockGetCurrentTurn = vi.fn();
const mockSubmitDraft = vi.fn();

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
  submitConventionDraft: (...args: unknown[]) => mockSubmitDraft(...args),
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/country/CN/convention/draft", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/convention/draft", () => {
  const characterId = new ObjectId();
  const validBody = {
    targetSystem: "parliamentaryRepublic" as const,
    legacyReservation: 20,
    electionDelayTurns: 24 as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    mockRequireAuth.mockResolvedValue({
      ok: true,
      user: { character: { _id: characterId, name: "Premier Li" } },
    });
    mockIsSittingLeader.mockResolvedValue(true);
    mockGetCurrentTurn.mockResolvedValue(310);
    mockSubmitDraft.mockResolvedValue(undefined);
  });

  it("returns 400 for an invalid body (missing targetSystem)", async () => {
    const res = await POST(request({ legacyReservation: 20, electionDelayTurns: 24 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(400);
    expect(mockSubmitDraft).not.toHaveBeenCalled();
  });

  it("returns 400 for legacyReservation out of range", async () => {
    const res = await POST(request({ ...validBody, legacyReservation: 50 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for an electionDelayTurns not in {12,24,48}", async () => {
    const res = await POST(request({ ...validBody, electionDelayTurns: 36 }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 403 when the caller is not the sitting leader", async () => {
    mockIsSittingLeader.mockResolvedValue(false);
    const res = await POST(request(validBody), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(403);
  });

  it("returns 200 and forwards the draft to submitConventionDraft", async () => {
    const res = await POST(request(validBody), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(200);
    expect(mockSubmitDraft).toHaveBeenCalledTimes(1);
    const [, countryId, draft, currentTurn] = mockSubmitDraft.mock.calls[0] as [
      unknown,
      string,
      typeof validBody,
      number,
    ];
    expect(countryId).toBe("CN");
    expect(draft).toEqual(validBody);
    expect(currentTurn).toBe(310);
  });

  it("returns 409 when no convention is in progress", async () => {
    mockSubmitDraft.mockRejectedValue(
      new Error("submitConventionDraft: no convention in progress")
    );
    const res = await POST(request(validBody), { params: Promise.resolve({ code: "CN" }) });
    expect(res.status).toBe(409);
  });

  it("returns 400 when the action rejects the targetSystem (allowlist)", async () => {
    mockSubmitDraft.mockRejectedValue(new Error('targetSystem "presidential" not in CN allowlist'));
    const res = await POST(request({ ...validBody, targetSystem: "presidential" }), {
      params: Promise.resolve({ code: "CN" }),
    });
    expect(res.status).toBe(400);
  });
});
