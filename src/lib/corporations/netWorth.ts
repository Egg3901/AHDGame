import type { Bond, Corporation } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";

function resolveBondCurrencyCode(
  bond: Pick<Bond, "currencyCode" | "countryId">
): CurrencyCode | undefined {
  return (bond.currencyCode ??
    (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
      ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
      : undefined)) as CurrencyCode | undefined;
}

export function computeBondPrincipalLiabilityAnchor(
  bond: Pick<Bond, "totalIssued" | "currencyCode" | "countryId">,
  fxByCurrency: Map<CurrencyCode, number>
): number {
  const currencyCode = resolveBondCurrencyCode(bond);
  const rate = currencyCode ? (fxByCurrency.get(currencyCode) ?? 1) : 1;
  return corpCapitalToAnchor(bond.totalIssued ?? 0, currencyCode, rate);
}

export function computeCorporationLiabilityValueAnchor(
  corporation: Pick<
    Corporation,
    | "_id"
    | "imfBailoutActive"
    | "imfFacilityPrincipalOutstanding"
    | "liquidCurrencyCode"
    | "countryId"
  >,
  issuedBonds: Array<
    Pick<Bond, "corporationId" | "matured" | "totalIssued" | "currencyCode" | "countryId">
  >,
  fxByCurrency: Map<CurrencyCode, number>
): number {
  const bondLiability = issuedBonds.reduce((sum, bond) => {
    if (!bond.corporationId?.equals(corporation._id) || bond.matured) return sum;
    return sum + computeBondPrincipalLiabilityAnchor(bond, fxByCurrency);
  }, 0);

  const imfLiability =
    corporation.imfBailoutActive === true
      ? corpCapitalToAnchor(
          corporation.imfFacilityPrincipalOutstanding ?? 0,
          corporation.liquidCurrencyCode,
          fxRateForCorpFromMap(corporation, fxByCurrency)
        )
      : 0;

  return bondLiability + imfLiability;
}
