import type { Db, ObjectId } from "mongodb";
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
  /** Index fund units x quoted NAV, in ₳. */
  fundValue: number;
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

export type FundPositionSlice = {
  fundId: ObjectId;
  characterId?: ObjectId;
  units?: number;
};

/**
 * Σ index fund holdings per character, in ₳. `quotedNav` and every other fund
 * leg are already ₳, so units x NAV needs no conversion. Subscribing debits
 * cash and creates a position; until this term existed the wealth list and its
 * persisted snapshots never counted it, so buying a fund made a player look
 * poorer while the Legacy leaderboard and portfolio history (which do count it)
 * disagreed with the ranking.
 */
export function sumFundValueByCharacter(
  positions: readonly FundPositionSlice[],
  navByFundId: ReadonlyMap<string, number>,
  characterIdSet: ReadonlySet<string>
): Map<string, number> {
  const byCharId = new Map<string, number>();
  for (const position of positions) {
    const charId = position.characterId?.toString();
    if (!charId || !characterIdSet.has(charId)) continue;
    const units = position.units ?? 0;
    const nav = navByFundId.get(position.fundId.toString()) ?? 0;
    const value = units * nav;
    if (!(value > 0)) continue;
    byCharId.set(charId, (byCharId.get(charId) ?? 0) + value);
  }
  return byCharId;
}

/** Load character fund positions and their funds' quoted NAV, then sum. */
export async function loadFundValueByCharacter(
  db: Db,
  characterIds: readonly ObjectId[],
  characterIdSet: ReadonlySet<string>
): Promise<Map<string, number>> {
  if (characterIds.length === 0) return new Map();
  const positions = await db
    .collection<FundPositionSlice & { holderKind: string }>("indexFundPositions")
    .find(
      { holderKind: "character", characterId: { $in: [...characterIds] }, units: { $gt: 0 } },
      { projection: { fundId: 1, characterId: 1, units: 1 } }
    )
    .toArray();
  if (positions.length === 0) return new Map();
  const fundIds = [...new Map(positions.map((p) => [p.fundId.toString(), p.fundId])).values()];
  const funds = await db
    .collection<{ _id: ObjectId; quotedNav?: number }>("indexFunds")
    .find({ _id: { $in: fundIds } }, { projection: { quotedNav: 1 } })
    .toArray();
  const navByFundId = new Map(funds.map((f) => [f._id.toString(), f.quotedNav ?? 0]));
  return sumFundValueByCharacter(positions, navByFundId, characterIdSet);
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
  exchangeRates: Partial<Record<CurrencyCode, number>> | undefined,
  fundValueByCharId: ReadonlyMap<string, number> = new Map()
): CharacterWealth {
  const charId = character._id.toString();
  const stockValue = roundCurrency(stockValueByCharId.get(charId) ?? 0);
  const bondValue = roundCurrency(bondValueByCharId.get(charId) ?? 0);
  const fundValue = roundCurrency(fundValueByCharId.get(charId) ?? 0);
  const portfolioValue = roundCurrency(stockValue + bondValue + fundValue);
  const cashValue = roundCurrency(getTotalPersonalWealth(character, forexEnabled, exchangeRates));
  const locDebtValue = roundCurrency(computeLocDebtInternal(character, exchangeRates ?? {}));
  const totalWealth = roundCurrency(Math.max(0, portfolioValue + cashValue - locDebtValue));
  return { stockValue, bondValue, fundValue, portfolioValue, cashValue, locDebtValue, totalWealth };
}
