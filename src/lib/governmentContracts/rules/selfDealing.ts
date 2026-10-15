import { GOVT_CONTRACT_MAX_TOTAL_SHARE } from "@/lib/constants/prospecting";
import { selfDealingFavorabilityPenalty } from "@/lib/military/defenceSelfDealing";
import type { TenderTerms } from "../types";

/** Extraction measures the resource concession, so a zero signing fee cannot hide its size. */
export function tenderSelfDealingPenalty(
  terms: TenderTerms,
  amount: number,
  defenceTranche: number
): number {
  return selfDealingFavorabilityPenalty(
    terms.type === "defence"
      ? { contractValue: terms.lots * amount, tranche: defenceTranche }
      : { contractValue: terms.share, tranche: GOVT_CONTRACT_MAX_TOTAL_SHARE }
  );
}
