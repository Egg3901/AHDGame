/**
 * Race-family copy adapter for Campaign Manager surfaces.
 *
 * Phase 5.5 newly enables US senate / governor / house / state-senate
 * races. The Campaign Manager's underlying mechanic (mobilization boost
 * in competitive areas, fundraising scale, opposition research target)
 * is identical across race families — only the player-facing language
 * needs to localize:
 *  - President: "swing states" / "national mobilization"
 *  - Statewide (Senate / Gov): "swing counties" / "statewide mobilization"
 *  - District (House / State Senate): "swing precincts" / "district mobilization"
 *
 * Per Phase 5.5 D5, this is a typed adapter that DTO and effect-string
 * surfaces consult. Mechanic stays unified; copy stays honest.
 *
 * See plan §"Phase 5.5 — Decisions Recorded During Execution" D5.
 */

import type { Election } from "@/lib/db/types";

export type CampaignRaceFamily = "president" | "statewide" | "district";

export interface CampaignRaceFamilyCopy {
  family: CampaignRaceFamily;
  /** Where the ground game operates: "swing states" / "swing counties" / "swing precincts". */
  swingArea: string;
  /** Mobilization scope label: "national" / "statewide" / "district". */
  mobilizationScope: string;
  /**
   * Effect-string template for ground-game upgrade levels. Returns a
   * sentence fragment matching the pre-Phase-5.5 format (e.g. "+3% in
   * swing states") with race-family-correct wording.
   */
  groundGameEffect(percent: number): string;
  /** Long-form description for ground game upgrade UI. */
  groundGameDescription: string;
}

/**
 * Resolve the race-family copy for an election by `electionType`.
 *
 * Defensive: unknown election types fall back to presidential copy
 * (with a console warning in dev). Non-Phase-5.5-eligible types still
 * get reasonable copy because callers should already gate on
 * `isCampaignEligibleElection` before reaching this function — the
 * fallback is a belt-and-suspenders default.
 */
export function getCampaignCopyForElection(
  election: Pick<Partial<Election>, "electionType">
): CampaignRaceFamilyCopy {
  switch (election.electionType) {
    case "president":
      return {
        family: "president",
        swingArea: "swing states",
        mobilizationScope: "national",
        groundGameEffect: (percent) => `+${percent}% in swing states`,
        groundGameDescription:
          "Each level adds +3% performance in swing states. Has ongoing maintenance costs per turn.",
      };
    case "senate":
    case "governor":
      return {
        family: "statewide",
        swingArea: "swing counties",
        mobilizationScope: "statewide",
        groundGameEffect: (percent) => `+${percent}% in swing counties`,
        groundGameDescription:
          "Each level adds +3% performance in swing counties (statewide ground game). Has ongoing maintenance costs per turn.",
      };
    case "house":
    case "stateSenate":
      return {
        family: "district",
        swingArea: "swing precincts",
        mobilizationScope: "district",
        groundGameEffect: (percent) => `+${percent}% in swing precincts`,
        groundGameDescription:
          "Each level adds +3% performance in swing precincts (district ground game). Has ongoing maintenance costs per turn.",
      };
    default:
      // Defensive fallback. Callers should gate on isCampaignEligibleElection
      // before reaching this — the presidential default keeps existing copy
      // visible if eligibility expands faster than this adapter.
      return {
        family: "president",
        swingArea: "swing states",
        mobilizationScope: "national",
        groundGameEffect: (percent) => `+${percent}% in swing states`,
        groundGameDescription:
          "Each level adds +3% performance in swing states. Has ongoing maintenance costs per turn.",
      };
  }
}
