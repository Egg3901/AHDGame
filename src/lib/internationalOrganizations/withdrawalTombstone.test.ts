import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const FIXED_NOW = new Date("2026-06-25T16:00:00.000Z");

describe("withdrawalTombstone", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("recordOrganizationWithdrawal upserts a tombstone keyed by (org, country)", async () => {
    const { recordOrganizationWithdrawal } = await import("./withdrawalTombstone");
    await recordOrganizationWithdrawal(db as unknown as Db, "NATO", "DE", 628, FIXED_NOW);

    const updateOne = db.collectionMocks.organizationWithdrawals!.updateOne;
    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update, opts] = updateOne.mock.calls[0];
    expect(filter).toEqual({ organizationId: "NATO", countryId: "DE" });
    expect(update.$set).toEqual({ withdrawnTurn: 628, withdrawnAt: FIXED_NOW });
    expect(update.$setOnInsert.organizationId).toBe("NATO");
    expect(update.$setOnInsert.countryId).toBe("DE");
    expect(opts).toEqual({ upsert: true });
  });

  it("clearOrganizationWithdrawal deletes the tombstone for (org, country)", async () => {
    const { clearOrganizationWithdrawal } = await import("./withdrawalTombstone");
    await clearOrganizationWithdrawal(db as unknown as Db, "NATO", "DE");

    const deleteOne = db.collectionMocks.organizationWithdrawals!.deleteOne;
    expect(deleteOne).toHaveBeenCalledWith({ organizationId: "NATO", countryId: "DE" });
  });

  it("loadWithdrawnMemberKeys returns a Set of org/country keys", async () => {
    const cursor = {
      toArray: vi.fn().mockResolvedValue([
        { organizationId: "NATO", countryId: "DE" },
        { organizationId: "EU", countryId: "IE" },
      ]),
      project: vi.fn().mockReturnThis(),
    };
    db.collection("organizationWithdrawals").find.mockReturnValue(cursor);

    const { loadWithdrawnMemberKeys, withdrawalKey } = await import("./withdrawalTombstone");
    const keys = await loadWithdrawnMemberKeys(db as unknown as Db);

    expect(keys.has(withdrawalKey("NATO", "DE"))).toBe(true);
    expect(keys.has(withdrawalKey("EU", "IE"))).toBe(true);
    expect(keys.has(withdrawalKey("NATO", "US"))).toBe(false);
  });
});
