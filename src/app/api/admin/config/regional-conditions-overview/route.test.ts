import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireAdmin = vi.fn();
const mockFindOne = vi.fn();
const mockUpdateOne = vi.fn();
const mockCreateAdminLog = vi.fn();

vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: () => mockRequireAdmin(),
}));

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      findOne: mockFindOne,
      updateOne: mockUpdateOne,
    }),
  })),
}));

vi.mock("@/lib/adminLog", () => ({
  createAdminLog: (...args: unknown[]) => mockCreateAdminLog(...args),
}));

describe("GET /api/admin/config/regional-conditions-overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    });
  });

  it("returns enabled=false by default", async () => {
    mockFindOne.mockResolvedValue({});
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();
    expect(json.enabled).toBe(false);
  });

  it("returns enabled=true when configured", async () => {
    mockFindOne.mockResolvedValue({ regionalConditionsOverviewEnabled: true });
    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();
    expect(json.enabled).toBe(true);
  });
});

describe("PATCH /api/admin/config/regional-conditions-overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      admin: { username: "admin" },
    });
    mockUpdateOne.mockResolvedValue({ acknowledged: true });
  });

  it("persists the enabled flag", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://localhost/api/admin/config/regional-conditions-overview", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(mockUpdateOne).toHaveBeenCalled();
    expect(mockCreateAdminLog).toHaveBeenCalled();
  });
});
