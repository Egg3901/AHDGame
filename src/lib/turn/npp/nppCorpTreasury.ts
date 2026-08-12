/**
 * NPP corporate treasury (ticket 1060).
 *
 * Player CEOs park idle liquid capital in high-coupon bonds. NPP caretakers
 * never did, so a corp like Meyer Logistics sat on ~$1.4M against ~$25k/day
 * of revenue while the CEO "ran" the place. Same primitives as the player
 * corp buy path: home-currency paper only, skip own issues, atomic debit
 * then reserve, refund on a missed float.
 *
 * Loss-making corps keep the cash as runway. Surplus is cash above one
 * financial day of revenue; a quarter of that surplus is committed per turn
 * so a raid or plant build is still affordable tomorrow.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Bond, Corporation, CorporateSector, ExchangeRate } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { glutStaggerEligible } from "@/lib/turn/nppCorporationBehavior";
import {
  anchorToCorpCapital,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import {
  atomicallyDebitCorpLiquidCapital,
  refundCorpLiquidCapital,
} from "@/lib/financialTxLog/atomicCashGuard";
import { reserveBondUnitsForHolder } from "@/lib/bonds/bondHolderOps";
import { sovereignBondCapError } from "@/lib/bonds/holderCap";
import { emitTx } from "@/lib/financialTxLog/emit";

/** Keep this many days of revenue as operating cash. Revenue is already daily. */
export const NPP_TREASURY_REVENUE_DAYS = 1;
/** Share of surplus committed to bonds in one turn. */
export const NPP_TREASURY_INVEST_FRACTION = 0.25;
/** Current yield (couponRate / marketPrice) below which cash stays put. */
export const NPP_TREASURY_MIN_YIELD_PCT = 1;

export type NppTreasuryBond = {
  id: string;
  issuerCorpId?: string | null;
  currencyCode: string;
  couponRate: number;
  marketPrice: number;
  publicFloat: number;
  issuerType?: Bond["issuerType"];
  totalIssued?: number;
  faceValue?: number;
  holders?: Bond["holders"];
};

export type NppTreasuryPick = {
  bondId: string;
  units: number;
  costLocal: number;
};

export function nppTreasurySurplus(cashLocal: number, dailyRevenueLocal: number): number {
  const buffer = Math.max(0, dailyRevenueLocal) * NPP_TREASURY_REVENUE_DAYS;
  return Math.max(0, cashLocal - buffer);
}

export function pickNppCorpBond(args: {
  corpId: string;
  cashLocal: number;
  dailyRevenueLocal: number;
  income: number;
  currencyCode: string;
  bonds: readonly NppTreasuryBond[];
}): NppTreasuryPick | null {
  if (!(args.income > 0)) return null;
  if (!(args.cashLocal > 0)) return null;
  const surplus = nppTreasurySurplus(args.cashLocal, args.dailyRevenueLocal);
  const invest = surplus * NPP_TREASURY_INVEST_FRACTION;
  if (!(invest > 0)) return null;

  let best: { bond: NppTreasuryBond; yieldPct: number } | null = null;
  for (const bond of args.bonds) {
    if (bond.currencyCode !== args.currencyCode) continue;
    if (bond.issuerCorpId && bond.issuerCorpId === args.corpId) continue;
    if (!(bond.publicFloat > 0)) continue;
    if (!(bond.marketPrice > 0) || !Number.isFinite(bond.marketPrice)) continue;
    if (!Number.isFinite(bond.couponRate)) continue;
    const yieldPct = bond.couponRate / bond.marketPrice;
    if (yieldPct < NPP_TREASURY_MIN_YIELD_PCT) continue;
    if (!best || yieldPct > best.yieldPct) best = { bond, yieldPct };
  }
  if (!best) return null;

  const unitCost = BOND_UNIT_FACE_VALUE * best.bond.marketPrice;
  if (!(unitCost > 0)) return null;
  let units = Math.floor(invest / unitCost);
  if (units <= 0) return null;
  units = Math.min(units, Math.floor(best.bond.publicFloat));
  if (units <= 0) return null;

  const capErr = sovereignBondCapError(
    {
      issuerType: best.bond.issuerType,
      totalIssued: best.bond.totalIssued,
      faceValue: best.bond.faceValue,
      holders: best.bond.holders,
    } as Bond,
    "corporationId",
    new ObjectId(args.corpId),
    units
  );
  if (capErr) {
    const faceValue = best.bond.faceValue || BOND_UNIT_FACE_VALUE;
    const totalUnits = (best.bond.totalIssued ?? 0) / faceValue;
    const capUnits = Math.floor(0.25 * totalUnits);
    const held =
      best.bond.holders?.find((h) => h.corporationId?.toString() === args.corpId)?.units ?? 0;
    units = Math.max(0, capUnits - held);
    if (units <= 0) return null;
    units = Math.min(units, Math.floor(best.bond.publicFloat));
    if (units <= 0) return null;
  }

  const costLocal = Math.round(units * unitCost * 100) / 100;
  if (!(costLocal > 0) || costLocal > args.cashLocal) return null;
  return { bondId: best.bond.id, units, costLocal };
}

function resolveBondCurrency(bond: Bond, fallbackCountry: string | undefined): CurrencyCode {
  if (bond.currencyCode) return bond.currencyCode as CurrencyCode;
  if (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  if (fallbackCountry && fallbackCountry in COUNTRY_CURRENCY_MAP) {
    return COUNTRY_CURRENCY_MAP[fallbackCountry as keyof typeof COUNTRY_CURRENCY_MAP];
  }
  return "USD";
}

export async function processNppCorpTreasury(
  db: Db,
  turn: number,
  now: Date
): Promise<number> {
  const nppCorps = await db
    .collection<Corporation>("corporations")
    .find(
      { ceoType: "npp", suspended: { $ne: true } },
      {
        projection: {
          countryId: 1,
          countryOwnerId: 1,
          ownershipState: 1,
          liquidCapital: 1,
          liquidCurrencyCode: 1,
          earningsHistory: 1,
          name: 1,
        },
      }
    )
    .toArray();
  if (nppCorps.length === 0) return 0;

  const corpIds = nppCorps.map((c) => c._id);
  const sectors = await db
    .collection<CorporateSector>("corporateSectors")
    .find(
      { corporationId: { $in: corpIds } },
      { projection: { corporationId: 1, countryId: 1, stateId: 1, revenue: 1, realizedRevenue: 1 } }
    )
    .toArray();
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const key = s.corporationId.toString();
    const list = sectorsByCorp.get(key) ?? [];
    list.push(s);
    sectorsByCorp.set(key, list);
  }

  const fxByCurrency = new Map<string, number>();
  for (const rate of await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()) {
    if (rate.currencyCode && typeof rate.rate === "number" && rate.rate > 0) {
      fxByCurrency.set(rate.currencyCode, rate.rate);
    }
  }

  const liveBonds = await db
    .collection<Bond>("bonds")
    .find({
      matured: { $ne: true },
      defaulted: { $ne: true },
      publicFloat: { $gt: 0 },
      maturityTurn: { $gt: turn },
    })
    .toArray();
  if (liveBonds.length === 0) return 0;

  const bondsByCurrency = new Map<string, NppTreasuryBond[]>();
  const bondById = new Map<string, Bond>();
  for (const bond of liveBonds) {
    const currency = resolveBondCurrency(bond, bond.countryId);
    const row: NppTreasuryBond = {
      id: bond._id.toString(),
      issuerCorpId: bond.corporationId?.toString() ?? null,
      currencyCode: currency,
      couponRate: bond.couponRate,
      marketPrice: bond.marketPrice,
      publicFloat: bond.publicFloat,
      issuerType: bond.issuerType,
      totalIssued: bond.totalIssued,
      faceValue: bond.faceValue,
      holders: bond.holders,
    };
    const list = bondsByCurrency.get(currency) ?? [];
    list.push(row);
    bondsByCurrency.set(currency, list);
    bondById.set(row.id, bond);
  }

  let bought = 0;
  for (const corp of nppCorps) {
    if (isStateOwned(corp)) continue;
    if (!glutStaggerEligible(corp._id.toString(), turn)) continue;
    const currencyCode = resolveCorpLiquidCurrencyCode(corp);
    if (!currencyCode) continue;
    const corpFx = fxByCurrency.get(currencyCode) || 1;
    const toCorpLocal = (amountAnchor: number) =>
      anchorToCorpCapital(amountAnchor, currencyCode, corpFx);
    let dailyRevenueLocal = 0;
    for (const s of sectorsByCorp.get(corp._id.toString()) ?? []) {
      const hostCurrency = resolveSectorHostCurrencyCode(s, corp);
      const hostRate =
        (hostCurrency && fxByCurrency.get(hostCurrency)) ??
        (hostCurrency === currencyCode ? corpFx : 1);
      dailyRevenueLocal += toCorpLocal(
        readCorpEconomicAnchor(s.realizedRevenue ?? s.revenue ?? 0, hostCurrency, hostRate)
      );
    }
    const lastEarnings = corp.earningsHistory?.[corp.earningsHistory.length - 1] ?? 0;
    const pick = pickNppCorpBond({
      corpId: corp._id.toString(),
      cashLocal: corp.liquidCapital ?? 0,
      dailyRevenueLocal,
      income: lastEarnings,
      currencyCode,
      bonds: bondsByCurrency.get(currencyCode) ?? [],
    });
    if (!pick) continue;

    const bond = bondById.get(pick.bondId);
    if (!bond) continue;
    const capErr = sovereignBondCapError(bond, "corporationId", corp._id, pick.units);
    if (capErr) continue;

    const debit = await atomicallyDebitCorpLiquidCapital(db, corp._id, pick.costLocal);
    if (!debit.ok) continue;
    try {
      const reserved = await reserveBondUnitsForHolder(
        db,
        bond._id,
        { field: "corporationId", id: corp._id },
        pick.units,
        now
      );
      if (!reserved) {
        await refundCorpLiquidCapital(db, corp._id, pick.costLocal);
        continue;
      }
      await emitTx(db, {
        type: "bond_purchase",
        turn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: corp._id,
        subjectName: corp.name,
        amount: -pick.costLocal,
        balanceAfter: debit.newBalance,
        currencyCode,
        counterpartyType: "system",
        counterpartyName: bond.issuerName ?? "Bond market",
        meta: {
          bondId: bond._id.toString(),
          units: pick.units,
          pricePerUnit: bond.marketPrice,
          nppTreasury: true,
        },
      });
      bought += 1;
      const book = bondsByCurrency.get(currencyCode);
      const row = book?.find((b) => b.id === pick.bondId);
      if (row) row.publicFloat = Math.max(0, row.publicFloat - pick.units);
      bond.publicFloat = Math.max(0, (bond.publicFloat ?? 0) - pick.units);
    } catch (err) {
      await refundCorpLiquidCapital(db, corp._id, pick.costLocal);
      throw err;
    }
  }
  return bought;
}
