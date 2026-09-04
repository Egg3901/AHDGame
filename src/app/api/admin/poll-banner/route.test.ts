import { describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn(async () => undefined) }));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/poll-banner", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = {
  enabled: true,
  message: "Please fill out the survey here for feedback about the game:",
  linkLabel: "Click Here",
  url: "https://forms.gle/abc123",
  tone: "info",
};

async function setup({ admin = true }: { admin?: boolean } = {}) {
  vi.clearAllMocks();
  const db: MockDb = createMockDb();

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue(
    admin
      ? ({ ok: true, admin: { username: "admin1" } } as never)
      : ({
          ok: false,
          response: new Response(null, { status: 403 }),
        } as never)
  );

  return db;
}

describe("PATCH /api/admin/poll-banner", () => {
  it("saves an enabled banner with the audit fields", async () => {
    const db = await setup();
    const { PATCH } = await import("./route");
    const { createAdminLog } = await import("@/lib/adminLog");

    const res = await PATCH(patchRequest(VALID));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, enabled: true });

    const updateOne = db.collectionMocks.gameConfig!.updateOne;
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.pollBannerEnabled).toBe(true);
    expect(update.$set.pollBannerUrl).toBe("https://forms.gle/abc123");
    expect(update.$set.pollBannerTone).toBe("info");
    expect(update.$set.pollBannerUpdatedBy).toBe("admin1");

    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "poll_banner_set", category: "system" })
    );
  });

  it("keeps the drafted text on disk when the banner is switched off", async () => {
    const db = await setup();
    const { PATCH } = await import("./route");
    const { createAdminLog } = await import("@/lib/adminLog");

    const res = await PATCH(patchRequest({ ...VALID, enabled: false }));
    expect(res.status).toBe(200);

    const [, update] = db.collectionMocks.gameConfig!.updateOne.mock.calls[0];
    expect(update.$set.pollBannerEnabled).toBe(false);
    expect(update.$set.pollBannerMessage).toBe(VALID.message);
    expect(update.$set.pollBannerUrl).toBe(VALID.url);
    expect(update.$unset).toBeUndefined();

    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "poll_banner_disabled" })
    );
  });

  it("rejects a javascript: url with 400 and writes nothing", async () => {
    const db = await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ ...VALID, url: "javascript:alert(1)" }));

    expect(res.status).toBe(400);
    // The collection is never even opened, so nothing could have been written.
    expect(db.collectionMocks.gameConfig).toBeUndefined();
  });

  it("rejects a site-relative url with 400", async () => {
    await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ ...VALID, url: "/actions/poll" }));
    expect(res.status).toBe(400);
  });

  it("refuses to enable a banner with no url", async () => {
    await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ ...VALID, url: "" }));
    expect(res.status).toBe(400);
  });

  it("refuses to enable a banner with a blank message", async () => {
    await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ ...VALID, message: "   " }));
    expect(res.status).toBe(400);
  });

  it("allows saving an empty draft while the banner stays off", async () => {
    const db = await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(
      patchRequest({ enabled: false, message: "", linkLabel: "", url: "", tone: "info" })
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.gameConfig!.updateOne).toHaveBeenCalledTimes(1);
  });

  it("rejects a message longer than the stored limit", async () => {
    await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ ...VALID, message: "x".repeat(301) }));
    expect(res.status).toBe(400);
  });

  it("rejects an unrecognized tone", async () => {
    await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ ...VALID, tone: "danger" }));
    expect(res.status).toBe(400);
  });

  it("refuses a non-admin caller", async () => {
    const db = await setup({ admin: false });
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest(VALID));
    expect(res.status).toBe(403);
    // The collection is never even opened, so nothing could have been written.
    expect(db.collectionMocks.gameConfig).toBeUndefined();
  });
});

describe("GET /api/admin/poll-banner", () => {
  it("returns the drafted text even while the banner is disabled", async () => {
    const db = await setup();
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      pollBannerEnabled: false,
      pollBannerMessage: "Survey time:",
      pollBannerLinkLabel: "Here",
      pollBannerUrl: "https://example.com/s",
      pollBannerTone: "warning",
      pollBannerUpdatedBy: "admin1",
    });

    const { GET } = await import("./route");
    const body = await (await GET()).json();

    expect(body).toMatchObject({
      enabled: false,
      message: "Survey time:",
      linkLabel: "Here",
      url: "https://example.com/s",
      tone: "warning",
      updatedBy: "admin1",
    });
  });

  it("returns empty defaults when nothing has ever been saved", async () => {
    const db = await setup();
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const body = await (await GET()).json();

    expect(body).toMatchObject({ enabled: false, message: "", url: "", tone: "info" });
  });

  it("refuses a non-admin caller", async () => {
    await setup({ admin: false });
    const { GET } = await import("./route");

    const res = await GET();
    expect(res.status).toBe(403);
  });
});
