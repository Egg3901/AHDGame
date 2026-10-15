import { beforeEach, describe, it, expect, vi } from "vitest";
const ctx = vi.hoisted(() => ({ context: vi.fn(), award: vi.fn(), auth: vi.fn() }));
vi.mock("@/lib/governmentContracts/api", async () => {
  const { NextResponse } = await import("next/server");
  return {
    contractContext: ctx.context,
    privateJson: (body: unknown) => NextResponse.json(body),
    contractRouteError: (e: Error & { status?: number }) =>
      NextResponse.json({ error: e.message }, { status: e.status ?? 500 }),
  };
});
vi.mock("@/lib/governmentContracts/commands", () => ({ awardTender: ctx.award }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: ctx.auth }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: () => ({ ok: true }) }));
import { POST } from "./route";

describe("government tender award acknowledgement API", () => {
  const context = { params: Promise.resolve({ code: "jp", id: "tender" }) };
  const body = { corporationId: "a".repeat(24), reason: "Qualified concession bid." };
  const request = (payload: unknown) =>
    new Request("http://localhost/award", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  beforeEach(() => {
    vi.clearAllMocks();
    ctx.auth.mockResolvedValue({ ok: true, user: { userId: "b".repeat(24) } });
    ctx.context.mockResolvedValue({ db: {}, tender: { _id: "tender" }, turn: 3 });
    ctx.award.mockResolvedValue("contract");
  });
  it("passes an explicit acknowledgement to the authoritative command", async () => {
    const res = await POST(request({ ...body, acknowledgeConflict: true }), context);
    expect(res.status).toBe(200);
    expect(ctx.context).toHaveBeenCalledWith("jp", "tender");
    expect(ctx.award.mock.calls[0][7]).toBe(true);
  });
  it("does not coerce a string into acknowledgement", async () => {
    expect((await POST(request({ ...body, acknowledgeConflict: "true" }), context)).status).toBe(
      400
    );
    expect(ctx.award).not.toHaveBeenCalled();
  });
  it("returns the domain warning when no acknowledgement is supplied", async () => {
    ctx.award.mockRejectedValue(
      Object.assign(new Error("Acknowledge the conflict"), { status: 409 })
    );
    const res = await POST(request(body), context);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Acknowledge the conflict" });
    expect(ctx.award.mock.calls[0][7]).toBeUndefined();
  });
  it("requires authentication before accessing the tender", async () => {
    ctx.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await POST(request(body), context)).status).toBe(401);
    expect(ctx.context).not.toHaveBeenCalled();
    expect(ctx.award).not.toHaveBeenCalled();
  });
});
