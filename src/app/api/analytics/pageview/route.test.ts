import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

vi.mock("@/lib/utils/network", () => ({
  getClientIp: vi.fn().mockResolvedValue("127.0.0.1"),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn().mockResolvedValue(null),
  getTrackingCookieOptions: vi.fn(async () => ({
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: false,
    maxAge: 1,
  })),
}));

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  db.collection("siteTrafficPageviews");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

  const { cookies, headers } = await import("next/headers");
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => ({ value: "visitor-uuid-test" })),
    set: vi.fn(),
  } as never);
  vi.mocked(headers).mockResolvedValue({
    get: vi.fn((name: string) => (name === "user-agent" ? "Mozilla/5.0 Chrome/120" : null)),
  } as never);
});

describe("POST /api/analytics/pageview", () => {
  it("returns 400 for invalid path", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/analytics/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/bad/../path" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("inserts a pageview for a valid path", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/analytics/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/news" }),
      })
    );
    expect(res.status).toBe(201);
    expect(db.collectionMocks.siteTrafficPageviews!.insertOne).toHaveBeenCalled();
    const call = vi.mocked(db.collectionMocks.siteTrafficPageviews!.insertOne).mock.calls[0][0];
    expect(call).toMatchObject({
      path: "/news",
      visitorId: "visitor-uuid-test",
      authenticated: false,
    });
  });

  it("marks the pageview as authenticated only for non-banned resolved users", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({
      userId: "507f1f77bcf86cd799439011",
      username: "testuser",
      email: "test@example.com",
      role: "player",
      isAdmin: false,
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/analytics/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/dashboard" }),
      })
    );
    expect(res.status).toBe(201);
    const call = vi.mocked(db.collectionMocks.siteTrafficPageviews!.insertOne).mock.calls[0][0];
    expect(call).toMatchObject({
      path: "/dashboard",
      authenticated: true,
    });
  });

  it("returns 204 for bot user agents", async () => {
    const { headers } = await import("next/headers");
    vi.mocked(headers).mockResolvedValue({
      get: vi.fn((name: string) => (name === "user-agent" ? "Googlebot/2.1" : null)),
    } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/analytics/pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/" }),
      })
    );
    expect(res.status).toBe(204);
  });
});
