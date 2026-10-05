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

describe("/api/admin/sandbox-access", () => {
  it("defaults to off when the config has no value", async () => {
    requireAdmin.mockResolvedValueOnce({ ok: true, admin: { username: "operator" } });
    findOne.mockResolvedValueOnce(null);
    const { GET } = await import("./route");
    expect(await (await GET()).json()).toEqual({ enabled: false });
  });

  it("flips gameConfig.sandboxTesterAccessEnabled and logs it", async () => {
    requireAdmin.mockResolvedValueOnce({ ok: true, admin: { username: "operator" } });
    const { PATCH } = await import("./route");
    const res = await PATCH(
      new Request("http://test", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "default" },
      { $set: { sandboxTesterAccessEnabled: true } },
      { upsert: true }
    );
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sandbox_tester_access_enabled" })
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
