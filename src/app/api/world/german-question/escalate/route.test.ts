import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSessionWithCharacter: vi.fn() }));
vi.mock("@/lib/settlement/commands/armLadder", () => ({ armSettlementLadder: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

const characterId = new ObjectId();
const req = () =>
  new Request("http://localhost/api/world/german-question/escalate", { method: "POST" });

describe("POST /api/world/german-question/escalate", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "user-1", character: { _id: characterId } },
    } as never);
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
    const { armSettlementLadder } = await import("@/lib/settlement/commands/armLadder");
    vi.mocked(armSettlementLadder).mockResolvedValue({ ok: true, heat: 5 });
  });

  it("rejects an unauthenticated caller", async () => {
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(401);
  });

  it("uses the guard that asserts same-origin and rejects bot tokens", async () => {
    // This arms a confrontation and starts a levy on four treasuries; a plain
    // cookie guard would let a cross-origin POST do it.
    const { POST } = await import("./route");
    const request = req();
    await POST(request);
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    expect(vi.mocked(requireHumanSessionWithCharacter)).toHaveBeenCalledWith(request);
  });

  it("rate-limits before reaching the command", async () => {
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ok: false, retryAfter: 30 } as never);
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(429);
    const { armSettlementLadder } = await import("@/lib/settlement/commands/armLadder");
    expect(vi.mocked(armSettlementLadder)).not.toHaveBeenCalled();
  });

  it("passes the authenticated character to the command", async () => {
    const { POST } = await import("./route");
    await POST(req());
    const { armSettlementLadder } = await import("@/lib/settlement/commands/armLadder");
    expect(vi.mocked(armSettlementLadder).mock.calls[0][1]).toBe(characterId);
  });

  it("returns the command's refusal status", async () => {
    const { armSettlementLadder } = await import("@/lib/settlement/commands/armLadder");
    vi.mocked(armSettlementLadder).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Only Washington and Moscow may take the bloc to the ladder.",
    });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Only Washington and Moscow may take the bloc to the ladder.",
    });
  });

  it("returns the armed rung on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, heat: 5 });
  });

  it("surfaces an unexpected failure as a handled error", async () => {
    const { armSettlementLadder } = await import("@/lib/settlement/commands/armLadder");
    vi.mocked(armSettlementLadder).mockRejectedValue(new Error("mongo is down"));
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBeGreaterThanOrEqual(500);
  });
});
