import type { Bond, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/constants/bonds";
import { getPublicShareQuote } from "@/lib/corporations/marketQuote";
import {
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

export type CrossCorpStockHolding = {
  issuerCorpId: string;
  shares: number;
};

/**
 * Bond + IMF receivable components only (₳ anchor) — no cross-corporate equity.
 *
 * **Unit contract (post-v0.2.6):** every bond position and every IMF principal
 * value is anchor-normalized at source via `corpCapitalToAnchor` so the output
 * map contains pure ₳ regardless of per-bond / per-borrower denomination. The
 * share-price formula (sharePriceFormula.ts) and all downstream consumers
 * operate exclusively in ₳; any LOCAL value leaking through this function
 * mis-prices every corp of non-USD-home-currency by the FX ratio (A22).
 */
export function buildBondAndImfPortfolioAnchorByCorpId(
  bondsHeldByCorpId: Map<string, { bond: Bond; units: number }[]>,
  imfPrincipalAnchorByLenderCorpId: Map<string, number>,
  fxByCurrency: Map<CurrencyCode, number>
): Map<string, number> {
  const out = new Map<string, number>();

  function add(holderId: string, delta: number) {
    if (!Number.isFinite(delta) || delta === 0) return;
    out.set(holderId, Math.round((out.get(holderId) ?? 0) + delta));
  }

  for (const [holderId, positions] of bondsHeldByCorpId) {
    let bondAnchorSum = 0;
    for (const { bond, units } of positions) {
      const bondCcy = (bond.currencyCode ??
        (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      const valueLocal = units * BOND_UNIT_FACE_VALUE * bond.marketPrice;
      bondAnchorSum += corpCapitalToAnchor(valueLocal, bondCcy, bondFxRate);
    }
    add(holderId, Math.round(bondAnchorSum));
  }

  for (const [lenderId, principalAnchor] of imfPrincipalAnchorByLenderCorpId) {
    add(lenderId, principalAnchor);
  }

  return out;
}

/**
 * Corp-held positions in other corps' equity (for iterative / consistent cross-pricing).
 */
export function buildCrossCorpStockHoldingsByHolderCorpId(
  corporations: Corporation[]
): Map<string, CrossCorpStockHolding[]> {
  const out = new Map<string, CrossCorpStockHolding[]>();
  for (const issuer of corporations) {
    for (const sh of issuer.shareholders ?? []) {
      if (!sh.corporationId || sh.shares <= 0) continue;
      const holderId = sh.corporationId.toString();
      const list = out.get(holderId) ?? [];
      list.push({ issuerCorpId: issuer._id.toString(), shares: sh.shares });
      out.set(holderId, list);
    }
  }
  return out;
}

/**
 * Cross-corporate stock mark-to-market (₳ anchor) using caller-supplied quotes.
 *
 * **Unit contract:** `sharePriceAnchorByCorpId` must contain ₳-denominated
 * quotes. Post-v0.2.6 `corporation.sharePrice` is LOCAL in the issuer's
 * `liquidCurrencyCode`; callers MUST normalize via `corpCapitalToAnchor`
 * before passing. The iterative share-price formula in sharePriceFormula.ts
 * already maintains its working map in ₳ (previousSharePrice normalized at
 * entry, formula output is ₳) — it can feed this function directly.
 */
export function crossCorpStockAnchorFromQuotes(
  holderCorpId: string,
  holdingsByHolder: Map<string, CrossCorpStockHolding[]>,
  sharePriceAnchorByCorpId: Map<string, number>
): number {
  const holdings = holdingsByHolder.get(holderCorpId);
  if (!holdings?.length) return 0;
  let sum = 0;
  for (const { issuerCorpId, shares } of holdings) {
    const q = sharePriceAnchorByCorpId.get(issuerCorpId);
    if (q == null || !Number.isFinite(q)) continue;
    sum += shares * q;
  }
  return Math.round(sum);
}

/**
 * Mark-to-market portfolio held by each corporation (₳ anchor), matching the
 * corporation balance sheet API: bond holdings, cross-corporate stock, and IMF
 * facility principal receivable. Used by turn share-price so listed equity
 * cannot diverge from reported book solely because the firm is a holding company.
 *
 * Cross-corp positions use each issuer's stored `sharePrice` anchor-normalized
 * via the issuer's `liquidCurrencyCode` + FX — pre-A22 this fed LOCAL quotes
 * directly into the cross-corp sum, producing wildly wrong values for corps
 * that held shares of JPY / GBP corps.
 */
export function buildPortfolioAnchorValueByCorpId(
  corporations: Corporation[],
  bondsHeldByCorpId: Map<string, { bond: Bond; units: number }[]>,
  imfPrincipalAnchorByLenderCorpId: Map<string, number>,
  fxByCurrency: Map<CurrencyCode, number>
): Map<string, number> {
  const bondImf = buildBondAndImfPortfolioAnchorByCorpId(
    bondsHeldByCorpId,
    imfPrincipalAnchorByLenderCorpId,
    fxByCurrency
  );
  const holdings = buildCrossCorpStockHoldingsByHolderCorpId(corporations);
  const quotesAnchor = new Map<string, number>();
  for (const c of corporations) {
    const localQuote = getPublicShareQuote(c);
    const code = resolveCorpLiquidCurrencyCode(c);
    const rate = fxRateForCorpFromMap(c, fxByCurrency);
    quotesAnchor.set(c._id.toString(), corpCapitalToAnchor(localQuote, code, rate));
  }
  const out = new Map(bondImf);
  for (const [holderId] of holdings) {
    const stock = crossCorpStockAnchorFromQuotes(holderId, holdings, quotesAnchor);
    if (stock !== 0) {
      out.set(holderId, Math.round((out.get(holderId) ?? 0) + stock));
    }
  }
  return out;
}

/**
 * Sum IMF facility principal owed to each lender corp (₳ anchor) — borrower
 * docs carry the link. Each borrower's `imfFacilityPrincipalOutstanding` is
 * stored in the borrower's `liquidCurrencyCode` (post-v0.2.6); pre-A22 this
 * function summed raw LOCAL values across borrowers of different currencies,
 * masquerading as ₳ in `buildBondAndImfPortfolioAnchorByCorpId`.
 */
export function buildImfPrincipalAnchorByLenderCorpId(
  corporations: Corporation[],
  fxByCurrency: Map<CurrencyCode, number>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of corporations) {
    if (c.imfBailoutActive !== true || !c.imfBailoutImfCorporationId) continue;
    const lid = c.imfBailoutImfCorporationId.toString();
    const principalLocal = c.imfFacilityPrincipalOutstanding ?? 0;
    const code = resolveCorpLiquidCurrencyCode(c);
    const rate = fxRateForCorpFromMap(c, fxByCurrency);
    const principalAnchor = corpCapitalToAnchor(principalLocal, code, rate);
    map.set(lid, (map.get(lid) ?? 0) + principalAnchor);
  }
  return map;
}
