/** National fiscal observations from the actual budget ledger, not its surplus cache. */
export interface FiscalOwnerInput {
  gdp?: number;
  revenue?: number;
  spending?: number;
  debtPrincipal?: number;
  inflationRate?: number;
}

export interface FiscalOwnerReadings {
  priceChange: number | null;
  balanceToGdp: number | null;
  debtToGdp: number | null;
}

const finite = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function fiscalOwnerReadings(input: FiscalOwnerInput): FiscalOwnerReadings {
  const validGdp = finite(input.gdp) && input.gdp > 0;
  return {
    priceChange: finite(input.inflationRate) ? input.inflationRate : null,
    balanceToGdp:
      validGdp && finite(input.revenue) && finite(input.spending)
        ? ((input.revenue - input.spending) / input.gdp!) * 100
        : null,
    debtToGdp:
      validGdp && finite(input.debtPrincipal) && input.debtPrincipal >= 0
        ? (input.debtPrincipal / input.gdp!) * 100
        : null,
  };
}
