import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { RESET_V2_SEED_REVISION } from "@/lib/resetVersions/rules";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/resetVersions/availability", () => ({
  RESET_V2_READY: { metrics: true, legislation: true, cabinet: true, demographics: true },
}));

function request(
  system: "metrics" | "legislation" | "cabinet" | "demographics",
  value: "v1" | "v2"
) {
  return new Request("http://localhost/api/admin/feature-gates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "reset-system-version", system, value }),
  });
}

describe("reset system version dependency and concurrent admin changes", () => {
  let db: MockDb;
  const migrated = {
    resetWorldId: "world-a",
    resetVersionSeeds: {
      metrics: {
        worldId: "world-a",
        revision: RESET_V2_SEED_REVISION.metrics,
        sourceTurn: 42,
        completedAt: "2026-09-29T00:00:00.000Z",
        verificationHash: "verified-metrics",
      },
      legislation: {
        worldId: "world-a",
        revision: RESET_V2_SEED_REVISION.legislation,
        sourceTurn: 42,
        completedAt: "2026-09-29T00:00:00.000Z",
        verificationHash: "verified-legislation",
      },
      cabinet: {
        worldId: "world-a",
        revision: RESET_V2_SEED_REVISION.cabinet,
        sourceTurn: 42,
        completedAt: "2026-09-29T00:00:00.000Z",
        verificationHash: "verified-cabinet",
      },
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "tester" },
    } as never);
  });

  it("does not display dependent v2 when Metrics is still v1", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      ...migrated,
      legislationSystemVersion: "v2",
      cabinetSystemVersion: "v2",
    });
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      resetSystemVersions: {
        metrics: "v1",
        legislation: "v1",
        cabinet: "v1",
        demographics: "v1",
      },
    });
  });

  it("requires Metrics v2 before legislation or Cabinet v2", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });
    const { POST } = await import("./route");
    for (const system of ["legislation", "cabinet"] as const) {
      const response = await POST(request(system, "v2"));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringMatching(/Metrics v2/),
      });
    }
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });

  it("stages Demographics v2 independently of Metrics", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });
    const { POST } = await import("./route");
    const response = await POST(request("demographics", "v2"));
    expect(response.status).toBe(200);
    const [, update] = db.collection("gameState").updateOne.mock.calls[0];
    expect(update.$set["resetSystemSelections.demographics"]).toBe("v2");
    expect(update.$set).not.toHaveProperty("demographicsSystemVersion");
  });

  it("uses a conditional write so concurrent selection changes cannot be lost", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      ...migrated,
      metricsSystemVersion: "v2",
    });
    const { POST } = await import("./route");
    const response = await POST(request("legislation", "v2"));
    expect(response.status).toBe(200);
    const [filter] = db.collection("gameState").updateOne.mock.calls[0];
    expect(filter).toMatchObject({
      _id: "current",
      resetWorldId: "world-a",
      "resetSystemSelections.metrics": { $exists: false },
      "resetSystemSelections.legislation": { $exists: false },
    });
    const [, update] = db.collection("gameState").updateOne.mock.calls[0];
    expect(update.$set["resetSystemSelections.legislation"]).toBe("v2");
    expect(update.$set).not.toHaveProperty("legislationSystemVersion");
  });

  it("rejects a Metrics downgrade while a dependent v2 remains selected", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      ...migrated,
      metricsSystemVersion: "v2",
      cabinetSystemVersion: "v2",
    });
    const { POST } = await import("./route");
    const response = await POST(request("metrics", "v1"));
    expect(response.status).toBe(409);
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });

  it("returns a conflict if another admin changed the world before the conditional write", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      ...migrated,
      metricsSystemVersion: "v2",
    });
    db.collection("gameState").updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const { POST } = await import("./route");
    const response = await POST(request("cabinet", "v2"));
    expect(response.status).toBe(409);
  });

  it("stages v2 without converting the current world", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });
    const { POST } = await import("./route");
    const response = await POST(request("metrics", "v2"));
    expect(response.status).toBe(200);
    const [, update] = db.collection("gameState").updateOne.mock.calls[0];
    expect(update.$set["resetSystemSelections.metrics"]).toBe("v2");
    expect(update.$set).not.toHaveProperty("metricsSystemVersion");
    await expect(response.json()).resolves.toMatchObject({
      resetSystemVersions: { metrics: "v1" },
    });
  });

  it("allows next-reset staging while the current world is active", async () => {
    const { POST } = await import("./route");
    for (const unsafe of [{ isActive: true }, { isProcessing: true }, { processingKind: "turn" }]) {
      db.collection("gameState").findOne.mockResolvedValue({
        _id: "current",
        ...migrated,
        ...unsafe,
      });
      const response = await POST(request("metrics", "v2"));
      expect(response.status).toBe(200);
    }
    expect(db.collection("gameState").updateOne).toHaveBeenCalledTimes(3);
  });

  it("stages v1 for the next reset without rolling back an active v2 turn", async () => {
    const { POST } = await import("./route");
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      ...migrated,
      metricsSystemVersion: "v2",
      isProcessing: true,
    });
    expect((await POST(request("metrics", "v1"))).status).toBe(200);
    const [, update] = db.collection("gameState").updateOne.mock.calls[0];
    expect(update.$set["resetSystemSelections.metrics"]).toBe("v1");
    expect(update.$set).not.toHaveProperty("metricsSystemVersion");
  });
});
