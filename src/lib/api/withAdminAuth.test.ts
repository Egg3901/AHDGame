import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { withAdminAuth } from "./withAdminAuth";

vi.mock("./requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));
import { requireAdmin } from "./requireAdmin";

describe("withAdminAuth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the failure response when requireAdmin denies", async () => {
    const failResponse = NextResponse.json({ error: "forbidden" }, { status: 403 });
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: failResponse,
    });
    const inner = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const handler = withAdminAuth(inner);

    const res = (await handler(new Request("http://x/y"))) as Response;

    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it("invokes the handler with auth on success", async () => {
    const admin = { userId: "user-1", isAdmin: true };
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: admin as never,
    });
    const inner = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const handler = withAdminAuth(inner);

    const req = new Request("http://x/y");
    const res = (await handler(req)) as Response;

    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledOnce();
    const [authArg, requestArg] = inner.mock.calls[0];
    expect(authArg).toEqual({ ok: true, admin });
    expect(requestArg).toBe(req);
  });

  it("forwards the route context (params) as the second handler arg", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "u", isAdmin: true } as never,
    });
    const inner = vi.fn().mockResolvedValue(NextResponse.json({ ok: true }));
    const handler = withAdminAuth(inner);
    const ctx = { params: Promise.resolve({ id: "123" }) };

    await handler(new Request("http://x/y"), ctx);

    expect(inner).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true }),
      expect.any(Request),
      ctx
    );
  });
});
