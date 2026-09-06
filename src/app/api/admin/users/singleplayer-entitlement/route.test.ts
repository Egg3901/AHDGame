import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const findOne = vi.fn();
const updateOne = vi.fn();
const createAdminLog = vi.fn();

vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin }));
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => ({ collection: () => ({ findOne, updateOne }) })),
}));
vi.mock("@/lib/adminLog", () => ({ createAdminLog }));

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/admin/users/singleplayer-entitlement", () => {
  it("grants access and records the administrator", async () => {
    requireAdmin.mockResolvedValueOnce({ ok: true, admin: { username: "operator" } });
    findOne.mockResolvedValueOnce({ username: "Ada" });
    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "507f1f77bcf86cd799439011", entitled: true }),
      })
    );
    expect(response.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({
        singleplayerEntitledBy: "operator",
        singleplayerEntitledAt: expect.any(Date),
      }),
    });
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "singleplayer_entitlement_granted", username: "Ada" })
    );
  });

  it("rejects non-admin callers", async () => {
    requireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    const { PATCH } = await import("./route");
    expect((await PATCH(new Request("http://test", { method: "PATCH" }))).status).toBe(403);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
