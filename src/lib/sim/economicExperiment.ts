export type FreightSettlementExperimentMode = "shadow" | "active";

export interface EconomicExperimentConfig {
  freightSettlementMode?: FreightSettlementExperimentMode;
  canonicalFreightBillingEnabled?: boolean;
  shortageResponsiveSourcingEnabled?: boolean;
  indexFundBondLiquidityEnabled?: boolean;
  nppMarketCoverageEnabled?: boolean;
}

export function parseOptionalBoolean(value: string | undefined, flag: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`--${flag} must be true or false (got "${value}")`);
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
    ...(config.nppMarketCoverageEnabled !== undefined
      ? { nppMarketCoverageEnabled: config.nppMarketCoverageEnabled }
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
    ...(set.nppMarketCoverageEnabled !== undefined
      ? [`--npp-market-coverage=${String(set.nppMarketCoverageEnabled)}`]
      : []),
  ];
}
