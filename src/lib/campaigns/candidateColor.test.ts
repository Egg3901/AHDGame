import { describe, expect, it } from "vitest";

import {
  MIN_CANDIDATE_COLOR_DISTANCE,
  buildCandidateColorMap,
  colorDistance,
} from "./candidateColor";

describe("buildCandidateColorMap", () => {
  it("uses distinct palette colors for contested primaries without reusing the party default", () => {
    const colors = buildCandidateColorMap(
      [{ candidateId: "b" }, { candidateId: "a" }],
      "democrat",
      "#1f4fa3"
    );

    expect(colors.a).toBe("#4F8EF7");
    expect(colors.b).toBe("#F2A93B");
  });

  it("keeps a campaign colour unless it duplicates a rival's", () => {
    const colors = buildCandidateColorMap(
      [
        { candidateId: "a", campaignColor: "#9333EA" },
        { candidateId: "b", campaignColor: "#9534EC" },
        { candidateId: "c", campaignColor: "#10B981" },
      ],
      "democrat",
      "#1f4fa3"
    );
    expect(colors.a).toBe("#9333EA");
    expect(colors.c).toBe("#10B981");
    // b chose nearly a's purple, so it gets a palette colour instead.
    expect(colors.b).not.toBe("#9534EC");
    expect(colorDistance(colors.b, colors.a)).toBeGreaterThanOrEqual(MIN_CANDIDATE_COLOR_DISTANCE);
  });

  it("keeps the party color for single-candidate primaries", () => {
    const colors = buildCandidateColorMap([{ candidateId: "solo" }], "custom-party", "#1f4fa3");

    expect(colors.solo).toBe("#1f4fa3");
  });
});
