import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/utils/network", () => ({ getClientIp: vi.fn().mockResolvedValue("203.0.113.9") }));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => ({ value: "track-123" }) }),
}));
vi.mock("@/lib/auth", () => ({
  verifyAuth: vi.fn(),
  clearAuthCookie: vi.fn().mockResolvedValue(undefined),
}));

describe("POST /api/auth/logout — logout tracking", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets lastLogout and writes an enriched logout activity row", async () => {
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();

    const { verifyAuth } = await import("@/lib/auth");
    vi.mocked(verifyAuth).mockResolvedValue({
      userId: userId.toString(),
      username: "alpha",
    } as never);

    const updateOne = vi.fn().mockResolvedValue({});
    const insertOne = vi.fn().mockResolvedValue({});
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) => (name === "users" ? { updateOne } : { insertOne }),
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { "user-agent": "test-agent" },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });

    await vi.waitFor(() => expect(updateOne).toHaveBeenCalled());
    expect(updateOne.mock.calls[0][1].$set.lastLogout).toBeInstanceOf(Date);

    await vi.waitFor(() => expect(insertOne).toHaveBeenCalled());
    const row = insertOne.mock.calls[0][0];
    expect(row.type).toBe("logout");
    expect(row.ipAddress).toBe("203.0.113.9");
    expect(row.userAgent).toBe("test-agent");
    expect(row.trackingId).toBe("track-123");
  });

  it("skips DB writes when there is no auth payload", async () => {
    const { verifyAuth } = await import("@/lib/auth");
    vi.mocked(verifyAuth).mockResolvedValue(null as never);

    const collection = vi.fn();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({ collection } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/auth/logout", { method: "POST" });
    const res = await POST(req);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(collection).not.toHaveBeenCalled();
  });
});
