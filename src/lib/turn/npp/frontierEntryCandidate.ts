// src/lib/turn/npp/frontierEntryCandidate.ts
/**
 * Capped frontier-entry experiment glue for the NPP turn path (issue #991).
 *
 * Deep turn helper with a narrow interface: the decision engine in
 * `nppCorporationBehavior.ts` calls three functions (shell state, candidate
 * evaluation, placement settlement) and keeps the priced founding block
 * shared. Everything experiment-specific lives here; flag off reads as absent
 * and the decision is byte-identical to the legacy path.
 *
 * Shell zone module: operates on decision-local values and the per-turn slot
 * sets the shell owns. The experiment contract itself (relaxable reasons,
 * cohort/controller caps, guardrails) lives in the portable rules module
 * `economy/frontierEntryExperiment`; this file only threads it through the
 * turn.
 */
import {
  frontierEntryCohortKey,
  frontierEntryControllerKey,
  frontierEntryExperimentEnabledFrom,
  isFrontierEntryRelaxableReason,
  recordFrontierEntry,
  type FrontierEntryRelaxableReason,
} from "@/lib/economy/frontierEntryExperiment";
import type { Corporation } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { NppMarketEntryDiagnostic } from "@/lib/db/types/marketFormation";

/**
 * Per-turn experiment state, shared across the whole NPP cohort for the turn.
 * Enforces at most one entrant per state-country cohort and one per
 * controlling entity. Created by the shell only when the flag resolves true;
 * absent (or disabled) reads as off.
 */
export interface FrontierEntryTurnState {
  enabled: boolean;
  enteredCohorts: Set<string>;
  enteredControllers: Set<string>;
}

/**
 * Resolve the flag to turn state. Fail-closed: absent or non-true resolves to
 * disabled, in which case no ctx carries experiment state. The shell read
 * piggybacks on the strategy-gate fetch: no new turn-path round trip.
 */
export function createFrontierEntryTurnState(
  flagValue: unknown
): FrontierEntryTurnState | undefined {
  if (frontierEntryExperimentEnabledFrom(flagValue) !== true) return undefined;
  return { enabled: true, enteredCohorts: new Set(), enteredControllers: new Set() };
}

/** Non-expectational pre-pricing gates the experiment must re-verify. */
export interface FrontierCandidateGates {
  allowExpansion: boolean;
  hasLogisticsCapacity: boolean;
  marketEntryEligible: boolean;
  /** Pause new retail entry while fake supply-derived demand unwinds. */
  retailBlocked: boolean;
  /** Demand audit: never found an ordinary plant into a glutted market. */
  targetGlutted: boolean;
}

/** A policy-cleared candidate granted one priced evaluation this turn. */
export interface FrontierCandidate {
  target: UnownedSector;
  cohortKey: string;
  controllerKey: string;
  relaxedReason: FrontierEntryRelaxableReason;
}

function controllerKeyOf(corp: Corporation): string {
  return frontierEntryControllerKey({
    corporationId: corp._id.toString(),
    controllingCorporationId: corp.parentDividendFloorSetByCorpId?.toString() ?? null,
  });
}

/**
 * Evaluate the experiment fallback for one corporation.
 *
 * When the flag is on, a policy-cleared candidate rejected only on an
 * expectational gate (profitability, margin band, nominal cash surplus) gets
 * one priced evaluation through the SAME founding block: the same real quote,
 * the same post-floor affordability, the same headroom/size/per-turn-cap
 * gates, the same cash debit and unowned-pool draw. Only the relaxable
 * reasons qualify, so state-controlled, glutted, retail-paused,
 * cohort-staggered, cap-rejected, and candidate-less rejections never reach
 * here, and the priced affordability inside stays binding: an override never
 * funds a plant the corp cannot pay for.
 *
 * Slot check only at this stage: the founding block prices the quote, and a
 * placement still requires its affordability gate to pass. Ordinary entries
 * consume the same cohort/controller slots (recorded at settlement), so a
 * cohort that already entered this turn is ineligible.
 *
 * Clause map onto `frontierEntryEligible` in
 * economy/frontierEntryExperiment (the contract definition, unit-tested
 * there): experimentEnabled comes from the flag-gated turn state,
 * policyCleared holds because the candidate survived the
 * partition/state-control/deposit filters, the set checks are the
 * cohort/controller caps, and foundingCostPriced/financed are the
 * affordability gate in the founding block operating on the real debited
 * amounts.
 *
 * The funnel reason names the FIRST failing gate, so a relaxable reason does
 * not prove the later gates passed: an unprofitable corp may also be
 * cohort-staggered, logistics-capped, retail-paused, or glutted. Re-verify
 * every non-expectational pre-pricing gate explicitly, mirroring the
 * diagnostic inputs. Anything failing here keeps its own reason and never
 * reaches the priced block. (The per-turn cap needs no check here: the
 * founding-block predicate still enforces it.)
 */
export function evaluateFrontierCandidate(args: {
  turnState: FrontierEntryTurnState | null | undefined;
  corp: Corporation;
  candidate: UnownedSector | null;
  diagnostic: NppMarketEntryDiagnostic | undefined;
  gates: FrontierCandidateGates;
}): FrontierCandidate | null {
  const { turnState, corp, candidate, diagnostic, gates } = args;
  if (turnState?.enabled !== true) return null;
  if (candidate == null || diagnostic == null) return null;
  const relaxedReason = isFrontierEntryRelaxableReason(diagnostic.reason)
    ? diagnostic.reason
    : null;
  if (relaxedReason == null) return null;
  const gatesHold =
    candidate != null &&
    gates.allowExpansion &&
    gates.hasLogisticsCapacity &&
    gates.marketEntryEligible &&
    !gates.retailBlocked &&
    !gates.targetGlutted;
  if (!gatesHold) return null;
  const cohortKey = frontierEntryCohortKey(corp.countryId, candidate.stateId);
  const controllerKey = controllerKeyOf(corp);
  if (turnState.enteredCohorts.has(cohortKey)) return null;
  if (turnState.enteredControllers.has(controllerKey)) return null;
  return { target: candidate, cohortKey, controllerKey, relaxedReason };
}

/**
 * Settle experiment slot accounting after the founding block.
 *
 * A placement consumes one state-country cohort slot and one controller slot
 * for the rest of the turn, whether it entered through the ordinary path or
 * the experiment fallback. A placement counts as the experiment's only when
 * the founding block ran because of the fallback (neither ordinary nor
 * exceptional entry held): note the ordinary target alone cannot distinguish
 * them, since a corp that earned a candidate but missed the nominal surplus
 * band still prices that same candidate through the experiment. Experiment
 * placements carry the trial marker so the rollback report is computable from
 * persisted funnel diagnostics; the capacity observation keeps the
 * authoritative gate verdict (the relaxed reason), so the funnel still
 * measures the un-overridden pipeline. No protection is attached to the
 * founded sector: it divests, mothballs, and fails exactly like any ordinary
 * founding.
 */
export function settleFrontierEntryPlacement(args: {
  turnState: FrontierEntryTurnState | null | undefined;
  frontier: FrontierCandidate | null;
  diagnostic: NppMarketEntryDiagnostic | undefined;
  corp: Corporation;
  fallbackCandidate: UnownedSector | null;
  ordinaryEntry: boolean;
  exceptionalShortageEntry: boolean;
}): NppMarketEntryDiagnostic | undefined {
  const {
    turnState,
    frontier,
    diagnostic,
    corp,
    fallbackCandidate,
    ordinaryEntry,
    exceptionalShortageEntry,
  } = args;
  if (turnState?.enabled !== true) return diagnostic;
  if (diagnostic == null || diagnostic.reason !== "entered") return diagnostic;
  const experimentPlaced = frontier != null && !ordinaryEntry && !exceptionalShortageEntry;
  const slotCohortKey =
    experimentPlaced && frontier != null
      ? frontier.cohortKey
      : frontierEntryCohortKey(
          diagnostic.countryId,
          diagnostic.targetStateId ?? fallbackCandidate?.stateId ?? ""
        );
  const corpControllerKey = controllerKeyOf(corp);
  const slotControllerKey =
    corpControllerKey ?? frontierEntryControllerKey({ corporationId: corp._id.toString() });
  recordFrontierEntry(
    turnState.enteredCohorts,
    turnState.enteredControllers,
    slotCohortKey,
    slotControllerKey
  );
  if (experimentPlaced && frontier != null) {
    return {
      ...diagnostic,
      frontierExperiment: {
        cohortKey: slotCohortKey,
        controllerKey: slotControllerKey,
        relaxedReason: frontier.relaxedReason,
      },
    };
  }
  return diagnostic;
}
