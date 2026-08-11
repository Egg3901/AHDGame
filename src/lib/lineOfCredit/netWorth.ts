import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { Bond, Corporation, BondHolder } from "@/lib/db/types";
import type { Shareholder } from "@/lib/db/types/corporation";
import type { CountryId } from "@/lib/constants/countries";
import type { ExchangeRate } from "@/lib/db/types/exchangeRate";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { getTotalPersonalWealth } from "@/lib/currency/characterFunds";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import { getBondCountryId, isCorporateBond } from "@/lib/bonds/sovereign";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { sumObligationInternal, toInternalUnits } from "./locMath";

/**
 * Total player net worth in internal units: liquid + savings + stocks + bonds.
 * Aligns with portfolio valuation and forex internal-unit semantics.
 */
export async function computePlayerNetWorthInternal(
  db: Db,
  character: Character,
  forexEnabled: boolean,
  exchangeRates: Partial<Record<CurrencyCode, number>>
): Promise<number> {
  const cashInternal = getTotalPersonalWealth(character, forexEnabled, exchangeRates);
  if (!forexEnabled) {
    return cashInternal;
  }

  const charId = character._id;
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ "shareholders.characterId": charId })
    .project({ sharePrice: 1, shareholders: 1, countryId: 1 })
    .toArray();

  let stockInternal = 0;
  for (const corp of corporations) {
    const sh = (corp.shareholders ?? []).find(
      (s: Shareholder) => s.characterId?.toString() === charId.toString()
    );
    if (!sh || sh.shares <= 0) continue;
    const quote = getPublicShareQuote(corp);
    const value = sh.shares * quote;
    const cur = COUNTRY_CURRENCY_MAP[corp.countryId as CountryId] ?? "USD";
    const rate = exchangeRates[cur];
    if (rate && rate > 0) stockInternal += toInternalUnits(value, rate);
  }

  const bonds = await db
    .collection<Bond>("bonds")
    .find({ "holders.characterId": charId, matured: false })
    .project({ holders: 1, marketPrice: 1, corporationId: 1, currencyCode: 1, countryId: 1 })
    .toArray();

  let bondInternal = 0;
  if (bonds.length > 0) {
    const corpIds = [
      ...new Set(bonds.filter(isCorporateBond).map((b) => b.corporationId.toString())),
    ];
    const corps = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } })
      .project({ countryId: 1 })
      .toArray();
    const corpCountry = new Map(corps.map((c) => [c._id.toString(), c.countryId]));

    for (const bond of bonds) {
      const holder = bond.holders.find(
        (h: BondHolder) => h.characterId?.toString() === charId.toString()
      );
      if (!holder || holder.units <= 0) continue;
      const value = holder.units * BOND_UNIT_FACE_VALUE * bond.marketPrice;
      // Bond denomination — `bond.currencyCode` is canonical (Task-18B);
      // fall back to the bond's country currency only for pre-migration rows
      // and never to the issuing corp's current countryId (admin HQ moves
      // don't change the bond's denomination — see corporations.md §HQ
      // Relocation → Bond denomination). (A23)
      const bondCcy = (bond.currencyCode ??
        (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      // Fall back to the holder/issuer country's currency only when the bond
      // itself has neither `currencyCode` nor `countryId` (pre-migration
      // corporate bond with no currency metadata).
      const fallbackCid = isCorporateBond(bond)
        ? (corpCountry.get(bond.corporationId.toString()) ?? character.countryId)
        : getBondCountryId(bond);
      const cur = bondCcy ?? COUNTRY_CURRENCY_MAP[fallbackCid as CountryId] ?? "USD";
      const rate = exchangeRates[cur];
      if (rate && rate > 0) bondInternal += toInternalUnits(value, rate);
    }
  }

  return cashInternal + stockInternal + bondInternal;
}

/** LOC principal + arrears in internal units (for debt burden and net-worth scoring). */
export function computeLocDebtInternal(
  character: Character,
  rates: Partial<Record<CurrencyCode, number>>
): number {
  const loc = character.lineOfCredit;
  if (!loc) return 0;
  const homeCurrency =
    COUNTRY_CURRENCY_MAP[character.countryId as CountryId] ?? ("USD" as CurrencyCode);
  const effectiveRates =
    rates[homeCurrency] != null && rates[homeCurrency]! > 0
      ? rates
      : { ...rates, [homeCurrency]: 1 };
  return sumObligationInternal(loc.balances ?? {}, loc.arrears ?? {}, effectiveRates);
}

/**
 * Gross portfolio wealth vs LOC debt vs economic net (assets minus LOC).
 * Cap uses gross assets; credit scoring uses net and leverage.
 */
export async function computePlayerGrossNetLocInternal(
  db: Db,
  character: Character,
  forexEnabled: boolean,
  rates: Partial<Record<CurrencyCode, number>>
): Promise<{ grossInternal: number; locDebtInternal: number; netInternal: number }> {
  const grossInternal = await computePlayerNetWorthInternal(db, character, forexEnabled, rates);
  const locDebtInternal = computeLocDebtInternal(character, rates);
  return {
    grossInternal,
    locDebtInternal,
    netInternal: Math.max(0, grossInternal - locDebtInternal),
  };
}

export async function loadExchangeRatesMap(db: Db): Promise<Partial<Record<CurrencyCode, number>>> {
  const ratesDocs = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();
  return Object.fromEntries(ratesDocs.map((r) => [r.currencyCode, r.rate])) as Partial<
    Record<CurrencyCode, number>
  >;
}
