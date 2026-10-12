import type { IndexFundTargetDefinition } from "../constituents";
import type { BondFundUniverse } from "../fundDefinitions";

/** Published index policy. Targets are execution output, not the mandate. */
export type IndexMandate = IndexFundTargetDefinition & {
  version: 1;
  mode: "index";
  bondUniverse?: BondFundUniverse;
};

/** Compatibility policy for books created before mandates were persisted. */
export function legacyIndexMandate(
  metadata: IndexFundTargetDefinition,
  originalPolicy?: Pick<IndexMandate, "topN" | "bondUniverse">
): IndexMandate {
  return {
    ...metadata,
    version: 1,
    mode: "index",
    ...(originalPolicy?.topN !== undefined ? { topN: originalPolicy.topN } : {}),
    ...(originalPolicy?.bondUniverse ? { bondUniverse: originalPolicy.bondUniverse } : {}),
    ...(metadata.kind === "bond" && !originalPolicy?.bondUniverse && metadata.countryId
      ? { bondUniverse: { issuerType: "sovereign", homeOnly: true } }
      : {}),
  };
}

/** A bank's named stocks use total portfolio weights. Missing capacity stays cash. */
export type PickedStockMandate = {
  version: 1;
  mode: "picked_stocks";
  topN?: never;
  sectorType?: never;
  bondUniverse?: never;
  scope: "country";
  kind: "broad";
  countryId: IndexMandate["countryId"];
  anchorCurrencyCode: IndexMandate["anchorCurrencyCode"];
  cashWeightBps: 2500;
  issuerCapBps: 1500;
  stocks: { corporationId: string; weightBps: number }[];
};
export type FundMandate = IndexMandate | PickedStockMandate;

export function validatePickedStocks(mandate: PickedStockMandate): string | null {
  if (mandate.scope !== "country" || !mandate.countryId)
    return "Pick companies in the bank's home country.";
  if (mandate.cashWeightBps !== 2500 || mandate.issuerCapBps !== 1500)
    return "At least a quarter stays in cash. Each company can hold at most 15%.";
  if (mandate.stocks.length < 1 || mandate.stocks.length > 10) return "Pick 1 to 10 companies.";
  if (new Set(mandate.stocks.map((s) => s.corporationId)).size !== mandate.stocks.length)
    return "Pick each company once.";
  if (
    mandate.stocks.some(
      (s) =>
        !/^[a-f0-9]{24}$/.test(s.corporationId) ||
        !Number.isInteger(s.weightBps) ||
        s.weightBps <= 0 ||
        s.weightBps > 1500
    )
  )
    return "Each company needs a weight above zero and at most 15%.";
  if (mandate.stocks.reduce((sum, s) => sum + s.weightBps, 0) > 7500)
    return "Company weights can add up to at most 75%. The rest stays in cash.";
  return null;
}

/** Final quoted purchases are capped again, including the bid/ask cost. */
export function pickedStockPurchaseShares(input: {
  mandate: PickedStockMandate;
  corporationId: string;
  cashAnchor: number;
  holdings: { corporationId: string; shares: number; valueAnchor: number }[];
  requestedShares: number;
  priceAnchor: number;
}): number {
  const { mandate, cashAnchor, holdings, priceAnchor, requestedShares } = input;
  if (validatePickedStocks(mandate) || !Number.isFinite(priceAnchor) || priceAnchor <= 0) return 0;
  const target = mandate.stocks.find((s) => s.corporationId === input.corporationId);
  if (!target) return 0;
  const equity = holdings.reduce((sum, h) => sum + h.valueAnchor, 0);
  const backing = cashAnchor + equity;
  const held = holdings.find((h) => h.corporationId === input.corporationId);
  const current = (held?.shares ?? 0) * priceAnchor;
  // Reprice this issuer at the execution quote when checking the reserve.
  const markedBacking = backing - (held?.valueAnchor ?? 0) + current;
  const spend = Math.min(
    (markedBacking * Math.min(target.weightBps, mandate.issuerCapBps)) / 10000 - current,
    cashAnchor - (markedBacking * mandate.cashWeightBps) / 10000
  );
  return Math.max(0, Math.min(requestedShares, Math.floor(spend / priceAnchor)));
}

export function pickedStockTargetValue(weight: number, backing: number): number {
  return Math.max(0, Math.min(weight, 0.15) * backing);
}
