export type FreightSettlementExperimentMode = "shadow" | "active";

export interface EconomicExperimentConfig {
  freightSettlementMode?: FreightSettlementExperimentMode;
  canonicalFreightBillingEnabled?: boolean;
  shortageResponsiveSourcingEnabled?: boolean;
  indexFundBondLiquidityEnabled?: boolean;
  sovereignIssuanceConsolidationEnabled?: boolean;
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
 * sovereign issuance consolidation flag. */
export function isGameplayOverrideArg(value: string): boolean {
  return /^(--(?:market-mode|labour-mode|autonomy|difficulty|foreign-policy|foreign-policy-stage|freight-settlement|npp-market-coverage|npp-fragile-market-supply|canonical-freight-billing|shortage-responsive-sourcing|index-fund-bond-liquidity|sovereign-issuance-consolidation|equity-liquidity-facility|equity-liquidity)=|--(?:scarcity-drift|brand-loyalty|brand-loyalty-slice|quality|demographics|command-economy|macro-growth|pre-iteration|no-pre-iteration)$)/.test(
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
