/**
 * Rules for the capped frontier-entry experiment (issue #991).
 *
 * The experiment runs in the real NPP turn path behind
 * `frontierEntryExperimentEnabled` (default false, fail-closed, excluded from
 * player-facing singleplayer controls). Activation still requires the
 * controlled 48-turn trial and largest-supplier-failure stress evidence the
 * issue gates require. The NPP entry funnel and state-sector coverage metrics
 * are the always-on evidence layer; this module states the experiment's
 * constraints and its rollback-observability contract so a trial can be
 * evaluated against preregistered guardrails.
 *
 * Rules-zone module: plain data in, plain data out. No database, clock,
 * randomness, environment, network, or async.
 *
 * Constraints encoded here:
 * - at most one entrant per eligible state-country cohort per turn
 *   (FRONTIER_ENTRY_MAX_ENTRANTS_PER_COHORT_PER_TURN)
 * - no duplicate common-control entities masquerading as entry: one entrant
 *   per controlling entity per turn
 * - real financing and real founding costs: eligibility requires a priced
 *   founding quote covered by capital or an approved credit line
 * - the experiment relaxes only expectational gates
 *   (FRONTIER_ENTRY_RELAXABLE_REASONS): profitability, margin floor, and the
 *   nominal pre-pricing cash floor. Policy, physical, and accounting gates
 *   (state control, logistics, cohort stagger, retail pause, glut, per-turn
 *   cap, real founding-cost affordability, facility size) stay binding
 * - no guaranteed survival: exits (including failures) are recorded, never
 *   prevented; rollback triggers only on guardrail breach, not on entrant
 *   failure
 * - embargo, bloc, planned-economy, geography, accounting, and conservation
 *   invariants are preserved by construction: the experiment only ever
 *   reallocates an already policy-cleared candidate slot, so `policyCleared`
 *   is a required input, not something this module re-derives
 * - no aggregate concentration cap: none is defined here, per the issue
 */

/** At most one entrant per eligible state-country cohort per turn. */
export const FRONTIER_ENTRY_MAX_ENTRANTS_PER_COHORT_PER_TURN = 1;

export type FrontierEntryRelaxableReason = "unprofitable" | "margin_below_floor" | "cash_floor";

/**
 * Pre-pricing funnel reasons the experiment may override. These are
 * expectational gates (profitability outlook, margin band, nominal surplus):
 * the priced real-cost affordability check inside the founding block stays
 * binding, so an override never funds a plant the corp cannot pay for.
 * Every other reason names a policy, physical, pacing, or accounting
 * constraint the experiment must preserve and therefore never relaxes.
 */
export const FRONTIER_ENTRY_RELAXABLE_REASONS: readonly FrontierEntryRelaxableReason[] = [
  "unprofitable",
  "margin_below_floor",
  "cash_floor",
] as const;

export function isFrontierEntryRelaxableReason(
  reason: string
): reason is FrontierEntryRelaxableReason {
  return (FRONTIER_ENTRY_RELAXABLE_REASONS as readonly string[]).includes(reason);
}

/** Absent or non-true resolves to disabled. Fail-closed like the flag. */
export function frontierEntryExperimentEnabledFrom(value: unknown): boolean {
  return value === true;
}

/** Cohort identity for the per-turn cap: one entrant per state-country pair. */
export function frontierEntryCohortKey(countryId: string, stateId: string): string {
  return `${countryId}\u0000${stateId}`;
}

/**
 * Controlling-entity identity for the common-control dedup. Uses the
 * formalized control link on the corporation document (the parent that set a
 * dividend floor, honored only while it still controls >50% voting) and falls
 * back to the corporation itself. Spin-off provenance is NOT control: a spun
 * off corp is an independent entrant. Full voting-power derivation lives in
 * the subsidiaries shell and is out of scope for this predicate; the caller
 * passes the already-resolved key.
 */
export function frontierEntryControllerKey(args: {
  corporationId: string;
  controllingCorporationId?: string | null;
}): string {
  return args.controllingCorporationId ?? args.corporationId;
}

export interface FrontierEntryEligibility {
  experimentEnabled: boolean;
  /**
   * The candidate slot already cleared embargo, bloc, planned-economy, and
   * geography policy in the shell's candidate selection. The experiment never
   * clears policy itself.
   */
  policyCleared: boolean;
  cohortKey: string;
  controllerKey: string;
  enteredCohorts: ReadonlySet<string>;
  enteredControllers: ReadonlySet<string>;
  /** A real founding cost was quoted through the player-equivalent path. */
  foundingCostPriced: boolean;
  /** The quote is covered by capital or an approved credit line, post floor. */
  financed: boolean;
}

/**
 * Whether this candidate may take the experiment's entry slot this turn.
 * One entrant per cohort and one per controller; everything else is a hard
 * precondition, so a false here always names a real constraint, never a
 * lottery.
 */
export function frontierEntryEligible(args: FrontierEntryEligibility): boolean {
  if (args.experimentEnabled !== true) return false;
  if (args.policyCleared !== true) return false;
  if (args.foundingCostPriced !== true) return false;
  if (args.financed !== true) return false;
  if (args.enteredCohorts.has(args.cohortKey)) return false;
  if (args.enteredControllers.has(args.controllerKey)) return false;
  return true;
}

/** Record a taken slot. No-op when the slot was never eligible. */
export function recordFrontierEntry(
  enteredCohorts: Set<string>,
  enteredControllers: Set<string>,
  cohortKey: string,
  controllerKey: string
): void {
  enteredCohorts.add(cohortKey);
  enteredControllers.add(controllerKey);
}

export type FrontierEntrantExit = "active" | "failed" | "divested" | "nationalized";

export interface FrontierEntrantObservation {
  turn: number;
  cohortKey: string;
  controllerKey: string;
  corporationId: string;
  countryId: string;
  stateId: string;
  sectorType: string;
  foundingCostLocal: number;
  exit: FrontierEntrantExit;
}

export interface FrontierGuardrailInput {
  name: string;
  before: number;
  after: number;
  /** Largest tolerable decline in the same units, preregistered per trial. */
  maxDecline: number;
}

export interface FrontierGuardrailCheck extends FrontierGuardrailInput {
  breached: boolean;
}

/**
 * Preregistered guardrail evaluation (pooled fill, staffing, sell-through,
 * country fill): a guardrail breaches when the metric declines by more than
 * its preregistered tolerance. Entrant failures do NOT breach: there is no
 * guaranteed survival, so a failed entrant is an observation, not a rollback.
 */
export function checkFrontierGuardrails(
  guardrails: readonly FrontierGuardrailInput[]
): FrontierGuardrailCheck[] {
  return guardrails.map((guardrail) => ({
    ...guardrail,
    breached: guardrail.after < guardrail.before - guardrail.maxDecline,
  }));
}

export interface FrontierExperimentReport {
  entrants: number;
  active: number;
  exitedFailed: number;
  exitedOther: number;
  cohortsEntered: number;
  guardrailBreaches: FrontierGuardrailCheck[];
  /** Rollback triggers on guardrail breach only, never on entrant failure. */
  recommendation: "continue" | "rollback";
}

/**
 * Trial-level observations derived from persisted entry-funnel diagnostics.
 * Only diagnostics the turn path marked as experiment placements count; the
 * mark carries the cohort, controller, and priced founding cost, so the
 * rollback report is computable from the existing diagnostics collection with
 * no new writes. Foundings observe as `active`: exit evolution (failure,
 * divestiture, nationalization) is measured by the trial harness joining
 * later turns, never by preventing the exit.
 */
export function frontierExperimentObservationsFromDiagnostics(args: {
  turn: number;
  diagnostics: readonly {
    reason: string;
    corporationId: string;
    countryId: string;
    targetStateId?: string;
    targetSectorType?: string;
    foundingCostLocal?: number;
    frontierExperiment?: { cohortKey: string; controllerKey: string };
  }[];
}): FrontierEntrantObservation[] {
  const observations: FrontierEntrantObservation[] = [];
  for (const diagnostic of args.diagnostics) {
    const mark = diagnostic.frontierExperiment;
    if (diagnostic.reason !== "entered" || !mark) continue;
    observations.push({
      turn: args.turn,
      cohortKey: mark.cohortKey,
      controllerKey: mark.controllerKey,
      corporationId: diagnostic.corporationId,
      countryId: diagnostic.countryId,
      stateId: diagnostic.targetStateId ?? "",
      sectorType: diagnostic.targetSectorType ?? "",
      foundingCostLocal: diagnostic.foundingCostLocal ?? 0,
      exit: "active",
    });
  }
  return observations;
}

export function summarizeFrontierExperiment(args: {
  observations: readonly FrontierEntrantObservation[];
  guardrails: readonly FrontierGuardrailInput[];
}): FrontierExperimentReport {
  let active = 0;
  let exitedFailed = 0;
  let exitedOther = 0;
  const cohorts = new Set<string>();
  for (const observation of args.observations) {
    cohorts.add(observation.cohortKey);
    if (observation.exit === "active") active += 1;
    else if (observation.exit === "failed") exitedFailed += 1;
    else exitedOther += 1;
  }
  const guardrailBreaches = checkFrontierGuardrails(args.guardrails).filter(
    (check) => check.breached
  );
  return {
    entrants: args.observations.length,
    active,
    exitedFailed,
    exitedOther,
    cohortsEntered: cohorts.size,
    guardrailBreaches,
    recommendation: guardrailBreaches.length > 0 ? "rollback" : "continue",
  };
}
