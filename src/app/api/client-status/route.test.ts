import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

describe("GET /api/client-status", () => {
  it("returns the shared auth failure response for banned or revoked sessions", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Authentication required" }, { status: 401 }),
    });

    const { getDb } = await import("@/lib/mongodb");
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/client-status"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
    expect(getDb).not.toHaveBeenCalled();
  });
});
