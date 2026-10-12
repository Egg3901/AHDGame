import { beforeEach, describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/corporations/groups/management", () => ({
  groupManagementView: vi.fn(),
  updateGroupManagement: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/audit/recordAudit", () => ({ recordAudit: vi.fn() }));
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { groupManagementView, updateGroupManagement } from "@/lib/corporations/groups/management";
import { GET, PATCH } from "./route";
const context = { params: Promise.resolve({ id: "12" }) };
function request(body: unknown, origin?: string) {
  return new Request("https://game.test/api/corporations/12/group/management", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      host: "game.test",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: new ObjectId() },
  } as never);
  vi.mocked(updateGroupManagement).mockResolvedValue({ ok: true });
});
describe("group management API", () => {
  it("requires authentication", async () => {
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);
    expect((await GET(new Request("https://game.test"), context)).status).toBe(401);
    expect(groupManagementView).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes", async () => {
    expect(
      (
        await PATCH(
          request({ action: "participation", enabled: true }, "https://other.test"),
          context
        )
      ).status
    ).toBe(403);
    expect(updateGroupManagement).not.toHaveBeenCalled();
  });
  it.each([
    { action: "participation", enabled: "yes" },
    { action: "policy", policy: "discount" },
    { action: "identity", name: "x" },
    { action: "identity", name: "Group", pricePremium: -0.35 },
  ])("validates request %o", async (body) => {
    expect((await PATCH(request(body), context)).status).toBe(400);
    expect(updateGroupManagement).not.toHaveBeenCalled();
  });
  it("preserves domain authorization errors", async () => {
    vi.mocked(updateGroupManagement).mockResolvedValue({
      ok: false,
      status: 403,
      error: "Only its CEO",
    });
    expect((await PATCH(request({ action: "participation", enabled: true }), context)).status).toBe(
      403
    );
  });
  it("saves validated commands", async () => {
    expect((await PATCH(request({ action: "policy", policy: "members" }), context)).status).toBe(
      200
    );
    expect(updateGroupManagement).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.any(String),
      { action: "policy", policy: "members" }
    );
  });
});
