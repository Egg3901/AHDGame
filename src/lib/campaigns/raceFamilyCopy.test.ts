import { describe, it, expect } from "vitest";
import type { Election } from "@/lib/db/types";
import { getCampaignCopyForElection } from "./raceFamilyCopy";

describe("getCampaignCopyForElection", () => {
  it("returns presidential copy for electionType === 'president'", () => {
    const copy = getCampaignCopyForElection({ electionType: "president" });
    expect(copy.family).toBe("president");
    expect(copy.swingArea).toBe("swing states");
    expect(copy.mobilizationScope).toBe("national");
    expect(copy.groundGameEffect(3)).toBe("+3% in swing states");
  });

  it("returns statewide copy for senate", () => {
    const copy = getCampaignCopyForElection({ electionType: "senate" });
    expect(copy.family).toBe("statewide");
    expect(copy.swingArea).toBe("swing counties");
    expect(copy.mobilizationScope).toBe("statewide");
    expect(copy.groundGameEffect(6)).toBe("+6% in swing counties");
  });

  it("returns statewide copy for governor", () => {
    const copy = getCampaignCopyForElection({ electionType: "governor" });
    expect(copy.family).toBe("statewide");
    expect(copy.swingArea).toBe("swing counties");
  });

  it("returns district copy for house", () => {
    const copy = getCampaignCopyForElection({ electionType: "house" });
    expect(copy.family).toBe("district");
    expect(copy.swingArea).toBe("swing precincts");
    expect(copy.mobilizationScope).toBe("district");
    expect(copy.groundGameEffect(9)).toBe("+9% in swing precincts");
  });

  it("returns district copy for stateSenate", () => {
    const copy = getCampaignCopyForElection({ electionType: "stateSenate" });
    expect(copy.family).toBe("district");
    expect(copy.swingArea).toBe("swing precincts");
  });

  it("falls back to presidential copy for unknown electionType (defensive)", () => {
    const copy = getCampaignCopyForElection({
      electionType: "unknown-type" as unknown as Election["electionType"],
    });
    expect(copy.family).toBe("president");
    expect(copy.swingArea).toBe("swing states");
  });

  it("falls back to presidential copy for missing electionType", () => {
    const copy = getCampaignCopyForElection({});
    expect(copy.family).toBe("president");
  });

  it("groundGameEffect interpolates the percent argument", () => {
    const presCopy = getCampaignCopyForElection({ electionType: "president" });
    const houseCopy = getCampaignCopyForElection({ electionType: "house" });
    expect(presCopy.groundGameEffect(15)).toBe("+15% in swing states");
    expect(houseCopy.groundGameEffect(15)).toBe("+15% in swing precincts");
  });

  it("each family produces distinct swingArea labels", () => {
    const families = ["president", "senate", "house"] as const;
    const areas = families.map((t) => getCampaignCopyForElection({ electionType: t }).swingArea);
    expect(new Set(areas).size).toBe(3);
  });
});
