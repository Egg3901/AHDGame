import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { removeLegacyJPCeremonialIdentity } from "@/lib/admin/seed/seedJP";

describe("removeLegacyJPCeremonialIdentity", () => {
  it("removes only the exact retired ceremonial seed signature", async () => {
    const db = createMockDb();
    const npps = db.collection("npps");
    db.collectionMocks.npps = npps;
    npps.deleteMany.mockResolvedValue({ deletedCount: 1 });
    const log = vi.fn();

    await removeLegacyJPCeremonialIdentity(db as unknown as Db, log);

    expect(npps.deleteMany).toHaveBeenCalledWith({
      countryId: "JP",
      name: "Emperor Naruhito",
      politicalInfluence: 0,
      currentOffice: null,
      retiredAt: { $ne: null },
    });
    expect(log).toHaveBeenCalledWith("Removed 1 legacy JP ceremonial identity record(s)");
  });
});
