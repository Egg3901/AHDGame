import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { atParties } from "@/lib/countries/at/data/atParties";
import { prunePresetMismatchedDefaultParties } from "./ensureDefaultParties";

describe("prunePresetMismatchedDefaultParties", () => {
  it("keeps a party when another era seed with the same identity is active", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 0 });
    const db = {
      collection: vi.fn(() => ({ deleteMany })),
    } as unknown as Db;

    await prunePresetMismatchedDefaultParties(db, atParties, "2027-default");

    const query = deleteMany.mock.calls[0]?.[0] as {
      $or: Array<{ countryId: string; name: string; isDefault: boolean }>;
    };
    expect(query.$or).not.toContainEqual({
      countryId: "AT",
      name: "Österreichische Volkspartei",
      isDefault: true,
    });
  });
});
