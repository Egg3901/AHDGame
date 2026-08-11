import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("getAlignmentPlaysCollection", () => {
  it("names the alignmentPlays collection", async () => {
    const db = createMockDb();
    const { getAlignmentPlaysCollection } = await import("./alignmentPlays");
    await getAlignmentPlaysCollection(db as unknown as Db);
    expect(db.collection).toHaveBeenCalledWith("alignmentPlays");
  });

  it("is classified in the seed manifest", async () => {
    // A Mongo collection must be classified in FOUR places; this is the one the
    // bootstrap contract test enforces, and it only runs in the full suite.
    const { SEED_MANIFEST } = await import("@/lib/admin/seed/seedManifest");
    const row = SEED_MANIFEST.find((c) => c.name === "alignmentPlays");
    expect(row, "alignmentPlays must be classified or bootstrapContract fails").toBeTruthy();
    expect(row!.category).toBe("runtime");
  });
});
