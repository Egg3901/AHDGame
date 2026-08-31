import type { Bond, Character, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import { getTotalPersonalWealth } from "@/lib/currency/characterFunds";
import { computeLocDebtInternal } from "@/lib/lineOfCredit/netWorth";
import { corpLiquidCapitalToAnchor, fxRateForCorpFromMap } from "@/lib/currency/corporationCapital";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";

/**
 * ONE definition of a character's net worth, in ₳.
 *
 * There were two: the live wealth-list route and the persisted per-turn
 * snapshot each carried their own ~60-line copy. The snapshot is what
 * `wealthChange24h` / `rankChange24h` are computed against, so any difference
 * between the two makes the leaderboard disagree with its own change column —
 * silently, and for every affected player (#592).
 *
 * They had already drifted on the share price: the route resolved it through
 * `getPublicShareQuote` (which falls back to `DEFAULT_SHARE_PRICE`) while the
 * snapshot read `corp.sharePrice ?? 0`. Today every corporation without a real
 * price stores an explicit `0`, so both skip the holding and the outputs agree
 * — the divergence is latent rather than live. It becomes live the moment one
 * corporation has no `sharePrice` field at all. This module resolves the price
 * the market-facing way, once.
 */

/** Per-character valuation components, all in ₳. */
export interface CharacterWealth {
  stockValue: number;
  bondValue: number;
  portfolioValue: number;
  cashValue: number;
  locDebtValue: number;
  totalWealth: number;
}

/** Round to 2dp the way both call sites already did. */
export function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Σ share holdings per character, in ₳. A non-positive quote skips the holding
 * rather than valuing it at zero, so an unpriced corporation cannot drag a
 * portfolio down.
 */
export type CorpWealthSlice = Pick<
  Corporation,
  "_id" | "sharePrice" | "shareholders" | "liquidCurrencyCode"
>;

export type BondWealthSlice = Pick<
  Bond,
  "_id" | "holders" | "marketPrice" | "currencyCode" | "countryId"
>;

export function sumStockValueByCharacter(
  corporations: readonly CorpWealthSlice[],
  characterIdSet: ReadonlySet<string>,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): Map<string, number> {
  const byCharId = new Map<string, number>();
  for (const corp of corporations) {
    const price = getPublicShareQuote(corp);
    if (price <= 0) continue;
    const corpFxRate = fxRateForCorpFromMap(corp, fxByCurrency);
    for (const sh of corp.shareholders ?? []) {
      if (!sh.characterId) continue;
      const charId = sh.characterId.toString();
      if (!characterIdSet.has(charId) || sh.shares <= 0) continue;
      const holdingValue = corpLiquidCapitalToAnchor(sh.shares * price, corp, corpFxRate);
      byCharId.set(charId, (byCharId.get(charId) ?? 0) + holdingValue);
    }
  }
  return byCharId;
}

/**
 * Σ bond holdings per character, in ₳. A bond's currency falls back to its
 * issuing country's, then to no conversion.
 */
export function sumBondValueByCharacter(
  bonds: readonly BondWealthSlice[],
  characterIdSet: ReadonlySet<string>,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): Map<string, number> {
  const byCharId = new Map<string, number>();
  for (const bond of bonds) {
    const bondCcy = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    for (const holder of bond.holders ?? []) {
      if (!holder.characterId || holder.units <= 0) continue;
      const charId = holder.characterId.toString();
      if (!characterIdSet.has(charId)) continue;
      const holdingValueLocal = holder.units * BOND_UNIT_FACE_VALUE * (bond.marketPrice ?? 1);
      const holdingValue =
        bondCcy && bondRate > 0 ? holdingValueLocal / bondRate : holdingValueLocal;
      byCharId.set(charId, (byCharId.get(charId) ?? 0) + holdingValue);
    }
  }
  return byCharId;
}

/**
 * Assemble one character's valuation from the pre-aggregated portfolio maps.
 * `totalWealth` is clamped at zero: a character underwater on a line of credit
 * ranks at the bottom rather than below everyone by a negative amount.
 */
export function computeCharacterWealth(
  character: Character,
  stockValueByCharId: ReadonlyMap<string, number>,
  bondValueByCharId: ReadonlyMap<string, number>,
  forexEnabled: boolean,
  exchangeRates: Partial<Record<CurrencyCode, number>> | undefined
): CharacterWealth {
  const charId = character._id.toString();
  const stockValue = roundCurrency(stockValueByCharId.get(charId) ?? 0);
  const bondValue = roundCurrency(bondValueByCharId.get(charId) ?? 0);
  const portfolioValue = roundCurrency(stockValue + bondValue);
  const cashValue = roundCurrency(getTotalPersonalWealth(character, forexEnabled, exchangeRates));
  const locDebtValue = roundCurrency(computeLocDebtInternal(character, exchangeRates ?? {}));
  const totalWealth = roundCurrency(Math.max(0, portfolioValue + cashValue - locDebtValue));
  return { stockValue, bondValue, portfolioValue, cashValue, locDebtValue, totalWealth };
}
