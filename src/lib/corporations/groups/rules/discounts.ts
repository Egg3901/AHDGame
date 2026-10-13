/** Discounts transfer operating profit; never discount unconsumed reservations. */
import { SUPPLY_AGREEMENT_PRICE_BAND } from "@/lib/db/types/supplyAgreement";
import type { GroupMarketReceipt } from "./marketCoordination";
export function clampGroupDiscount(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(SUPPLY_AGREEMENT_PRICE_BAND, value!)) : 0;
}
export function settleGroupDiscounts(
  receipts: readonly GroupMarketReceipt[],
  consumption: ReadonlyMap<string, ReadonlyMap<string, number>>,
  committed?: ReadonlyMap<string, ReadonlyMap<string, number>>,
  production?: ReadonlyMap<string, ReadonlyMap<string, number>>,
  committedOutput?: ReadonlyMap<string, ReadonlyMap<string, number>>
): Map<string, number> {
  const reserved = new Map<string, number>();
  const key = (buyer: string, commodity: string) => JSON.stringify([buyer, commodity]);
  const positive = (n: number | undefined) => (n != null && Number.isFinite(n) && n > 0 ? n : 0);
  for (const r of receipts) {
    const k = key(r.buyerSectorId, r.commodity);
    reserved.set(k, (reserved.get(k) ?? 0) + positive(r.units));
  }
  const supplied = new Map<string, number>();
  for (const r of receipts) {
    const k = key(r.supplierSectorId, r.commodity);
    supplied.set(k, (supplied.get(k) ?? 0) + positive(r.units));
  }
  const costs = new Map<string, number>();
  for (const r of receipts) {
    if (!(positive(r.units) > 0 && positive(r.amountAnchor) > 0)) continue;
    const actual = Math.max(
      0,
      positive(consumption.get(r.buyerSectorId)?.get(r.commodity)) -
        positive(committed?.get(r.buyerSectorId)?.get(r.commodity))
    );
    const fraction = Math.min(1, actual / (reserved.get(key(r.buyerSectorId, r.commodity)) || 1));
    const available = Math.max(
      0,
      positive(production?.get(r.supplierSectorId)?.get(r.commodity)) -
        positive(committedOutput?.get(r.supplierSectorId)?.get(r.commodity))
    );
    const outputFraction = Math.min(
      1,
      available / (supplied.get(key(r.supplierSectorId, r.commodity)) || 1)
    );
    const rebate =
      positive(r.amountAnchor) *
      clampGroupDiscount(r.discount) *
      Math.min(fraction, outputFraction);
    if (!(rebate > 0)) continue;
    costs.set(r.supplierSectorId, (costs.get(r.supplierSectorId) ?? 0) + rebate);
    costs.set(r.buyerSectorId, (costs.get(r.buyerSectorId) ?? 0) - rebate);
  }
  return costs;
}
