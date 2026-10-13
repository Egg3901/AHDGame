import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const CHAR = new ObjectId();
const mockAuth = vi.fn();
const mockTopUp = vi.fn();

vi.mock("@/lib/api/requireAuth", () => ({
  requireHumanSessionWithCharacter: (...args: unknown[]) => mockAuth(...args),
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/lib/currentTurn", () => ({ getCurrentTurn: vi.fn(async () => 77) }));
vi.mock("@/lib/actions/officePoolTopUp", () => ({
  topUpOfficePool: (...args: unknown[]) => mockTopUp(...args),
}));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://t/api/country/us/office-pool/top-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ code: "us" }) };

describe("POST /api/country/[code]/office-pool/top-up", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ ok: true, user: { character: { _id: CHAR } } });
  });

  it("maps each pool body to its target and passes the current turn", async () => {
    mockTopUp.mockResolvedValue({
      ok: true,
      kind: "justice",
      remaining: 2,
      cap: 2,
      actionsLeft: 5,
    });
    const res = await POST(req({ pool: "justice", seatNumber: 4 }), ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      actionsRemaining: 2,
      actionCap: 2,
      playerActions: 5,
    });
    expect(mockTopUp).toHaveBeenCalledWith(
      {},
      CHAR,
      { kind: "justice", countryId: "US", seatNumber: 4 },
      77
    );
  });

  it("surfaces rule failures with their status", async () => {
    mockTopUp.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Only the sitting vice-president can buy actions",
    });
    const res = await POST(req({ pool: "vp" }), ctx);
    expect(res.status).toBe(403);
  });

  it("rejects an unknown pool before touching the database", async () => {
    const res = await POST(req({ pool: "party" }), ctx);
    expect(res.status).toBe(400);
    expect(mockTopUp).not.toHaveBeenCalled();
  });

  it("returns the auth response when the caller has no session", async () => {
    mockAuth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const res = await POST(req({ pool: "vp" }), ctx);
    expect(res.status).toBe(401);
  });
});
