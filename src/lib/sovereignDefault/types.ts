/**
 * Shared types for the sovereign-default subsystem.
 *
 * Phase 2 introduces the demand-signal types. Later phases extend with
 * crisis-state, resolution-result, and cascade-related types.
 */

/**
 * All inputs to `computeMarketDemand`. Loaded by `loadCountrySovereignSnapshot`.
 */
export interface SovereignDemandSnapshot {
  /** Country code (e.g. "US", "UK") for diagnostics/logging */
  countryCode: string;
  /** Current turn — used for `turnsSinceLastDefault` derivation */
  currentTurn: number;
  /** Raw debt-to-GDP ratio (e.g. 1.2 = 120%) */
  debtToGdp: number;
  /** Annualized inflation rate (e.g. 0.03 = 3%) */
  inflationRate: number;
  /** Mean of `stateMetrics.governance.publicTrust.value` across states, normalized to 0..1 */
  trust: number;
  /** Effective sovereign coupon rate as percentage (prime + credit-rating spread) */
  sovereignCouponRate: number;
  /** Currency depreciation rate over last 10 turns (positive = depreciation; e.g. 0.15 = 15% weaker) */
  fxDepreciationRate10t: number;
  /** Turns elapsed since most recent sovereign default; null if never defaulted */
  turnsSinceLastDefault: number | null;
  /** Total face value of qualifying entity holdings for this country (Model B Phase 3) */
  entityHoldings: number;
  /** Projected next-quarter required sovereign bond issuance (rollover + deficit) */
  requiredIssuance: number;
}

/**
 * Per-component breakdown of the demand calculation. Returned alongside the
 * scalar demand value so the UI can render the contribution table.
 */
export interface SovereignDemandComponent {
  /** Stable id for UI rendering / sort order */
  id:
    | "base"
    | "debtToGdp"
    | "debtToGdpCliff"
    | "inflation"
    | "fxDepreciation"
    | "defaultScar"
    | "trust"
    | "couponPremium"
    | "entityHoldings";
  /** Human-readable label */
  label: string;
  /** Signed contribution to demand */
  contribution: number;
}

/**
 * Result of `computeMarketDemand` — scalar demand plus the per-component
 * breakdown for UI / diagnostics.
 */
export interface SovereignDemandResult {
  /** Demand ratio. 1.0 = full subscription, <0.7 = failed auction */
  demandRatio: number;
  /** Component contributions in the order they were applied */
  components: SovereignDemandComponent[];
}
