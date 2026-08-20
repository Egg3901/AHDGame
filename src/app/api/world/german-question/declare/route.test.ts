import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireHumanSessionWithCharacter: vi.fn() }));
vi.mock("@/lib/settlement/commands/declareWar", () => ({ declareSettlementWar: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

const characterId = new ObjectId();
const req = () =>
  new Request("http://localhost/api/world/german-question/declare", { method: "POST" });

describe("POST /api/world/german-question/declare", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { requireHumanSessionWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireHumanSessionWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "user-1", character: { _id: characterId } },
    } as never);
    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({ ok: true } as never);
    const { declareSettlementWar } = await import("@/lib/settlement/commands/declareWar");
    vi.mocked(declareSettlementWar).mockResolvedValue({
      ok: true,
      conflictId: "gq_de_412",
      conflictNumber: 7,
    });
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
    const { declareSettlementWar } = await import("@/lib/settlement/commands/declareWar");
    expect(vi.mocked(declareSettlementWar)).not.toHaveBeenCalled();
  });

  it("returns the command's refusal status", async () => {
    const { declareSettlementWar } = await import("@/lib/settlement/commands/declareWar");
    vi.mocked(declareSettlementWar).mockResolvedValue({
      ok: false,
      status: 409,
      error: "The ladder is no longer at the brink. Force the issue again first.",
    });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "The ladder is no longer at the brink. Force the issue again first.",
    });
  });

  it("returns the conflict it opened", async () => {
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      conflictId: "gq_de_412",
      conflictNumber: 7,
    });
  });

  it("surfaces an unexpected failure as a handled error", async () => {
    const { declareSettlementWar } = await import("@/lib/settlement/commands/declareWar");
    vi.mocked(declareSettlementWar).mockRejectedValue(new Error("mongo is down"));
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBeGreaterThanOrEqual(500);
  });
});
