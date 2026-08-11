import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { resetCabinetSettingCooldowns } from "./cabinetSettings";

describe("resetCabinetSettingCooldowns", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("cabinetSettings");
  });

  it("unsets both per-holder cooldown timestamps for the position", async () => {
    await resetCabinetSettingCooldowns(db as unknown as Db, "US", "secretary_of_treasury");

    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "US_secretary_of_treasury" },
      { $unset: { lastChangedTurn: "", lastAllocationChangedTurn: "" } }
    );
  });

  it("does not upsert — leaves positions without a settings document untouched", async () => {
    await resetCabinetSettingCooldowns(db as unknown as Db, "CN", "vice_premier");

    const call = db.collectionMocks.cabinetSettings.updateOne.mock.calls[0];
    // No options argument => no { upsert: true }, so an absent doc stays absent.
    expect(call[2]).toBeUndefined();
  });
});
