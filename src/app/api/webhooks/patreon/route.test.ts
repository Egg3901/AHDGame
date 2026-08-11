import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/patreon/webhook", () => ({
  parseAndVerifyPatreonWebhook: vi.fn(),
  getPatreonUserIdFromPayload: vi.fn(),
  getPrimaryPatreonTierId: vi.fn(),
}));
vi.mock("@/lib/patreon/service", () => ({
  applyPatreonStatus: vi.fn(),
  findUserByPatreonUserId: vi.fn(),
  mapPatreonTierId: vi.fn(),
  startPatreonGracePeriod: vi.fn(),
}));

describe("POST /api/webhooks/patreon", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns 401 on invalid signature", async () => {
    const { parseAndVerifyPatreonWebhook } = await import("@/lib/patreon/webhook");
    const { unauthorized } = await import("@/lib/api/errors");
    vi.mocked(parseAndVerifyPatreonWebhook).mockRejectedValue(
      unauthorized("Invalid Patreon webhook signature")
    );

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/webhooks/patreon", { method: "POST" })
    );

    expect(res.status).toBe(401);
  });

  it("activates supporter status for active events", async () => {
    const userId = new ObjectId();
    const webhook = await import("@/lib/patreon/webhook");
    const service = await import("@/lib/patreon/service");

    vi.mocked(webhook.parseAndVerifyPatreonWebhook).mockResolvedValue({
      eventType: "members:create",
      payload: { data: {} },
      rawBody: "{}",
    });
    vi.mocked(webhook.getPatreonUserIdFromPayload).mockReturnValue("patron-123");
    vi.mocked(webhook.getPrimaryPatreonTierId).mockReturnValue("tier-plus");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue({ _id: userId } as never);
    vi.mocked(service.mapPatreonTierId).mockReturnValue("supporter-plus");

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/webhooks/patreon", { method: "POST" })
    );

    expect(res.status).toBe(200);
    expect(service.applyPatreonStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId,
        tier: "supporter-plus",
        expiresAt: null,
        adsDisabledDefault: true,
        patreonUserId: "patron-123",
      })
    );
  });

  it("starts grace period for cancellation events", async () => {
    const userId = new ObjectId();
    const webhook = await import("@/lib/patreon/webhook");
    const service = await import("@/lib/patreon/service");

    vi.mocked(webhook.parseAndVerifyPatreonWebhook).mockResolvedValue({
      eventType: "members:delete",
      payload: { data: {} },
      rawBody: "{}",
    });
    vi.mocked(webhook.getPatreonUserIdFromPayload).mockReturnValue("patron-456");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue({ _id: userId } as never);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/webhooks/patreon", { method: "POST" })
    );

    expect(res.status).toBe(200);
    expect(service.startPatreonGracePeriod).toHaveBeenCalledWith(expect.anything(), userId);
  });

  it("returns 202 when patreon user is not linked", async () => {
    const webhook = await import("@/lib/patreon/webhook");
    const service = await import("@/lib/patreon/service");

    vi.mocked(webhook.parseAndVerifyPatreonWebhook).mockResolvedValue({
      eventType: "members:update",
      payload: { data: {} },
      rawBody: "{}",
    });
    vi.mocked(webhook.getPatreonUserIdFromPayload).mockReturnValue("patron-missing");
    vi.mocked(service.findUserByPatreonUserId).mockResolvedValue(null);

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/webhooks/patreon", { method: "POST" })
    );

    expect(res.status).toBe(202);
  });
});
