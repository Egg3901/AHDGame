import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { syncSuspiciousFlagsForBanState } from "./syncSuspiciousFlagsForBanState";

describe("syncSuspiciousFlagsForBanState", () => {
  it("ban resolves the user's non-resolved flags, marked resolvedByBan", async () => {
    const db = createMockDb();
    const userId = new ObjectId();

    await syncSuspiciousFlagsForBanState(db as never, userId, true);

    const updateMany = db.collectionMocks["suspiciousCharacters"]!.updateMany;
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0]!;
    expect(filter).toMatchObject({ userId, pool: { $ne: "resolved" } });
    expect(update.$set).toMatchObject({
      pool: "resolved",
      dismissed: true,
      resolvedByBan: true,
    });
  });

  it("unban restores only ban-resolved flags to active and clears the marker", async () => {
    const db = createMockDb();
    const userId = new ObjectId();

    await syncSuspiciousFlagsForBanState(db as never, userId, false);

    const updateMany = db.collectionMocks["suspiciousCharacters"]!.updateMany;
    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0]!;
    expect(filter).toMatchObject({ userId, resolvedByBan: true });
    expect(update.$set).toMatchObject({ pool: "active", dismissed: false });
    expect(update.$unset).toMatchObject({ resolvedByBan: "" });
  });
});
