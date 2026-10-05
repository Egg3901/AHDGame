import { describe, expect, it } from "vitest";
import references from "@/lib/resetLegislation/openingLawReferences.json";
import { fitReviewedOpeningClaims1991 } from "./openingSourceClaims1991";

describe("reviewed 1991 source obligation guard", () => {
  it("retains named grant costs while preserving the original legal crosswalk", () => {
    const before = JSON.stringify(references);
    expect(
      fitReviewedOpeningClaims1991("UK", references).sourceAllocations.uk_local_government_funding
    ).toBe(16_399_000_000);
    expect(
      fitReviewedOpeningClaims1991("JP", references).sourceAllocations.jp_local_allocation_tax
    ).toBe(15_872_000_000_000);
    expect(JSON.stringify(references)).toBe(before);
  });

  it("requires review when curated source obligations drift", () => {
    const changed = references.map((reference) => ({
      ...reference,
      sourceComponents: reference.sourceComponents.map((component) =>
        reference.country === "US" &&
        reference.scope === "national" &&
        component.sourceId === "us_public_health" &&
        component.fiscalRole === "single-booked-owner"
          ? { ...component, annualBooked: component.annualBooked + 1 }
          : component
      ),
    }));
    expect(() => fitReviewedOpeningClaims1991("US", changed)).toThrow("source obligations changed");
  });
});
