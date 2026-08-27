import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getVietnamEscalation } from "@/lib/crises/vietnamEscalation";
import { listNuclearPrograms } from "@/lib/db/collections/nuclearPrograms";
import { getConflictsCollection, listActiveConflicts } from "@/lib/db/collections/conflicts";
import { readStandingPressureSnapshot, syncLimitedWarPressureClocks } from "./standingPressure";

vi.mock("@/lib/crises/vietnamEscalation", () => ({ getVietnamEscalation: vi.fn() }));
vi.mock("@/lib/livingConflict/vietnamCompat", () => ({ livingVietnamAsLegacyState: vi.fn() }));
vi.mock("@/lib/db/collections/nuclearPrograms", () => ({ listNuclearPrograms: vi.fn() }));
vi.mock("@/lib/db/collections/conflicts", () => ({
  getConflictsCollection: vi.fn(),
  listActiveConflicts: vi.fn(),
}));

describe("readStandingPressureSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVietnamEscalation).mockResolvedValue({ level: 1 } as never);
    vi.mocked(listNuclearPrograms).mockResolvedValue([
      { _id: "US", warheads: 522 },
      { _id: "RU", warheads: 114 },
      { _id: "UK", warheads: 578 },
    ] as never);
    vi.mocked(listActiveConflicts).mockResolvedValue([
      {
        sideA: { countries: ["US"] },
        sideB: { countries: ["DD", "RU"] },
        intensity: 70,
      },
    ] as never);
  });

  it("resets the limited-war clock while hot and starts it when a war cools", async () => {
    const db = createMockDb();
    const conflicts = db.collection("conflicts");
    vi.mocked(getConflictsCollection).mockReturnValue(conflicts as never);

    await syncLimitedWarPressureClocks(db as unknown as Db, 436);

    expect(conflicts.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        status: { $ne: "resolved" },
        intensity: { $gte: 85 },
        limitedWarSinceTurn: { $exists: true },
      },
      { $unset: { limitedWarSinceTurn: "" } }
    );
    expect(conflicts.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        status: { $ne: "resolved" },
        intensity: { $lt: 85 },
        limitedWarSinceTurn: { $exists: false },
      },
      { $set: { limitedWarSinceTurn: 436 } }
    );
  });

  it("keeps Vietnam separate and counts every active crisis and live war", async () => {
    const db = createMockDb();
    db.collection("crises");
    db.collectionMocks.crises!.countDocuments.mockResolvedValue(6);

    const snapshot = await readStandingPressureSnapshot(db as unknown as Db, {
      livingConflictsEnabled: false,
    });

    expect(db.collectionMocks.crises!.countDocuments).toHaveBeenCalledWith({ status: "active" });
    expect(snapshot).toEqual({
      totalWarheads: 1214,
      warSummary: {
        nuclearWarIntensity: 70,
        otherWarIntensity: 0,
        activeWarCount: 1,
        nuclearWarCount: 1,
        nuclearWarMinimumPressure: 48,
      },
      pressures: {
        escalationLevel: 1,
        activeCrises: 6,
        totalWarheads: 1214,
        nuclearWarIntensity: 70,
        nuclearWarCount: 1,
        nuclearWarMinimumPressure: 48,
        otherWarIntensity: 0,
      },
    });
  });
});
