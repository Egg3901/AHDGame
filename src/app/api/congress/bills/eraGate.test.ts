import { describe, expect, it } from "vitest";
import { isLegislationTypeActive } from "@/lib/era/legislationCatalog";

// The route gate is a thin wrapper over the resolver; this test pins the
// contract the route relies on (full end-to-end route tests need a DB harness).
describe("congress bill era gate contract", () => {
  it("rejects a windowed type before its window, accepts at/after, accepts when year null", () => {
    expect(isLegislationTypeActive("us_paid_family_leave", 1990)).toBe(false);
    expect(isLegislationTypeActive("us_paid_family_leave", 1993)).toBe(true);
    expect(isLegislationTypeActive("us_paid_family_leave", null)).toBe(true);
  });
});
