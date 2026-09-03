/**
 * Primary bond market: the pool underwrites new issues with real cash.
 *
 * Before this, a new bond was fully funded the instant it was issued, with
 * every unit parked in a float nobody had paid for. Now the currency's bond
 * market pool buys what it can afford and wants; the issuer is credited for
 * exactly those units. The rest sits on the bond as `unsoldUnits` and places
 * turn by turn as the pool's cash allows (`placeUnsoldBondUnits`), at the
 * pool's ask. Unsold units are not debt: no coupon, not in `totalIssued`.
 *
 * Sovereign shortfalls feed the sovereign-default auction classifier through
 * `FederalBudget.lastPrimaryFillRatio`. An autonomous central bank monetizes a
 * bounded part of the shortfall; a player-run one is told and left to act.
 */

import type { Db, ObjectId } from "mongodb";
import type { Bond, BondMarketPool, CentralBank, FederalBudget } from "@/lib/db/types";
import type { CreditRating } from "@/lib/db/types/centralBank";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { BOND_MARKET_POOLS_COLLECTION } from "@/lib/db/types/bondMarketPool";
import { BASE_DEMAND } from "@/lib/sovereignDefault/constants";
import {
  BOND_POOL_M2_SHARE,
  bondPoolCurrency,
  debitBondPoolGated,
  loadBondQuote,
} from "@/lib/bonds/marketPool";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { applySovereignDebtAdjustment, getNationalBudgetId } from "@/lib/bonds/sovereign";
import { ObjectId as MongoObjectId } from "mongodb";

/** Share of the pool's cash one corporate issue may take at issuance. */
export const CORPORATE_PRIMARY_COMMIT_SHARE = 0.2;
/** Share of the pool's cash one quarterly sovereign auction may take. */
export const SOVEREIGN_PRIMARY_COMMIT_SHARE = 0.9;
/** Appetite floor: even a shunned sovereign finds some buyers. */
export const SOVEREIGN_PRIMARY_MIN_APPETITE_FACTOR = 0.1;
/** Per-turn placement cap for unsold units, as a share of the requested size. */
export const UNSOLD_PLACEMENT_SHARE_PER_TURN = 0.02;
/** Share of the pool's spendable cash one turn of placement may use, across all bonds in the currency. */
export const UNSOLD_PLACEMENT_CASH_SHARE_PER_TURN = 0.1;
/**
 * Share of the pool's target kept back from placement. The target carries the
 * next quarter's sovereign rollover, and placing old unsold units out of that
 * reserve left Austria's t612 auction facing an empty pool (0.02% fill) in the
 * clone sim. Placement only spends cash above this floor.
 */
export const UNSOLD_PLACEMENT_RESERVE_SHARE = 0.5;

/** Cash a pool may spend on placing unsold units this turn. */
export function unsoldPlacementBudget(cashLocal: number, targetCashLocal: number): number {
  const cash = Number.isFinite(cashLocal) && cashLocal > 0 ? cashLocal : 0;
  const target = Number.isFinite(targetCashLocal) && targetCashLocal > 0 ? targetCashLocal : 0;
  return (
    Math.max(0, cash - target * UNSOLD_PLACEMENT_RESERVE_SHARE) *
    UNSOLD_PLACEMENT_CASH_SHARE_PER_TURN
  );
}
/** Autonomous central bank monetization of a sovereign shortfall, cap per auction as a share of GDP. */
export const SOVEREIGN_MONETIZATION_GDP_CAP = 0.02;

/** How much of a corporate issue the pool will write, by credit tier. */
export const CORPORATE_PRIMARY_RATING_FACTOR: Record<CreditRating, number> = {
  AAA: 1,
  AA: 1,
  A: 0.9,
  BBB: 0.75,
  BB: 0.5,
  B: 0.35,
  CCC: 0.2,
};

export interface UnderwritingPlan {
  requestedUnits: number;
  placedUnits: number;
  unsoldUnits: number;
  fillRatio: number;
  capacityLocal: number;
}

function wholeUnits(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Corporate capacity: a slice of the pool's secondary-liquidity cash (the
 * M2-share component, not the sovereign rollover working balance), scaled by
 * the issuer's credit tier.
 */
export function planCorporateUnderwriting(input: {
  requestedUnits: number;
  poolCashLocal: number;
  poolM2Local: number | undefined;
  rating: CreditRating;
  pricePerUnitLocal: number;
}): UnderwritingPlan {
  const requested = wholeUnits(input.requestedUnits);
  const liquidityCash = Math.min(
    Math.max(0, input.poolCashLocal),
    input.poolM2Local && input.poolM2Local > 0
      ? input.poolM2Local * BOND_POOL_M2_SHARE
      : Math.max(0, input.poolCashLocal)
  );
  const factor =
    CORPORATE_PRIMARY_RATING_FACTOR[input.rating] ?? CORPORATE_PRIMARY_RATING_FACTOR.CCC;
  const capacityLocal = liquidityCash * CORPORATE_PRIMARY_COMMIT_SHARE * factor;
  const capacityUnits =
    input.pricePerUnitLocal > 0 ? Math.floor(capacityLocal / input.pricePerUnitLocal) : 0;
  const placed = Math.min(requested, Math.max(0, capacityUnits));
  return {
    requestedUnits: requested,
    placedUnits: placed,
    unsoldUnits: requested - placed,
    fillRatio: requested > 0 ? placed / requested : 1,
    capacityLocal,
  };
}

/**
 * Sovereign capacity: most of the pool's cash (the rollover working balance
 * is there for exactly this), scaled by the demand model's appetite for the
 * issuer relative to its neutral baseline.
 */
export function planSovereignUnderwriting(input: {
  requestedUnits: number;
  poolCashLocal: number;
  appetite: number | undefined;
  pricePerUnitLocal: number;
}): UnderwritingPlan {
  const requested = wholeUnits(input.requestedUnits);
  const appetite = Number.isFinite(input.appetite) ? (input.appetite as number) : BASE_DEMAND;
  const factor = Math.max(
    SOVEREIGN_PRIMARY_MIN_APPETITE_FACTOR,
    Math.min(1, appetite / BASE_DEMAND)
  );
  const capacityLocal = Math.max(0, input.poolCashLocal) * SOVEREIGN_PRIMARY_COMMIT_SHARE * factor;
  const capacityUnits =
    input.pricePerUnitLocal > 0 ? Math.floor(capacityLocal / input.pricePerUnitLocal) : 0;
  const placed = Math.min(requested, Math.max(0, capacityUnits));
  return {
    requestedUnits: requested,
    placedUnits: placed,
    unsoldUnits: requested - placed,
    fillRatio: requested > 0 ? placed / requested : 1,
    capacityLocal,
  };
}

/** Units of a bond's unsold remainder the pool may place this turn, before cash limits. */
export function unsoldPlacementCap(requestedUnits: number, unsoldUnits: number): number {
  const unsold = wholeUnits(unsoldUnits);
  if (unsold <= 0) return 0;
  const cap = Math.max(1, Math.floor(wholeUnits(requestedUnits) * UNSOLD_PLACEMENT_SHARE_PER_TURN));
  return Math.min(unsold, cap);
}

export async function readPoolForPrimary(
  db: Db,
  currency: CurrencyCode
): Promise<Pick<
  BondMarketPool,
  "cashLocal" | "targetCashLocal" | "m2Local" | "appetiteByCountry"
> | null> {
  const pool = await db
    .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
    .findOne(
      { _id: currency },
      { projection: { cashLocal: 1, targetCashLocal: 1, m2Local: 1, appetiteByCountry: 1 } }
    );
  return pool ?? null;
}

/**
 * Pay the pool's side of a primary placement. Returns the cash actually
 * debited (zero when the pool could not cover it, in which case the caller
 * places nothing). Par at issuance; the pool's ask for later placements.
 */
export async function debitPoolForPrimary(
  db: Db,
  currency: CurrencyCode,
  units: number,
  pricePerUnitLocal: number,
  now: Date
): Promise<number> {
  const amount = Math.round(units * pricePerUnitLocal * 100) / 100;
  if (!(amount > 0)) return 0;
  const debit = await debitBondPoolGated(db, currency, amount, "issuanceOut", now);
  return debit.ok ? amount : 0;
}

export interface PlacementResult {
  bondsTouched: number;
  unitsPlaced: number;
  corporateProceedsByCorp: Map<string, { local: number; currency: CurrencyCode }>;
  sovereignFaceByCountry: Map<CountryId, { face: number; annualCoupon: number }>;
}

/**
 * Per-turn placement of unsold units, one pass over every live bond with an
 * unsold remainder. Spends at most a slice of each pool's cash per turn so a
 * big unplaced issue cannot drain the secondary market. Returns what was
 * placed so the caller can credit the issuers (corporate liquidCapital in the
 * corp's currency, sovereign budget principal) in its own currency-aware way.
 */
export async function placeUnsoldBondUnits(
  db: Db,
  turn: number,
  now: Date
): Promise<PlacementResult> {
  const result: PlacementResult = {
    bondsTouched: 0,
    unitsPlaced: 0,
    corporateProceedsByCorp: new Map(),
    sovereignFaceByCountry: new Map(),
  };
  const bonds = await db
    .collection<Bond>("bonds")
    .find({ unsoldUnits: { $gt: 0 }, matured: false, defaulted: false })
    .sort({ issuedAtTurn: 1 })
    .toArray();
  const placing = bonds.filter((bond) => (bond.unsoldUnits ?? 0) > 0 && !bond.matured);
  if (placing.length === 0) return result;

  const budgetByCurrency = new Map<CurrencyCode, number>();
  for (const bond of placing) {
    const currency = bondPoolCurrency(bond);
    if (!budgetByCurrency.has(currency)) {
      const pool = await readPoolForPrimary(db, currency);
      budgetByCurrency.set(
        currency,
        unsoldPlacementBudget(pool?.cashLocal ?? 0, pool?.targetCashLocal ?? 0)
      );
    }
    let budget = budgetByCurrency.get(currency) ?? 0;
    if (budget <= 0) continue;

    const quote = await loadBondQuote(db, bond);
    const price = quote.askPerUnit;
    if (!(price > 0)) continue;
    const cap = unsoldPlacementCap(
      bond.requestedUnits ?? bond.unsoldUnits ?? 0,
      bond.unsoldUnits ?? 0
    );
    const units = Math.min(cap, Math.floor(budget / price));
    if (units <= 0) continue;

    const paid = await debitPoolForPrimary(db, currency, units, price, now);
    if (paid <= 0) continue;
    const face = units * BOND_UNIT_FACE_VALUE;
    const claim = await db.collection<Bond>("bonds").updateOne(
      { _id: bond._id, unsoldUnits: { $gte: units } },
      {
        $inc: { unsoldUnits: -units, publicFloat: units, totalIssued: face },
        $set: { updatedAt: now },
      }
    );
    if (claim.modifiedCount === 0) {
      // Someone else moved the units first; give the pool its cash back.
      await db
        .collection<BondMarketPool>(BOND_MARKET_POOLS_COLLECTION)
        .updateOne(
          { _id: currency },
          { $inc: { cashLocal: paid, "lifetime.issuanceOut": -paid }, $set: { updatedAt: now } }
        );
      continue;
    }
    budget -= paid;
    budgetByCurrency.set(currency, budget);
    result.bondsTouched++;
    result.unitsPlaced += units;

    if (bond.issuerType === "sovereign" && bond.countryId) {
      const row = result.sovereignFaceByCountry.get(bond.countryId) ?? { face: 0, annualCoupon: 0 };
      row.face += face;
      row.annualCoupon += ((bond.couponRate ?? 0) / 100) * face;
      result.sovereignFaceByCountry.set(bond.countryId, row);
    } else {
      const key = bond.corporationId.toString();
      const row = result.corporateProceedsByCorp.get(key) ?? { local: 0, currency };
      row.local += paid;
      result.corporateProceedsByCorp.set(key, row);
    }
  }
  return result;
}

export interface MonetizationPlan {
  units: number;
  considerationLocal: number;
}

/** How many unsold units an autonomous central bank takes onto its own book. */
export function planSovereignMonetization(input: {
  unsoldUnits: number;
  gdpLocal: number;
  pricePerUnitLocal: number;
}): MonetizationPlan {
  const unsold = wholeUnits(input.unsoldUnits);
  if (unsold <= 0 || !(input.pricePerUnitLocal > 0) || !(input.gdpLocal > 0)) {
    return { units: 0, considerationLocal: 0 };
  }
  const capUnits = Math.floor(
    (input.gdpLocal * SOVEREIGN_MONETIZATION_GDP_CAP) / input.pricePerUnitLocal
  );
  const units = Math.min(unsold, Math.max(0, capUnits));
  return { units, considerationLocal: Math.round(units * input.pricePerUnitLocal * 100) / 100 };
}

/**
 * An autonomous central bank buys unsold sovereign units straight onto its
 * balance sheet at par, creating deposits the same way QE does. The units
 * become real debt (`totalIssued`) held by the bank (`centralBankHoldings`).
 */
export async function monetizeUnsoldSovereignUnits(
  db: Db,
  args: {
    bondId: ObjectId;
    bank: Pick<CentralBank, "_id">;
    units: number;
    considerationLocal: number;
    turn: number;
    now: Date;
  }
): Promise<boolean> {
  if (args.units <= 0) return false;
  const face = args.units * BOND_UNIT_FACE_VALUE;
  const claim = await db.collection<Bond>("bonds").updateOne(
    { _id: args.bondId, unsoldUnits: { $gte: args.units } },
    {
      $inc: { unsoldUnits: -args.units, centralBankHoldings: args.units, totalIssued: face },
      $set: { updatedAt: args.now },
    }
  );
  if (claim.modifiedCount === 0) return false;
  const refreshed = await db
    .collection<Bond>("bonds")
    .findOne({ _id: args.bondId }, { projection: { totalIssued: 1, centralBankHoldings: 1 } });
  const totalUnits = Math.max(1, (refreshed?.totalIssued ?? face) / BOND_UNIT_FACE_VALUE);
  const qeSupportRatio = Math.min(
    1,
    Math.max(0, (refreshed?.centralBankHoldings ?? args.units) / totalUnits)
  );
  await db.collection<Bond>("bonds").updateOne({ _id: args.bondId }, { $set: { qeSupportRatio } });
  await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: args.bank._id },
    {
      $inc: {
        externalBroadMoney: args.considerationLocal,
        netMoneyCreatedLifetime: args.considerationLocal,
      },
      $set: { lastMonetaryOperationTurn: args.turn, updatedAt: args.now },
      $push: {
        monetaryOperations: {
          $each: [
            {
              type: "qe" as const,
              turn: args.turn,
              amount: args.considerationLocal,
              moneySupplyDelta: args.considerationLocal,
              reserveDelta: 0,
              bondId: args.bondId.toString(),
              units: args.units,
              actorName: "Autonomous chair",
              reason: "Primary auction shortfall: bank took the unsold tranche at par",
              createdAt: args.now,
            },
          ],
          $slice: -100,
        },
      },
    }
  );
  return true;
}

/** Record the latest primary auction on the budget for the crisis classifier. */
export async function recordSovereignPrimaryFill(
  db: Db,
  budgetId: string,
  fillRatio: number,
  turn: number,
  now: Date
): Promise<void> {
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId } as { _id: "federal" }, {
      $set: {
        lastPrimaryFillRatio: Math.round(fillRatio * 10_000) / 10_000,
        lastPrimaryAuctionTurn: turn,
        updatedAt: now,
      },
    });
}

/**
 * Credit issuers for units the pool placed this turn: corporate liquidCapital
 * in the corp's own currency (through anchor), sovereign budget principal and
 * interest line through the same adjustment issuance uses.
 */
export async function settlePlacementProceeds(
  db: Db,
  placement: PlacementResult,
  fxByCurrency: Map<string, number>,
  now: Date
): Promise<void> {
  for (const [corpIdStr, row] of placement.corporateProceedsByCorp) {
    if (!(row.local > 0)) continue;
    const corp = await db
      .collection<{ _id: ObjectId; liquidCurrencyCode?: string; countryId?: string }>(
        "corporations"
      )
      .findOne(
        { _id: new MongoObjectId(corpIdStr) },
        { projection: { liquidCurrencyCode: 1, countryId: 1 } }
      );
    if (!corp) continue;
    const bondRate = fxByCurrency.get(row.currency) ?? 1;
    const anchor = corpCapitalToAnchor(row.local, row.currency, bondRate);
    const corpCurrency = resolveCorpLiquidCurrencyCode(corp as never);
    const corpRate = corpCurrency ? (fxByCurrency.get(corpCurrency) ?? 1) : 1;
    const local = anchorToCorpCapital(anchor, corpCurrency, corpRate);
    if (!(local > 0)) continue;
    await db
      .collection("corporations")
      .updateOne({ _id: corp._id }, { $inc: { liquidCapital: local }, $set: { updatedAt: now } });
  }
  for (const [countryId, row] of placement.sovereignFaceByCountry) {
    if (!(row.face > 0)) continue;
    const budgetId = getNationalBudgetId(countryId);
    const budget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: budgetId });
    if (!budget) continue;
    const update = applySovereignDebtAdjustment(budget, row.face, row.annualCoupon);
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budgetId },
      {
        $set: {
          debt: update.debt,
          spending: update.spending,
          surplus: update.surplus,
          debtToGdpRatio: update.debtToGdpRatio,
          creditRating: update.creditRating,
          updatedAt: now,
        },
      }
    );
  }
}
