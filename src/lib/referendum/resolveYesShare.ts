/**
 * Single source of truth for a referendum's canonical Yes share. With a cohort
 * baseline it is the turnout-weighted aggregate (PS spend folded in as a
 * uniform lean shift); without one it falls back to the legacy scalar
 * derivation. Always recompute — never trust the stored `yesShare`.
 */
import type { Referendum } from "@/lib/db/types/referendum";
import { deriveCampaignYesShare } from "@/lib/constants/referendum";
import { aggregateYesShare, leanFromUnits } from "./cohortEngine";

export function referendumYesShare(
  ref: Pick<
    Referendum,
    | "cohortBaseline"
    | "cohortModifiers"
    | "campaignSpendUnits"
    | "campaignBaseYesShare"
    | "yesShare"
  >
): number {
  const base = ref.campaignBaseYesShare ?? ref.yesShare;
  const yes = ref.campaignSpendUnits?.yes ?? 0;
  const no = ref.campaignSpendUnits?.no ?? 0;
  if (ref.cohortBaseline && ref.cohortBaseline.length > 0) {
    return aggregateYesShare(ref.cohortBaseline, ref.cohortModifiers ?? [], leanFromUnits(yes, no));
  }
  return deriveCampaignYesShare(base, yes, no);
}
