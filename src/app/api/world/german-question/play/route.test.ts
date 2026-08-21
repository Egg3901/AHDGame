import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSessionWithCharacter: vi.fn() }));
vi.mock("@/lib/settlement/commands/commitPlay", () => ({ commitSettlementPlay: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

const characterId = new ObjectId();

function req(body: unknown): Request {
  return new Request("http://localhost/api/world/german-question/play", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/world/german-question/play", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "user-1", character: { _id: characterId } },
    } as never);
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
    const { commitSettlementPlay } = await import("@/lib/settlement/commands/commitPlay");
    vi.mocked(commitSettlementPlay).mockResolvedValue({
      ok: true,
      playId: "aid",
      appliedDirection: 1,
    });
  });

  it("rejects an unauthenticated caller", async () => {
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "seat", playId: "aid" }));
    expect(res.status).toBe(401);
  });

  it("does not reach the command when auth fails", async () => {
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    const { POST } = await import("./route");
    await POST(req({ actor: "seat", playId: "aid" }));
    const { commitSettlementPlay } = await import("@/lib/settlement/commands/commitPlay");
    expect(vi.mocked(commitSettlementPlay)).not.toHaveBeenCalled();
  });

  it("rate-limits before parsing the body or reaching the command", async () => {
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ok: false, retryAfter: 30 } as never);
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "seat", playId: "aid" }));
    expect(res.status).toBe(429);
    const { commitSettlementPlay } = await import("@/lib/settlement/commands/commitPlay");
    expect(vi.mocked(commitSettlementPlay)).not.toHaveBeenCalled();
  });

  it("keys the rate limit to the user, not the character", async () => {
    const { POST } = await import("./route");
    await POST(req({ actor: "seat", playId: "aid" }));
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledWith("user-1", 20, 60_000);
  });

  it("passes the request to the guard so same-origin and bot-token checks run", async () => {
    // This route spends a national treasury; a plain cookie guard would let a
    // cross-origin POST commit plays.
    const { POST } = await import("./route");
    const request = req({ actor: "seat", playId: "aid" });
    await POST(request);
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    expect(vi.mocked(requireHumanSessionWithCharacter)).toHaveBeenCalledWith(request);
  });

  it("rejects a body with no actor", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ playId: "aid" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown actor", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "admiral", playId: "aid" }));
    expect(res.status).toBe(400);
  });

  it("rejects a direction that is not +1 or -1", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "personal", playId: "oped", direction: 7 }));
    expect(res.status).toBe(400);
  });

  it("rejects an over-long playId rather than passing it to the command", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "seat", playId: "x".repeat(200) }));
    expect(res.status).toBe(400);
    const { commitSettlementPlay } = await import("@/lib/settlement/commands/commitPlay");
    expect(vi.mocked(commitSettlementPlay)).not.toHaveBeenCalled();
  });

  it("passes the authenticated character through, never a client-supplied one", async () => {
    const { POST } = await import("./route");
    await POST(req({ actor: "seat", playId: "aid", characterId: new ObjectId().toString() }));
    const { commitSettlementPlay } = await import("@/lib/settlement/commands/commitPlay");
    const passed = vi.mocked(commitSettlementPlay).mock.calls[0][1];
    expect(passed.characterId).toBe(characterId);
  });

  it("returns the command's status on refusal", async () => {
    const { commitSettlementPlay } = await import("@/lib/settlement/commands/commitPlay");
    vi.mocked(commitSettlementPlay).mockResolvedValue({
      ok: false,
      status: 402,
      error: "The national treasury cannot cover this play.",
    });
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "seat", playId: "aid" }));
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({
      error: "The national treasury cannot cover this play.",
    });
  });

  it("returns success with the direction that was actually applied", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "seat", playId: "aid", direction: -1 }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      playId: "aid",
      appliedDirection: 1,
    });
  });

  it("surfaces an unexpected failure as a handled error, not a crash", async () => {
    const { commitSettlementPlay } = await import("@/lib/settlement/commands/commitPlay");
    vi.mocked(commitSettlementPlay).mockRejectedValue(new Error("mongo is down"));
    const { POST } = await import("./route");
    const res = await POST(req({ actor: "seat", playId: "aid" }));
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
