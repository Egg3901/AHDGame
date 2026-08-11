import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { removeLegacyUKCeremonialIdentity } from "@/lib/admin/seed/seedUK";

describe("removeLegacyUKCeremonialIdentity", () => {
  it("removes only the exact retired ceremonial seed signature", async () => {
    const db = createMockDb();
    const npps = db.collection("npps");
    db.collectionMocks.npps = npps;
    npps.deleteMany.mockResolvedValue({ deletedCount: 1 });
    const log = vi.fn();

    await removeLegacyUKCeremonialIdentity(db as unknown as Db, log);

    expect(npps.deleteMany).toHaveBeenCalledWith({
      _id: new ObjectId("6770000000000000000000a1"),
      countryId: "UK",
      name: "King Charles III",
      politicalInfluence: 0,
      currentOffice: null,
      retiredAt: { $ne: null },
    });
    expect(log).toHaveBeenCalledWith("Removed 1 legacy UK ceremonial identity record(s)");
  });
});
