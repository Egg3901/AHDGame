/** Read-only quotes. Contract storage and settlement retain their existing units. */
export interface ContractCurrencyQuote {
  code: string;
  rate: number;
}
export interface ExtractionCapacityQuote {
  totalDailyUnits: number;
  allocatedDailyUnits: number;
}
export function extractionCapacityQuote(
  total: number | undefined,
  share: number
): ExtractionCapacityQuote | null {
  if (
    total == null ||
    !Number.isFinite(total) ||
    total < 0 ||
    !Number.isFinite(share) ||
    share < 0 ||
    share > 1
  )
    return null;
  return { totalDailyUnits: total, allocatedDailyUnits: total * share };
}
export function validContractQuote(
  quote: ContractCurrencyQuote | null | undefined
): quote is ContractCurrencyQuote {
  return !!quote?.code && Number.isFinite(quote.rate) && quote.rate > 0;
}
export function contractLocalAmount(amount: number, quote: ContractCurrencyQuote): number {
  return amount * quote.rate;
}
export function contractAnchorAmount(
  amount: number,
  quote: ContractCurrencyQuote,
  references: readonly (number | undefined)[] = []
): number {
  // Preserve exact stored values when revising an unchanged bid or quoting the minimum.
  const reference = references.find(
    (value) => value !== undefined && amount === value * quote.rate
  );
  return reference ?? amount / quote.rate;
}
