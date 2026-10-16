/** Cash liabilities remain debt even when their producing site has no revenue. */
import type { CurrencyCode } from "@/lib/constants/currencies";

export function corporateCashArrearsAnchor(input: {
  operatingByCurrency?: Readonly<Record<string, number | undefined>>;
  federalTaxByCountryAnchor?: Readonly<Record<string, number | undefined>>;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  producerPayables?: readonly { amount: number }[];
}): number {
  const operating = Object.entries(input.operatingByCurrency ?? {}).reduce<number>(
    (sum, [currency, local]) => {
      if (!(local && local > 0)) return sum;
      const rate = input.fxByCurrency.get(currency as CurrencyCode) ?? 1;
      return sum + local / (rate > 0 ? rate : 1);
    },
    0
  );
  const tax = Object.values(input.federalTaxByCountryAnchor ?? {}).reduce<number>(
    (sum, amount) => sum + Math.max(0, amount ?? 0),
    0
  );
  const producer = (input.producerPayables ?? []).reduce((sum, claim) => {
    if (!Number.isFinite(claim.amount) || claim.amount < 0)
      throw new Error("Invalid producer invoice liability");
    return sum + claim.amount;
  }, 0);
  if (!Number.isFinite(producer)) throw new Error("Producer invoice liability overflow");
  return operating + tax + producer;
}
