import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FundedSovereignCouponClaim } from "@/lib/db/types/budget";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { perTurnCouponPayment } from "@/lib/constants/bonds";

export interface SovereignCouponCorporationQuote {
  id: string;
  countryId: string;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
  currencyFieldPresent: boolean;
  currencyFieldValue?: string | null;
  currencyUsesCountryFallback: boolean;
}

export interface SovereignCouponBondSnapshot {
  id: string;
  countryId?: string;
  currencyCode?: CurrencyCode;
  couponRate: number;
  publicFloat: number;
  holders: Array<{
    kind: "character" | "imperial" | "corporation" | "fund" | "npp" | "bank";
    id?: string;
    units: number;
  }>;
}

/** Pure holder snapshot calculation. Database ids and mutable docs stay in the shell. */
export function freezeSovereignCouponClaim(input: {
  bond: SovereignCouponBondSnapshot;
  turn: number;
  anchorRate: number;
  forexEnabled: boolean;
  corporateQuotes: ReadonlyMap<string, SovereignCouponCorporationQuote>;
}): FundedSovereignCouponClaim | null {
  const { bond, turn, anchorRate, forexEnabled, corporateQuotes } = input;
  const currencyCode = bond.currencyCode ?? "USD";
  const perUnit = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE);
  const amount = (units: number) => perUnit * Math.max(0, units);
  const holders: FundedSovereignCouponClaim["holders"] = [];
  if (bond.publicFloat > 0) {
    const amountLocal = amount(bond.publicFloat);
    holders.push({
      kind: "publicFloat",
      amountLocal,
      amountAnchor: amountLocal / anchorRate,
      currencyCode,
    });
  }
  for (const holder of bond.holders ?? []) {
    if (holder.kind === "bank" || holder.units <= 0) continue;
    const amountLocal = amount(holder.units);
    const base = { amountLocal, amountAnchor: amountLocal / anchorRate };
    const id = holder.id;
    if (!id) continue;
    if (holder.kind === "corporation") {
      const quote = corporateQuotes.get(id);
      if (!quote) throw new Error(`Missing corporate FX quote for sovereign coupon ${bond.id}`);
      holders.push({
        ...base,
        kind: "corporation",
        id,
        currencyCode,
        payeeCurrencyCode: quote.currencyCode,
        payeeLocalPerAnchor: quote.localPerAnchor,
        payeeCountryId: quote.countryId,
        payeeCurrencyFieldPresent: quote.currencyFieldPresent,
        payeeCurrencyFieldValue: quote.currencyFieldValue,
        payeeCurrencyUsesCountryFallback: quote.currencyUsesCountryFallback,
      });
    } else if (holder.kind === "character" || holder.kind === "imperial") {
      holders.push({
        ...base,
        kind: holder.kind,
        id,
        currencyCode,
        personalBalancePath: forexEnabled
          ? `currencyBalances.personal.${currencyCode}`
          : "cashOnHand",
      });
    } else if (holder.kind === "fund") holders.push({ ...base, kind: "fund", id });
    else if (holder.kind === "npp") holders.push({ ...base, kind: "npp", id });
  }
  const amountLocal = holders.reduce((sum, row) => sum + row.amountLocal, 0);
  if (!(amountLocal > 0)) return null;
  return {
    id: `sovereign-coupon:${bond.id}:${turn}`,
    bondId: bond.id,
    dueTurn: turn,
    countryId: String(bond.countryId ?? ""),
    currencyCode,
    amountLocal,
    anchorRate,
    holders,
  };
}
