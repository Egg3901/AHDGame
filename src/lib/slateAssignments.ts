import type { NPP } from "@/lib/db/types";

export const SLATE_NPP_LOYALTY_THRESHOLD = 40;
export const SLATE_NPP_STUBBORNNESS_THRESHOLD = 70;

interface SlateComplianceOptions {
  loyaltyRequirementReduction?: number;
  stubbornnessAllowanceBonus?: number;
}

/**
 * Manual slate assignments only auto-file NPPs who are loyal enough to follow
 * party direction and not so stubborn that they routinely ignore leadership.
 * The exact thresholds intentionally match the current "discipline watch"
 * mental model so party leaders can reason about the behavior.
 */
export function isNppSlateCompliant(
  npp: Pick<NPP, "personality">,
  options: SlateComplianceOptions = {}
): boolean {
  const loyalty = npp.personality?.loyalty ?? 50;
  const stubbornness = npp.personality?.stubbornness ?? 50;
  const loyaltyThreshold = SLATE_NPP_LOYALTY_THRESHOLD - (options.loyaltyRequirementReduction ?? 0);
  const stubbornnessThreshold =
    SLATE_NPP_STUBBORNNESS_THRESHOLD + (options.stubbornnessAllowanceBonus ?? 0);
  return loyalty >= loyaltyThreshold && stubbornness <= stubbornnessThreshold;
}

export function computeSlateAssignmentScore(npp: Pick<NPP, "personality">): number {
  const loyalty = npp.personality?.loyalty ?? 50;
  const stubbornness = npp.personality?.stubbornness ?? 50;
  return Math.round((loyalty * 0.65 + (100 - stubbornness) * 0.35) * 10) / 10;
}
