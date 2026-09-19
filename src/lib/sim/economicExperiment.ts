export type FreightSettlementExperimentMode = "shadow" | "active";

export interface EconomicExperimentConfig {
  freightSettlementMode?: FreightSettlementExperimentMode;
  canonicalFreightBillingEnabled?: boolean;
  shortageResponsiveSourcingEnabled?: boolean;
  indexFundBondLiquidityEnabled?: boolean;
  sovereignIssuanceConsolidationEnabled?: boolean;
  domesticSovereignBondCoverageEnabled?: boolean;
  equityLiquidityFacilityEnabled?: boolean;
  nppMarketCoverageEnabled?: boolean;
  nppFragileMarketSupplyEnabled?: boolean;
}

export function parseOptionalBoolean(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${flag} must be true or false (got "${value}")`);
}

/** Canonical CLI flag for the equity liquidity facility experiment. Matches
 * the simJobs field (equityLiquidityFacilityEnabled) and the sibling
 * --index-fund-bond-liquidity naming pattern. */
export const EQUITY_LIQUIDITY_FACILITY_CLI_FLAG = "equity-liquidity-facility";
/** Deprecated alias kept so older scripts keep working. Reads (never writes). */
export const DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG = "equity-liquidity";

export function parseEquityLiquidityFacilityEnabled(
  readArg: (flag: string) => string | undefined
): boolean | undefined {
  const canonical = readArg(EQUITY_LIQUIDITY_FACILITY_CLI_FLAG);
  if (canonical !== undefined)
    return parseOptionalBoolean(canonical, EQUITY_LIQUIDITY_FACILITY_CLI_FLAG);
  return parseOptionalBoolean(
    readArg(DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG),
    DEPRECATED_EQUITY_LIQUIDITY_CLI_FLAG
  );
}

/** True when one argv entry is a gameplay override, which
 * --preserve-live-config refuses to run alongside. Covers both the canonical
 * equity liquidity facility flag and its deprecated alias, plus the #1001
 * sovereign issuance consolidation and domestic coverage flags. */
export function isGameplayOverrideArg(value: string): boolean {
  return /^(--(?:market-mode|labour-mode|autonomy|difficulty|foreign-policy|foreign-policy-stage|freight-settlement|npp-market-coverage|npp-fragile-market-supply|canonical-freight-billing|shortage-responsive-sourcing|index-fund-bond-liquidity|sovereign-issuance-consolidation|domestic-sovereign-bond-coverage|equity-liquidity-facility|equity-liquidity|frontier-entry-experiment)=|--(?:scarcity-drift|brand-loyalty|brand-loyalty-slice|quality|demographics|command-economy|macro-growth|pre-iteration|no-pre-iteration)$)/.test(
    value
  );
}

export function economicExperimentConfigSet(
  config: EconomicExperimentConfig
): Record<string, boolean | FreightSettlementExperimentMode> {
  return {
    ...(config.freightSettlementMode !== undefined
      ? { freightSettlementMode: config.freightSettlementMode }
      : {}),
    ...(config.canonicalFreightBillingEnabled !== undefined
      ? { canonicalFreightBillingEnabled: config.canonicalFreightBillingEnabled }
      : {}),
    ...(config.shortageResponsiveSourcingEnabled !== undefined
      ? { shortageResponsiveSourcingEnabled: config.shortageResponsiveSourcingEnabled }
      : {}),
    ...(config.indexFundBondLiquidityEnabled !== undefined
      ? { indexFundBondLiquidityEnabled: config.indexFundBondLiquidityEnabled }
      : {}),
    ...(config.sovereignIssuanceConsolidationEnabled !== undefined
      ? { sovereignIssuanceConsolidationEnabled: config.sovereignIssuanceConsolidationEnabled }
      : {}),
    ...(config.domesticSovereignBondCoverageEnabled !== undefined
      ? { domesticSovereignBondCoverageEnabled: config.domesticSovereignBondCoverageEnabled }
      : {}),
    ...(config.equityLiquidityFacilityEnabled !== undefined
      ? { equityLiquidityFacilityEnabled: config.equityLiquidityFacilityEnabled }
      : {}),
    ...(config.nppMarketCoverageEnabled !== undefined
      ? { nppMarketCoverageEnabled: config.nppMarketCoverageEnabled }
      : {}),
    ...(config.nppFragileMarketSupplyEnabled !== undefined
      ? { nppFragileMarketSupplyEnabled: config.nppFragileMarketSupplyEnabled }
      : {}),
  };
}

/**
 * Sim-pipeline spelling of the frontier-entry experiment gate (issue #991).
 * Single source of truth for the CLI flag name: worker.ts emits it and
 * runWorld.ts parses it, both through the helpers below, so the spelling
 * cannot drift between the two ends of the queue.
 */
export const FRONTIER_ENTRY_SIM_CLI_FLAG = "frontier-entry-experiment";

/** Parse `--frontier-entry-experiment=true|false`. Absent stays absent. */
export function parseFrontierEntryExperimentArg(value: string | undefined): boolean | undefined {
  return parseOptionalBoolean(value, FRONTIER_ENTRY_SIM_CLI_FLAG);
}

/**
 * Emit the frontier gate for a child-process argv. Explicit false is
 * preserved (control arm), absent emits nothing (existing behavior).
 */
export function frontierEntryExperimentCliArgs(value: boolean | undefined): string[] {
  return value === undefined ? [] : [`--${FRONTIER_ENTRY_SIM_CLI_FLAG}=${String(value)}`];
}

/**
 * gameState keys the sim `--all-feature-flags` sweep must never arm. The
 * frontier-entry experiment stays disabled until its controlled 48-turn trial
 * plus largest-supplier-failure stress evidence pass; flipping it on as a
 * side effect of a full-feature sweep would bypass that gate.
 */
export const SIM_ALL_FEATURE_FLAGS_EXCLUDE: ReadonlySet<string> = new Set([
  "frontierEntryExperimentEnabled",
]);

/**
 * Pure mapping for the sim `--all-feature-flags` sweep: every boolean default
 * resolves true, except excluded experimental gates, which stay absent so the
 * sandbox keeps its fail-closed default. Extracted so the exclusion is
 * unit-testable rather than buried inline in runWorld.ts.
 */
export function allFeatureFlagsGameStateSet(
  defaults: Record<string, unknown>
): Record<string, true> {
  return Object.fromEntries(
    Object.entries(defaults)
      .filter(
        ([key, value]) => typeof value === "boolean" && !SIM_ALL_FEATURE_FLAGS_EXCLUDE.has(key)
      )
      .map(([key]) => [key, true])
  ) as Record<string, true>;
}

export function economicExperimentCliArgs(config: EconomicExperimentConfig): string[] {
  const set = economicExperimentConfigSet(config);
  return [
    ...(set.freightSettlementMode ? [`--freight-settlement=${set.freightSettlementMode}`] : []),
    ...(set.canonicalFreightBillingEnabled !== undefined
      ? [`--canonical-freight-billing=${String(set.canonicalFreightBillingEnabled)}`]
      : []),
    ...(set.shortageResponsiveSourcingEnabled !== undefined
      ? [`--shortage-responsive-sourcing=${String(set.shortageResponsiveSourcingEnabled)}`]
      : []),
    ...(set.indexFundBondLiquidityEnabled !== undefined
      ? [`--index-fund-bond-liquidity=${String(set.indexFundBondLiquidityEnabled)}`]
      : []),
    ...(set.sovereignIssuanceConsolidationEnabled !== undefined
      ? [`--sovereign-issuance-consolidation=${String(set.sovereignIssuanceConsolidationEnabled)}`]
      : []),
    ...(set.domesticSovereignBondCoverageEnabled !== undefined
      ? [`--domestic-sovereign-bond-coverage=${String(set.domesticSovereignBondCoverageEnabled)}`]
      : []),
    ...(set.equityLiquidityFacilityEnabled !== undefined
      ? [`--${EQUITY_LIQUIDITY_FACILITY_CLI_FLAG}=${String(set.equityLiquidityFacilityEnabled)}`]
      : []),
    ...(set.nppMarketCoverageEnabled !== undefined
      ? [`--npp-market-coverage=${String(set.nppMarketCoverageEnabled)}`]
      : []),
    ...(set.nppFragileMarketSupplyEnabled !== undefined
      ? [`--npp-fragile-market-supply=${String(set.nppFragileMarketSupplyEnabled)}`]
      : []),
  ];
}
