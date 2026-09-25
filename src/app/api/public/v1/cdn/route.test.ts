import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/api/errors", () => ({
  handleRouteError: vi.fn(() => new Response("boom", { status: 500 })),
}));

import { GET } from "./route";

describe("GET /api/public/v1/cdn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the guard response when auth or rate limiting rejects", async () => {
    const { publicApiGuard } = await import("@/lib/publicApi/middleware");
    const denied = new Response(JSON.stringify({ ok: false, code: "UNAUTHORIZED" }), {
      status: 401,
    });
    vi.mocked(publicApiGuard).mockResolvedValue({ ok: false, response: denied } as never);

    const res = await GET(new Request("http://localhost/api/public/v1/cdn"));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "UNAUTHORIZED" });
    expect(publicApiGuard).toHaveBeenCalledWith(expect.anything(), "cdn");
  });

  it("serves the CDN catalog with the guard rate-limit headers", async () => {
    const { publicApiGuard } = await import("@/lib/publicApi/middleware");
    vi.mocked(publicApiGuard).mockResolvedValue({
      ok: true,
      headers: { "X-RateLimit-Limit": "60", "Cache-Control": "public, s-maxage=30" },
    });

    const res = await GET(new Request("http://localhost/api/public/v1/cdn"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(data.ok).toBe(true);
    expect(typeof data.cdnBase).toBe("string");
    expect(Array.isArray(data.categories)).toBe(true);
    expect(data.categories.map((c: { name: string }) => c.name)).toContain("heroes");
    expect(data.assets.logo).toMatch(/^https:\/\//);
  });
});
