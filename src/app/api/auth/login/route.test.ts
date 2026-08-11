import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/utils/network", () => ({ getClientIp: vi.fn().mockResolvedValue("203.0.113.5") }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  AUTH_LIMITS: { maxRequests: 10, windowMs: 60000 },
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined, set: () => {} }),
  headers: vi.fn().mockResolvedValue({ get: () => null }),
}));

describe("POST /api/auth/login — component persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes lastFingerprintComponents on successful login", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("password123", 4);
    const updateOne = vi.fn().mockResolvedValue({});
    const { ObjectId } = await import("mongodb");
    const userId = new ObjectId();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({
      collection: (name: string) =>
        name === "users"
          ? {
              findOne: vi.fn().mockResolvedValue({
                _id: userId,
                email: "a@b.com",
                username: "alpha",
                password: hash,
                role: "player",
              }),
              updateOne,
            }
          : {
              insertOne: vi.fn().mockResolvedValue({}),
              findOne: vi.fn().mockResolvedValue(null),
            },
    } as never);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "user-agent": "test" },
      body: JSON.stringify({
        email: "a@b.com",
        password: "password123",
        fingerprint: "hash1",
        fingerprintComponents: { canvas: "C", webglRenderer: "G", audio: "A" },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const setArg = updateOne.mock.calls[0][1].$set;
    expect(setArg.lastFingerprintComponents).toEqual({
      canvas: "C",
      webglRenderer: "G",
      audio: "A",
    });
  });
});
