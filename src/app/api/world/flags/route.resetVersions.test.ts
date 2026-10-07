import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("world flags reset versions", () => {
  it("shows effective v1 while v2 is unready, even if a future reset was selected", async () => {
    const db = createMockDb();
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      resetSystemSelections: { metrics: "v2", legislation: "v2", cabinet: "v2" },
      metricsSystemVersion: "v1",
      legislationSystemVersion: "v1",
      cabinetSystemVersion: "v1",
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();
    expect(body.resetSystemVersions).toEqual({
      metrics: "v1",
      legislation: "v1",
      cabinet: "v1",
      demographics: "v1",
    });
    expect(body.resetV2Countries).toEqual([]);
    expect(db.collectionMocks.gameState!.findOne.mock.calls[0]![1]?.projection).toMatchObject({
      resetWorldId: 1,
      resetVersionSeeds: 1,
    });
  });

  it("reports only countries whose v2 metrics receipt covers the live world", async () => {
    const db = createMockDb();
    const receipt = (countries?: string[]) => ({
      worldId: "world-a",
      revision: 3,
      sourceTurn: 1,
      completedAt: "2026-10-06T00:00:00.000Z",
      verificationHash: "verified",
      countries,
    });
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      resetWorldId: "world-a",
      metricsSystemVersion: "v2",
      legislationSystemVersion: "v1",
      cabinetSystemVersion: "v1",
      resetVersionSeeds: { metrics: receipt(["US", "UK", "JP", "IE", "SCO"]) },
    });
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.resetV2Countries).toEqual(["US", "UK", "JP", "IE", "SCO"]);
  });
});
