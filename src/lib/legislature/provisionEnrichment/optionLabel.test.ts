import { describe, it, expect } from "vitest";
import type { LegislationPolicyOption } from "@/lib/db/types";
import { resolveOptionLabel, splitLegacySnapshot } from "./optionLabel";

function option(over: Partial<LegislationPolicyOption>): LegislationPolicyOption {
  return {
    id: "o1",
    name: "Sectoral Bargaining",
    stance: "left",
    effectDirection: -1,
    economic: -2,
    social: 0,
    ...over,
  } as LegislationPolicyOption;
}

describe("resolveOptionLabel", () => {
  it("keeps name and explanation separate", () => {
    expect(resolveOptionLabel(option({ explanation: "Unions set wages." }))).toEqual({
      name: "Sectoral Bargaining",
      explanation: "Unions set wages.",
    });
  });

  it("keeps option.name even when the explanation contains a colon-space", () => {
    // The legacy combiner dropped option.name here, so the rendered title became
    // a fragment of the explanation. 33 of 2502 seeded explanations hit this.
    const result = resolveOptionLabel(
      option({
        explanation:
          "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages.",
      })
    );
    expect(result.name).toBe("Sectoral Bargaining");
    expect(result.explanation).toBe(
      "The Arbeitsverfassungsgesetz and the Parity Commission: OeGB unions set wages."
    );
  });

  it("omits explanation when the option has none", () => {
    expect(resolveOptionLabel(option({ explanation: undefined }))).toEqual({
      name: "Sectoral Bargaining",
    });
  });
});

describe("splitLegacySnapshot", () => {
  it("splits a combined label on the first colon-space", () => {
    expect(splitLegacySnapshot("Statutory Electoral Commission Act: maintain remit")).toEqual({
      name: "Statutory Electoral Commission Act",
      explanation: "maintain remit",
    });
  });

  it("keeps later colon-spaces in the explanation", () => {
    expect(splitLegacySnapshot("A: b: c")).toEqual({ name: "A", explanation: "b: c" });
  });

  it("returns a name-only label when there is no separator", () => {
    expect(splitLegacySnapshot("Sectoral Bargaining")).toEqual({ name: "Sectoral Bargaining" });
  });

  it("returns undefined for empty input", () => {
    expect(splitLegacySnapshot(undefined)).toBeUndefined();
    expect(splitLegacySnapshot(null)).toBeUndefined();
    expect(splitLegacySnapshot("")).toBeUndefined();
  });
});
