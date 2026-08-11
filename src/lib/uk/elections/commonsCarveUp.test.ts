import { describe, it, expect } from "vitest";
import { buildCommonsCarveUpSlices } from "./commonsCarveUp";
import type { ElectionDisplay } from "@/lib/db/types";

describe("buildCommonsCarveUpSlices", () => {
  it("normalizes polling shares into carve-up slices", () => {
    const election = {
      id: "e1",
      electionType: "commons",
      state: "SCO",
      countryId: "UK",
      cycle: 1,
      status: "active",
      totalSeats: 59,
      candidates: [
        {
          id: "c1",
          characterId: "a",
          characterName: "A",
          party: "1",
          partyName: "SNP",
          partyColor: "#FFF95D",
        },
        {
          id: "c2",
          characterId: "b",
          characterName: "B",
          party: "2",
          partyName: "Labour",
          partyColor: "#E4003B",
        },
      ],
      polling: {
        leaderId: "c1",
        leaderName: "A",
        leaderParty: "1",
        sharesPct: { c1: 60, c2: 40 },
        candidateNames: {},
        candidateParties: {},
        source: "general" as const,
      },
    } as ElectionDisplay;

    const { slices, topDemographics } = buildCommonsCarveUpSlices(election);
    expect(slices).toHaveLength(2);
    expect(slices[0].pct + slices[1].pct).toBeCloseTo(100, 5);
    expect(topDemographics.some((d) => /Scot|Yes/i.test(d))).toBe(true);
  });
});
