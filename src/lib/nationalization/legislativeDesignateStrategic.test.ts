import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("applyDesignateStrategicSectorProvision", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("gameState");
    db.collection("strategicSectorDesignations");
  });

  it("upserts a strategic-sector designation for the bill's country (source legislation)", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 30 });
    const { applyDesignateStrategicSectorProvision } =
      await import("./legislativeDesignateStrategic");
    await applyDesignateStrategicSectorProvision(db as unknown as Db, "US", {
      type: "designate_strategic_sector",
      sectorType: "energy",
    });

    const upd = db.collectionMocks.strategicSectorDesignations.updateOne.mock.calls[0];
    expect(upd[0]).toEqual({ countryId: "US", sectorType: "energy" });
    expect(upd[1].$set.source).toBe("legislation");
    expect(upd[1].$set.designatedAtTurn).toBe(30);
    expect(upd[2]).toEqual({ upsert: true });
  });

  it("is a no-op when the country is already at the strategic-sector cap", async () => {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 30 });
    // Five already designated (the cap), none of which is the new sector type.
    db.collectionMocks.strategicSectorDesignations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        ["energy", "technology", "defense", "financial", "telecommunications"].map((s) => ({
          sectorType: s,
        }))
      ),
    } as never);

    const { applyDesignateStrategicSectorProvision } =
      await import("./legislativeDesignateStrategic");
    await applyDesignateStrategicSectorProvision(db as unknown as Db, "US", {
      type: "designate_strategic_sector",
      sectorType: "agriculture", // a sixth — over the cap
    });

    expect(db.collectionMocks.strategicSectorDesignations.updateOne).not.toHaveBeenCalled();
  });
});
