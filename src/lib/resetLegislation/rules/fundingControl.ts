/** Portable classification of how Cabinet may request delivery under a law. */
import type { ResetCountry } from "../fundingOwner";
import type { LawChoice } from "./eligibility";

export type LawFundingControl =
  "adjustable" | "required" | "no_separate_allocation" | "externally_settled";

const REQUIRED_FAMILIES = new Set([
  "L01", // Household relief and work credits
  "L02", // Social-insurance benefits and coverage
  "L16", // Effective health coverage
  "L21", // Elder and long-term care
  "L36", // Courts, legal aid and due process
  "L43", // Elections and ballot access
  "L44", // Public records and transparency
  "L45", // Ethics, audit and procurement
  "L46", // Civil liberties and privacy
]);

const REQUIRED_CHOICES: Readonly<Record<string, ReadonlySet<LawChoice>>> = {
  // Debt limits, repayment plans and protected fiscal transfers are not a
  // ministerial service preference after the legislature enacts them.
  L08: new Set(["far_left", "center_left", "center", "center_right", "far_right"]),
  // The three public-access options establish a funded education floor. The
  // portable and open-school options leave delivery amounts discretionary.
  L10: new Set(["far_left", "center_left", "center"]),
  // Common standards and remediation are statutory delivery commitments.
  L12: new Set(["far_left", "center_left", "center"]),
  // Patient caps and the care-price compact create enforceable benefits.
  L17: new Set(["far_left", "center_left", "center"]),
  // Each housing-relief option creates a payment, voucher or tax obligation.
  L23: new Set(["far_left", "center_left", "center", "center_right", "far_right"]),
  // The public food-access options create benefits for eligible households.
  L37: new Set(["far_left", "center_left", "center"]),
  // Public places and the basic family-care compact create guaranteed support.
  L38: new Set(["far_left", "center_left", "center"]),
  // Lawful claims, review rights and due process remain obligations at every rung.
  L49: new Set(["far_left", "center_left", "center", "center_right", "far_right"]),
  // The authored reproductive-care options all retain enforceable care duties.
  L51: new Set(["far_left", "center_left", "center", "center_right", "far_right"]),
};

/**
 * Opening ownership is intentionally narrower than the family-wide rules.
 * A 1991 source may be an adjustable grant or operating program even when a
 * later law in that family can create an entitlement.
 */
const REQUIRED_OPENING_FAMILIES: Readonly<Record<ResetCountry, ReadonlySet<string>>> = {
  US: new Set(["L02", "L08", "L16", "L17", "L37"]),
  UK: new Set(["L02", "L08", "L10", "L16", "L17"]),
  JP: new Set(["L01", "L02", "L08", "L10", "L16", "L21", "L43", "L46"]),
};

export function openingLawFundingControl(input: {
  country: ResetCountry;
  familyId: string;
  annualAllocation: number;
}): LawFundingControl {
  if (!Number.isSafeInteger(input.annualAllocation) || input.annualAllocation < 0) {
    throw new Error(`Invalid opening allocation for ${input.country}:${input.familyId}`);
  }
  if (input.familyId === "L48") return "externally_settled";
  if (input.annualAllocation === 0) return "no_separate_allocation";
  return REQUIRED_OPENING_FAMILIES[input.country].has(input.familyId) ? "required" : "adjustable";
}

export function enactedLawFundingControl(input: {
  familyId: string;
  choice: LawChoice;
  annualAllocation: number;
}): LawFundingControl {
  if (!Number.isSafeInteger(input.annualAllocation) || input.annualAllocation < 0) {
    throw new Error(`Invalid enacted allocation for ${input.familyId}:${input.choice}`);
  }
  if (input.familyId === "L48") return "externally_settled";
  if (input.choice === "leave_to_states" || input.annualAllocation === 0) {
    return "no_separate_allocation";
  }
  if (REQUIRED_FAMILIES.has(input.familyId)) return "required";
  return REQUIRED_CHOICES[input.familyId]?.has(input.choice) ? "required" : "adjustable";
}

export function fundingControlLocksAllocation(control: LawFundingControl): boolean {
  return control !== "adjustable";
}
