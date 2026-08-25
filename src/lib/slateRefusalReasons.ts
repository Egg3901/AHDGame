/**
 * Display labels for `SlateCandidate.refusalReason`, shared by the Slate tab
 * and the party activity feed so a chair reads the same wording in both.
 *
 * Two families: reasons the NPP gave for declining, and reasons the turn's
 * filing pass could not put an accepted row on the ballot (#1181).
 */
import type { SlateRefusalReason } from "@/lib/db/types";

export const SLATE_REFUSAL_LABEL: Record<SlateRefusalReason, string> = {
  low_relationship: "Low Relationship",
  low_ambition: "Low Ambition",
  low_compliance: "Low Compliance",
  race_priority_mismatch: "Race Not a Fit",
  in_other_race: "In Another Race",
  cooldown: "Cooldown Active",
  retired: "Retired",
  // Neutral wording on purpose. The only live producer is a candidate whose
  // home region is not the race's region, but rows written before the UK
  // regional-party gate was removed carry this same reason for a party-level
  // rule. "Not eligible" reads correctly for both.
  ineligible_region: "Not Eligible in This Region",
  slot_taken: "Slot Already Filled",
  party_restricted: "Party Not Eligible for This Race",
  npp_unavailable: "No Longer Available",
  already_slated_elsewhere: "Slated in Another Race",
};

/**
 * Refusals written by the turn's filing pass rather than by the NPP. A row
 * carrying one was never on the ballot and was never withdrawn by a chair.
 */
export const SLATE_FILING_FAILURE_REASONS: ReadonlySet<SlateRefusalReason> = new Set([
  "ineligible_region",
  "slot_taken",
  "party_restricted",
  "npp_unavailable",
  "already_slated_elsewhere",
]);

export function isSlateFilingFailure(reason: SlateRefusalReason | null | undefined): boolean {
  return reason != null && SLATE_FILING_FAILURE_REASONS.has(reason);
}
