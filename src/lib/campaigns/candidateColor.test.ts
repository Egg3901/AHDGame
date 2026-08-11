import { describe, expect, it } from "vitest";

import { buildCandidateColorMap } from "./candidateColor";

describe("buildCandidateColorMap", () => {
  it("uses distinct palette colors for contested primaries without reusing the party default", () => {
    const colors = buildCandidateColorMap(
      [{ candidateId: "b" }, { candidateId: "a" }],
      "democrat",
      "#1f4fa3"
    );

    expect(colors.a).toBe("#3B82F6");
    expect(colors.b).toBe("#EF4444");
  });

  it("keeps the party color for single-candidate primaries", () => {
    const colors = buildCandidateColorMap([{ candidateId: "solo" }], "custom-party", "#1f4fa3");

    expect(colors.solo).toBe("#1f4fa3");
  });
});
