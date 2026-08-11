import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("getAlignmentCrisesCollection", () => {
  it("names the alignmentCrises collection", async () => {
    const db = createMockDb();
    const { getAlignmentCrisesCollection } = await import("./alignmentCrises");
    await getAlignmentCrisesCollection(db as unknown as Db);
    expect(db.collection).toHaveBeenCalledWith("alignmentCrises");
  });

  it("is classified in the seed manifest", async () => {
    // Four places register a collection; this is the one bootstrapContract
    // enforces, and it only runs in the full suite.
    const { SEED_MANIFEST } = await import("@/lib/admin/seed/seedManifest");
    const row = SEED_MANIFEST.find((c) => c.name === "alignmentCrises");
    expect(row, "alignmentCrises must be classified or bootstrapContract fails").toBeTruthy();
    expect(row!.category).toBe("runtime");
  });
});
