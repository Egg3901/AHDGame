import { describe, expect, it } from "vitest";
import { INTELLIGENCE_COLLECTIONS } from "@/lib/db/collections/intelligence";
import { findUnclassifiedCollections } from "@/lib/admin/seed/seedManifest";

describe("intelligence collections", () => {
  it("classifies every intelligence collection in the seed manifest", () => {
    // These are reached through constant-held names, which bootstrapContract's
    // literal scan cannot see. If this fails, a world reset will silently
    // preserve intelligence state.
    expect(findUnclassifiedCollections([...INTELLIGENCE_COLLECTIONS])).toEqual([]);
  });
});
