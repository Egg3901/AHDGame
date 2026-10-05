/**
 * Import cost normalization. A finite multiplier of at least one is retained;
 * missing or invalid route data uses the untariffed baseline of one.
 */
export function normalizeImportCostMultiplier(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= 1 ? value : 1;
}

/** Convert an effective tariff fraction into a tariff-inclusive route multiplier. */
export function tariffRateToImportCostMultiplier(rate: number | undefined): number {
  const tariff = rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 0;
  return normalizeImportCostMultiplier(1 + tariff);
}
