import { describe, expect, it } from "vitest";
import { enactedLawAllowsCorpMerge } from "./enactedSectorTaking";

describe("enactedLawAllowsCorpMerge", () => {
  it("allows full corp-taking scopes", () => {
    expect(enactedLawAllowsCorpMerge({ scope: "all", carveFraction: 1 })).toBe(true);
    expect(enactedLawAllowsCorpMerge({ scope: "corporations", carveFraction: 1 })).toBe(true);
  });

  it("rejects unowned-only law", () => {
    expect(enactedLawAllowsCorpMerge({ scope: "unowned", carveFraction: 1 })).toBe(false);
  });

  it("rejects partial carves — private remainder is legal", () => {
    expect(enactedLawAllowsCorpMerge({ scope: "all", carveFraction: 0.5 })).toBe(false);
    expect(enactedLawAllowsCorpMerge({ scope: "corporations", carveFraction: 0.4 })).toBe(false);
  });

  it("rejects unknown / missing enactment", () => {
    expect(enactedLawAllowsCorpMerge(undefined)).toBe(false);
  });
});
