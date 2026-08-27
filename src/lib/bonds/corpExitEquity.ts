/**
 * Exit equity — ONE asset basis, shared by the two ends of corporate borrowing.
 *
 * A corporation's debt ceiling and the insolvency test that can liquidate it
 * have to be measured against the SAME assets. Ticket #1198: they were not.
 * Issuance quoted `cash + sector NPV + CIP` while {@link
 * import("@/lib/turn/bondTurnHelpers").filterInsolventCorps} valued `cash +
 * sector BOOK`. Under `marketSystemMode: "plants"` those bases differ by ~75x
 * for a built-out corp: #624 was offered a ₳468bn debt ceiling, drew under 1%
 * of it, and was declared insolvent by the same system two turns later.
 *
 * `corpExitEquityAnchor` is that single basis — what the balance sheet would
 * actually realize if the bond debt had to be settled today:
 *
 *     exit equity = liquid capital
 *                 + sector exit value            (book under plants, NPV below)
 *                 + construction in progress     (only where not already inside)
 *                 + held bond portfolio at face
 *
 * The portfolio leg is the second half of #1198. `filterInsolventCorps` ignored
 * it outright, yet {@link
 * import("./executeCorporationBondDefaultDissolution").executeCorporationBondDefaultDissolution}
 * — the liquidation a default leads to — redeems those same creditor holdings
 * at face into `liquidCapital` before it settles anything. The decision to
 * liquidate refused to count assets the liquidation itself spends. #624 held
 * ₳1.79bn of them against a ₳1.40bn shortfall.
 *
 * Every value in and out is in ₳.
 */

import type { Db, ObjectId } from "mongodb";
import type { Bond, Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorpCapitalCurrencyInfo } from "@/lib/currency/corporationCapital";
import { corpCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { sectorExitValueAnchor } from "@/lib/bonds/sectorExitBasis";
import { totalEquityForBonds } from "@/lib/bonds/corporateBondDefault";
import { sumConstructionInProgressAnchor } from "@/lib/corporations/sectorProfitBasis";
import { getGameState } from "@/lib/gameState";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";

/**
 * Σ face value, in ₳, of the bonds `corporationId` holds as a CREDITOR.
 *
 * Face rather than market price, because face is what an exit actually pays:
 * both `previewQuickDissolve` and `executeCorporationBondDefaultDissolution`
 * redeem a dissolving corp's creditor holdings at `units × BOND_UNIT_FACE_VALUE`.
 * Valuing them here at anything else would reopen the preview/executor drift
 * that `sectorExitBasis` exists to prevent.
 *
 * DEFAULTED issues are excluded — deliberately stricter than those two call
 * sites, which redeem whatever is on the books. A defaulted bond will not pay
 * face, and rescuing a corp from liquidation on an asset that cannot be
 * realized is the dangerous direction of this error; `filterInsolventCorps`
 * already makes the same argument for its unreadable-debt fallback.
 *
 * Issuer type is not filtered: sovereign and corporate holdings alike are
 * redeemable claims and both are cashed on dissolution.
 *
 * A corp holding its OWN paper is counted too, and that is correct rather than
 * circular. The debt side of every comparison sums `totalIssued`, which already
 * includes the self-held units, so counting them here nets them back out: the
 * corp does not owe itself. Dropping them would leave the liability standing
 * with its matching asset deleted, and penalize a corp for retiring its own
 * debt. Do not "fix" this by filtering `bond.corporationId === corporationId`
 * without also netting the debt side.
 *
 * Each holding converts through its OWN `currencyCode`, never the holder's, so
 * the result is comparable with ₳-denominated debt and equity.
 */
export function sumHeldBondFaceAnchor(
  bonds: readonly Bond[] | undefined | null,
  corporationId: ObjectId | string,
  fxByCurrency: ReadonlyMap<CurrencyCode, number>
): number {
  const id = corporationId.toString();
  let sum = 0;
  for (const bond of bonds ?? []) {
    if (bond.matured || bond.defaulted) continue;
    const code = (bond.currencyCode ?? undefined) as CurrencyCode | undefined;
    const rate = code ? (fxByCurrency.get(code) ?? 1) : 1;
    // A corp should appear at most once in `holders`, but sum rather than
    // find-first so a duplicated entry is valued, not silently half-dropped.
    for (const holder of bond.holders ?? []) {
      if (holder.corporationId?.toString() !== id) continue;
      if (!(holder.units > 0)) continue;
      sum += corpCapitalToAnchor(holder.units * BOND_UNIT_FACE_VALUE, code, rate);
    }
  }
  return sum;
}

export interface CorpExitEquityInput {
  /** Corp's `liquidCapital` already converted to ₳ by the caller. */
  liquidCapitalAnchor: number;
  /** Sectors; filtered to `corporationId` internally, so a world-wide list is fine. */
  sectors: readonly CorporateSector[] | undefined | null;
  corporationId: ObjectId | string;
  /** Used only on the NPV branch, to normalize sector revenue out of corp-home currency. */
  corp: CorpCapitalCurrencyInfo | Corporation | null | undefined;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
  primeRateByCountry: Map<string, number>;
  /** Every bond in play; filtered to this corp's creditor holdings internally. */
  bonds: readonly Bond[] | undefined | null;
  /** True when `marketSystemMode >= "plants"`. */
  plantsEnabled: boolean;
  /** Game year — era-prices the book basis. Only read under plants. */
  currentYear?: number | null;
  /** The world's era unit-basis scale. Only read under plants. */
  eraUnitScale: number;
}

export interface CorpExitEquity {
  /** The figure both the debt ceiling and the insolvency test compare against. */
  exitEquityAnchor: number;
  sectorExitAnchor: number;
  /** Non-zero only below plants, where the sector basis does not already carry it. */
  constructionInProgressAnchor: number;
  heldBondFaceAnchor: number;
}

/**
 * Realizable equity for a single corporation, on the exit basis.
 *
 * The component parts come back alongside the total so callers can explain a
 * refusal to the CEO in the same units the refusal was computed in.
 */
export function corpExitEquityAnchor(input: CorpExitEquityInput): CorpExitEquity {
  const id = input.corporationId.toString();
  const ownSectors = (input.sectors ?? []).filter((s) => s.corporationId?.toString() === id);

  const sectorExitAnchor = sectorExitValueAnchor(
    ownSectors as CorporateSector[],
    input.primeRateByCountry,
    input.corp,
    input.fxByCurrency,
    {
      plantsEnabled: input.plantsEnabled,
      currentYear: input.currentYear,
      eraUnitScale: input.eraUnitScale,
    }
  );

  // Under plants the exit basis is `sectorBookValueAnchor`, which ALREADY
  // carries construction in progress. Below plants it is the going-concern NPV,
  // which does not — and capitalized build spend is an asset either way (the
  // argument `totalEquityForBonds` documents for its third parameter). Adding
  // the leg only on the NPV branch keeps a mid-build corp whole without
  // double-counting it under plants.
  const constructionInProgressAnchor = input.plantsEnabled
    ? 0
    : sumConstructionInProgressAnchor(ownSectors);

  const heldBondFaceAnchor = sumHeldBondFaceAnchor(input.bonds, id, input.fxByCurrency);

  return {
    exitEquityAnchor:
      totalEquityForBonds(
        input.liquidCapitalAnchor,
        sectorExitAnchor,
        constructionInProgressAnchor
      ) + heldBondFaceAnchor,
    sectorExitAnchor,
    constructionInProgressAnchor,
    heldBondFaceAnchor,
  };
}

/**
 * DB-backed convenience wrapper for the issuance paths, which already hold the
 * corp, its sectors and the FX/prime maps but not the world-level inputs the
 * book basis needs — nor the corp's creditor holdings, which they have no other
 * reason to load.
 *
 * The turn processor does NOT use this: `filterInsolventCorps` already has
 * every non-matured bond in memory and calls {@link corpExitEquityAnchor}
 * directly rather than re-querying per corp.
 */
export async function loadCorpExitEquityAnchor(
  db: Db,
  input: {
    liquidCapitalAnchor: number;
    sectors: readonly CorporateSector[] | undefined | null;
    corporationId: ObjectId;
    corp: CorpCapitalCurrencyInfo | Corporation | null | undefined;
    fxByCurrency: ReadonlyMap<CurrencyCode, number>;
    primeRateByCountry: Map<string, number>;
    plantsEnabled: boolean;
  }
): Promise<CorpExitEquity> {
  const [heldBonds, gameState, eraUnitScale] = await Promise.all([
    db
      .collection<Bond>("bonds")
      .find({ "holders.corporationId": input.corporationId, matured: false })
      .toArray(),
    getGameState(db),
    loadWorldEraUnitScale(db),
  ]);
  return corpExitEquityAnchor({
    ...input,
    bonds: heldBonds,
    currentYear: gameState?.currentYear,
    eraUnitScale,
  });
}
