import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasSandboxAccess } from "@/lib/sandbox/access";

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

const call = async (granted: boolean) => {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("http://test", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "507f1f77bcf86cd799439011", granted }),
    })
  );
};

describe("PATCH /api/admin/users/sandbox-access", () => {
  it("grants access and never writes a supporter field", async () => {
    requireAdmin.mockResolvedValueOnce({ ok: true, admin: { username: "operator" } });
    findOne.mockResolvedValueOnce({ username: "Ada" });
    expect((await call(true)).status).toBe(200);

    const update = updateOne.mock.calls[0][1];
    expect(update.$set).toMatchObject({
      sandboxAccessGrantedBy: "operator",
      sandboxAccessGrantedAt: expect.any(Date),
    });
    const written = Object.keys({ ...update.$set, ...update.$unset });
    expect(written.filter((key) => /patreon|supporter|adsDisabled/i.test(key))).toEqual([]);
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sandbox_access_granted", username: "Ada" })
    );

    // A granted tester has no supporter standing, so no perk gate opens.
    const grantedTester = { testerGranted: true, patreonTier: null, isPatronActive: false };
    expect(hasSandboxAccess({ ...grantedTester, testerAccessEnabled: true })).toBe(true);
    expect(hasSandboxAccess({ ...grantedTester, testerAccessEnabled: false })).toBe(false);
  });

  it("revokes by unsetting only the grant fields", async () => {
    requireAdmin.mockResolvedValueOnce({ ok: true, admin: { username: "operator" } });
    findOne.mockResolvedValueOnce({ username: "Ada" });
    expect((await call(false)).status).toBe(200);
    expect(Object.keys(updateOne.mock.calls[0][1].$unset).sort()).toEqual([
      "sandboxAccessGrantedAt",
      "sandboxAccessGrantedBy",
    ]);
  });

  it("rejects non-admin callers", async () => {
    requireAdmin.mockResolvedValueOnce({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await call(true)).status).toBe(403);
    expect(updateOne).not.toHaveBeenCalled();
  });
});
