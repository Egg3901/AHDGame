import type { CurrencyCode } from "@/lib/constants/currencies";
import type { FundedSovereignCouponClaim } from "@/lib/db/types/budget";
import type { Bond, BondHolder } from "@/lib/db/types/bond";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { perTurnCouponPayment } from "@/lib/constants/bonds";

export interface SovereignCouponCorporationQuote {
  id: string;
  countryId: string;
  currencyCode: CurrencyCode;
  localPerAnchor: number;
  hasExplicitCurrency: boolean;
}

/** Pure holder snapshot calculation. Database ids and mutable docs stay in the shell. */
export function freezeSovereignCouponClaim(input: {
  bond: Bond;
  turn: number;
  anchorRate: number;
  forexEnabled: boolean;
  corporateQuotes: ReadonlyMap<string, SovereignCouponCorporationQuote>;
}): FundedSovereignCouponClaim | null {
  const { bond, turn, anchorRate, forexEnabled, corporateQuotes } = input;
  const currencyCode = (bond.currencyCode ?? "USD") as CurrencyCode;
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
    if (holder.bankId || holder.bankTreasuryTradeId || holder.units <= 0) continue;
    const amountLocal = amount(holder.units);
    const base = { amountLocal, amountAnchor: amountLocal / anchorRate };
    const id = holderId(holder);
    if (!id) continue;
    if (holder.corporationId) {
      const quote = corporateQuotes.get(id);
      if (!quote) throw new Error(`Missing corporate FX quote for sovereign coupon ${bond._id}`);
      holders.push({
        ...base,
        kind: "corporation",
        id,
        currencyCode,
        payeeCurrencyCode: quote.currencyCode,
        payeeLocalPerAnchor: quote.localPerAnchor,
        payeeCountryId: quote.countryId,
        payeeHasExplicitCurrency: quote.hasExplicitCurrency,
      });
    } else if (holder.characterId || holder.imperialCharacterId) {
      holders.push({
        ...base,
        kind: holder.characterId ? "character" : "imperial",
        id,
        currencyCode,
        personalBalancePath: forexEnabled
          ? `currencyBalances.personal.${currencyCode}`
          : "cashOnHand",
      });
    } else if (holder.fundId) holders.push({ ...base, kind: "fund", id });
    else if (holder.nppId) holders.push({ ...base, kind: "npp", id });
  }
  const amountLocal = holders.reduce((sum, row) => sum + row.amountLocal, 0);
  if (!(amountLocal > 0)) return null;
  return {
    id: `sovereign-coupon:${String(bond._id)}:${turn}`,
    bondId: String(bond._id),
    dueTurn: turn,
    countryId: String(bond.countryId ?? ""),
    currencyCode,
    amountLocal,
    anchorRate,
    holders,
  };
}

function holderId(holder: BondHolder): string | null {
  return (
    holder.characterId?.toHexString() ??
    holder.imperialCharacterId?.toHexString() ??
    holder.corporationId?.toHexString() ??
    holder.fundId?.toHexString() ??
    holder.nppId?.toHexString() ??
    null
  );
}
