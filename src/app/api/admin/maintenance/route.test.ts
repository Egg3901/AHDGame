import { describe, expect, it, vi, beforeEach } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn(async () => undefined) }));

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/maintenance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function setup() {
  vi.clearAllMocks();
  vi.resetModules();
  const db: MockDb = createMockDb();

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { username: "admin1" },
  } as never);

  return db;
}

describe("PATCH /api/admin/maintenance — tri-state mode", () => {
  it("accepts mode='partial' and writes it with the audit fields", async () => {
    const db = await setup();
    const { PATCH } = await import("./route");
    const { createAdminLog } = await import("@/lib/adminLog");

    const res = await PATCH(
      patchRequest({ mode: "partial", reason: "Deploying a hotfix", expectedEnd: "" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, mode: "partial", enabled: true });

    const updateOne = db.collectionMocks.gameConfig!.updateOne;
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.maintenanceMode).toBe("partial");
    expect(update.$set.maintenanceReason).toBe("Deploying a hotfix");
    expect(update.$set.maintenanceEnabledBy).toBe("admin1");

    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "maintenance_mode_set" })
    );
  });

  it("accepts mode='full' and writes it", async () => {
    const db = await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ mode: "full", reason: "Hard lockout" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, mode: "full", enabled: true });
    const [, update] = db.collectionMocks.gameConfig!.updateOne.mock.calls[0];
    expect(update.$set.maintenanceMode).toBe("full");
  });

  it("accepts mode='off' and unsets the audit fields", async () => {
    const db = await setup();
    const { PATCH } = await import("./route");
    const { createAdminLog } = await import("@/lib/adminLog");

    const res = await PATCH(patchRequest({ mode: "off" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, mode: "off", enabled: false });

    const [, update] = db.collectionMocks.gameConfig!.updateOne.mock.calls[0];
    expect(update.$set.maintenanceMode).toBe("off");
    expect(update.$unset).toMatchObject({
      maintenanceReason: "",
      maintenanceExpectedEnd: "",
      maintenanceEnabledBy: "",
      maintenanceEnabledAt: "",
    });
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "maintenance_mode_disabled" })
    );
  });

  it("rejects an invalid mode with 400", async () => {
    await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ mode: "enabled" }));
    expect(res.status).toBe(400);
  });

  it("rejects a request with no mode at all", async () => {
    await setup();
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({}));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/maintenance — normalized mode in response", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes a legacy boolean true doc to mode: 'full'", async () => {
    const db = await setup();
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({
      _id: "default",
      maintenanceMode: true,
    });

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(body.mode).toBe("full");
    expect(body.enabled).toBe(true);
  });

  it("reports mode: 'off' and enabled: false when absent", async () => {
    const db = await setup();
    db.collection("gameConfig");
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(body.mode).toBe("off");
    expect(body.enabled).toBe(false);
  });
});
