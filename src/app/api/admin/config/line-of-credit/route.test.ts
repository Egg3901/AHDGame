import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("@/lib/adminLog", () => ({
  createAdminLog: vi.fn(),
}));

describe("GET /api/admin/config/line-of-credit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns enabled true when gameConfig flag is absent (default-on)", async () => {
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    } as never);
    vi.mocked(getDb).mockResolvedValue({
      collection: () => ({
        findOne: vi.fn().mockResolvedValue({ _id: "default" }),
      }),
    } as never);

    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.enabled).toBe(true);
  });
});
