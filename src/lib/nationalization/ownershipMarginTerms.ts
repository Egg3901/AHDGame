/**
 * Ownership-driven margin terms for the display surfaces (corp page sector rows,
 * sector detail). The turn applies all three inside the margin stack
 * (`sectorTurn/marginStack.ts`), but the read paths used to fold them into an
 * unlabelled "Other factors" remainder, so a state enterprise losing 12 points
 * to SOE efficiency had no line saying so. Same shared functions as the turn.
 *
 * Pure: every DB-derived input is passed in.
 */
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { getExpropriationRiskMarginModifier } from "@/lib/constants/corporations";
import { corpAlignmentModifier } from "@/lib/economicModels/effects";
import type { EconomicModelState } from "@/lib/constants/economicModels";
import { sociMultiplier } from "./concentration";
import { isStateOwned } from "./nationalCorporation";
import { computeSoeEfficiencyPenalty } from "./soeEfficiency";
import { resolveSectorMandate } from "./soeMandates";

export interface OwnershipMarginTerms {
  /** State enterprise efficiency (pp, <= 0). 0 for private corps. */
  soeEfficiencyModifier: number;
  /** Expropriation-risk drag from low investor confidence (pp, <= 0). 0 for SOEs. */
  expropriationRiskModifier: number;
  /** Fit with the host country's economic model (pp, signed). 0 with no named model. */
  economicModelAlignmentModifier: number;
}

export function computeOwnershipMarginTerms(args: {
  corporation: Corporation;
  sector: CorporateSector;
  sectorType: string;
  /** Host state's governance readings (0-100), null when unknown. */
  corruptionIndex: number | null;
  governmentTransparency: number | null;
  /** Owning country's state-ownership concentration (SOCI). */
  ownerSoci: number;
  /** Host country's investor confidence. */
  investorConfidence: number | null | undefined;
  /** Host country's lagged economic model. */
  economicModel: EconomicModelState | undefined;
}): OwnershipMarginTerms {
  const stateOwned = isStateOwned(args.corporation);
  const mandate = resolveSectorMandate(args.corporation, args.sector);
  const soeEfficiencyModifier = stateOwned
    ? computeSoeEfficiencyPenalty({
        corruptionIndex: args.corruptionIndex,
        governmentTransparency: args.governmentTransparency,
        priceControlled: mandate.priceControlled === true,
        employmentGuaranteed: mandate.employmentGuaranteed === true,
        concentrationMultiplier: sociMultiplier(args.ownerSoci),
      })
    : 0;
  const expropriationRiskModifier = stateOwned
    ? 0
    : getExpropriationRiskMarginModifier(args.investorConfidence);
  const economicModelAlignmentModifier = corpAlignmentModifier(args.economicModel, args.sectorType);
  return { soeEfficiencyModifier, expropriationRiskModifier, economicModelAlignmentModifier };
}

/** One-decimal rounding for display rows, matching the other margin modifiers. */
export function roundOwnershipTerms(terms: OwnershipMarginTerms): OwnershipMarginTerms {
  const r = (v: number) => Math.round(v * 10) / 10;
  return {
    soeEfficiencyModifier: r(terms.soeEfficiencyModifier),
    expropriationRiskModifier: r(terms.expropriationRiskModifier),
    economicModelAlignmentModifier: r(terms.economicModelAlignmentModifier),
  };
}
