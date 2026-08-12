import { describe, it, expect } from "vitest";
import {
  canTableResolutionType,
  ORGANIZATION_CATEGORY_META,
  IMPLEMENTED_RESOLUTION_TYPES,
} from "@/lib/constants/orgCategory";

describe("join_conflict is a bloc-only power", () => {
  it("is tableable by a bloc", () => {
    expect(canTableResolutionType("bloc", "join_conflict")).toBe(true);
  });

  it("is refused to every other category", () => {
    for (const c of ["security", "political", "economic", "development"] as const) {
      expect(canTableResolutionType(c, "join_conflict"), c).toBe(false);
    }
  });

  it("is NOT a baseline power", () => {
    // canTableResolutionType ORs the category powers with BASELINE_POWERS, so adding
    // it there would silently grant war entry to political forums and dev banks.
    for (const c of ["political", "development"] as const) {
      expect(ORGANIZATION_CATEGORY_META[c].powers).not.toContain("join_conflict");
    }
    expect(canTableResolutionType("political", "join_conflict")).toBe(false);
  });

  it("is implemented", () => {
    expect(IMPLEMENTED_RESOLUTION_TYPES).toContain("join_conflict");
  });
});
