// src/lib/turn/npp/entryEvaluation.ts
/**
 * Pre-pricing entry-gate evaluation for one NPP corporation (section 5 of
 * `makeNppCorpDecision` in `nppCorporationBehavior.ts`).
 *
 * Selects the entry candidate, applies the ordinary expectational and pacing
 * gates (profitability, margin band, logistics, cohort eligibility, shortage
 * credit, glut, nominal cash surplus), scores shortage pressure, and builds
 * the funnel diagnostic naming the first binding gate. The frontier-entry
 * experiment overlay (`frontierEntryCandidate.ts`) consumes this evaluation:
 * the diagnostic reason selects relaxable rejections and the gate values are
 * re-verified there.
 *
 * Pure evaluation over decision-local inputs: no database, clock, randomness,
 * environment, network, or async. Gate order mirrors the founding-gate order
 * in `capacityDecisionTelemetry` so the diagnostic names the gate that
 * actually bound. Relocation is behavior-preserving by construction; the
 * frontier turn-path tests pin the byte-equivalent flag-off behavior and the
 * entry-diagnostics tests pin the reason order.
 */
import {
  ESSENTIAL_SHORTAGE_SCORE,
  expansionFrontierStates,
  findBestUnownedSector,
  sectorPeakShortageScore,
  type CommodityPriceRatioFn,
  type PlacementSignals,
} from "@/lib/turn/npp/marketSignals";
import { resolveFragileEntryTreatment } from "@/lib/turn/npp/fragileMarketSupply";
import {
  blankNppCandidateExclusions,
  buildNppMarketEntryDiagnostic,
} from "@/lib/turn/npp/entryDiagnostics";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import { ORDINARY_ENTRY_MIN_SHORTAGE } from "@/lib/turn/npp/nppCorporationTuning";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { NppMarketEntryDiagnostic } from "@/lib/db/types/marketFormation";
import type { CorporationType } from "@/lib/constants/corporations";

export interface NppEntryEvaluationInput {
  corp: Corporation;
  sectors: CorporateSector[];
  unownedByCountry: Map<string, UnownedSector[]>;
  stateControlled: ReadonlySet<string>;
  priceRatioOf: CommodityPriceRatioFn;
  placementSignals: PlacementSignals | undefined;
  plantsEnabled: boolean;
  eraUnitScale: number;
  /** Net-of-overhead profitability gating expansion. */
  profitable: boolean;
  marginPct: number;
  marginFloorPct: number;
  /** Post-floor liquid capital less the nominal founding surplus. */
  surplusCash: number;
  minCash: number;
  sectorCount: number;
  logisticsSupportedSectors: number;
  allowExpansion: boolean;
  ordinaryEntryEligible?: boolean;
  shortageEntryEligible?: boolean;
  retailExpansionPaused?: boolean;
  /** Per-turn founding cap already reached before this decision. */
  entryCapReached: boolean;
}

export interface NppEntryEvaluation {
  entryCandidate: UnownedSector | null;
  expansion: UnownedSector | null;
  hasLogisticsCapacity: boolean;
  marketEntryEligible: boolean;
  exceptionalShortageEntry: boolean;
  ordinaryEntryTargetGlutted: boolean;
  ordinaryEntry: boolean;
  foundingStrategyId: string | undefined;
  diagnostic: NppMarketEntryDiagnostic;
}

export function evaluateNppEntry(input: NppEntryEvaluationInput): NppEntryEvaluation {
  const { corp, sectors, unownedByCountry, stateControlled, priceRatioOf, placementSignals } =
    input;
  // Expansion has no fixed corporation-size ceiling. It proceeds one site at a
  // time on deterministic cohort slots, prefers the neighboring-state frontier,
  // and pauses when the current logistics strength cannot support another site.
  // A critical shortage may use corporate credit on that same cohort slot.
  const existingBuckets = new Set(sectors.map((s) => bucketKey(s.stateId, s.sectorType)));
  const frontierStates = expansionFrontierStates(corp.countryId, corp.headquartersState, sectors);
  const candidateExclusions = blankNppCandidateExclusions();
  const entryCandidate = findBestUnownedSector(
    corp.countryId,
    corp.headquartersState,
    corp.type,
    corp.secondaryType,
    existingBuckets,
    unownedByCountry,
    stateControlled,
    priceRatioOf,
    input.plantsEnabled,
    input.eraUnitScale,
    placementSignals,
    frontierStates,
    candidateExclusions
  );
  const {
    candidatePriceRatioOf: entryCandidatePriceRatioOf,
    interventionTargetCommodity,
    foundingStrategyId,
  } = resolveFragileEntryTreatment(entryCandidate, placementSignals, priceRatioOf);
  const entryCandidateShortageScore = entryCandidate
    ? Math.max(
        sectorPeakShortageScore(
          entryCandidate.sectorType as CorporationType,
          entryCandidate.countryId,
          entryCandidatePriceRatioOf
        ),
        interventionTargetCommodity
          ? (entryCandidatePriceRatioOf(interventionTargetCommodity, entryCandidate.countryId) ?? 0)
          : 0
      )
    : undefined;
  const expansionShortageScore = entryCandidateShortageScore ?? 1;
  const criticalShortage = expansionShortageScore >= ESSENTIAL_SHORTAGE_SCORE;
  // A measured critical shortage is demand evidence in its own right. Let it
  // bypass the backward-looking profit and margin screen, but none of the
  // entry rails below: cohort, logistics, cash, build sizing and queue pacing
  // remain authoritative. This is deliberately limited to the same threshold
  // used by the exceptional-shortage credit path.
  const expansion =
    input.allowExpansion &&
    ((input.profitable && input.marginPct >= input.marginFloorPct) || criticalShortage) &&
    !(input.retailExpansionPaused && entryCandidate?.sectorType === "retail")
      ? entryCandidate
      : null;
  const hasLogisticsCapacity = input.sectorCount < input.logisticsSupportedSectors;
  const marketEntryEligible = input.ordinaryEntryEligible !== false;
  const exceptionalShortageEntry =
    expansion !== null &&
    criticalShortage &&
    input.shortageEntryEligible === true &&
    marketEntryEligible &&
    hasLogisticsCapacity;
  // Demand audit step 5: never found an ordinary plant into a glutted
  // market — the growth governor is trying to shrink out of ≤0.85, so
  // building there manufactures the loser the corp would then have to shed.
  // Peak score (not mean): a mixed plant with one healthy leg still founds.
  // Score 0 means no leg was priced (early-world thin markets): fail open.
  const ordinaryEntryTargetGlutted =
    expansionShortageScore > 0 && expansionShortageScore <= ORDINARY_ENTRY_MIN_SHORTAGE;
  const ordinaryEntry =
    expansion !== null &&
    hasLogisticsCapacity &&
    marketEntryEligible &&
    !ordinaryEntryTargetGlutted &&
    (input.plantsEnabled || input.surplusCash > input.minCash);
  // Funnel inputs mirror the founding-gate order in
  // capacityDecisionTelemetry: retail pause and glut are evaluated on the
  // candidate (not the null expansion), so the diagnostic names the gate that
  // actually bound instead of falling through to the cash floor.
  let diagnostic = buildNppMarketEntryDiagnostic({
    corporation: corp,
    sectorCount: input.sectorCount,
    logisticsSupportedSectors: input.logisticsSupportedSectors,
    profitable: input.profitable,
    marginPct: input.marginPct,
    marginFloorPct: input.marginFloorPct,
    cohortEligible: marketEntryEligible,
    strategyAllowsExpansion: input.allowExpansion,
    hasLogisticsCapacity,
    target: entryCandidate,
    shortageScore: entryCandidateShortageScore,
    frontierStates,
    retailBlocked: input.retailExpansionPaused === true && entryCandidate?.sectorType === "retail",
    targetGlutted: ordinaryEntryTargetGlutted && !exceptionalShortageEntry,
    entryCapReached: input.entryCapReached,
    candidateExclusions,
  });
  if (interventionTargetCommodity) {
    diagnostic = { ...diagnostic, interventionTargetCommodity };
  }
  return {
    entryCandidate,
    expansion,
    hasLogisticsCapacity,
    marketEntryEligible,
    exceptionalShortageEntry,
    ordinaryEntryTargetGlutted,
    ordinaryEntry,
    foundingStrategyId,
    diagnostic,
  };
}
