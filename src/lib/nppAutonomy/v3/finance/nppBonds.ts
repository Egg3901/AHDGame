/**
 * NPP bond-buy command core (V3 full-agency finance).
 *
 * Lets an autonomous NPP buy bond units from the public float, mirroring the
 * player buy path's money math (cost = units × face × marketPrice, in the bond's
 * LOCAL currency) and using the shared `reserveBondUnitsForHolder` atomic
 * float→holder move with the `nppId` holder variant.
 *
 * Scope constraint: NPPs only buy bonds denominated in their OWN home currency
 * (sovereign paper of their country / shared bloc), so there's no FX leg — the
 * cost in bond-local equals NPP funds units. Keeps the first finance core simple
 * and correct; cross-currency bond buys can come later.
 *
 * Atomicity: deduct funds first (guarded findOneAndUpdate), then reserve units.
 * If the float was taken between read and reserve, the funds are refunded — no
 * partial state. The bondTurn coupon phase pays the nppId holder.
 */

import type { Db, ObjectId } from "mongodb";
import type { Bond, NPP } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import { reserveBondUnitsForHolder } from "@/lib/bonds/bondHolderOps";
import { bondPoolCurrency, creditBondPool } from "@/lib/bonds/marketPool";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { nppHomeFxRate, localToAnchor } from "./nppEconomicAccount";

export type NppBondBuyResult =
  | {
      ok: true;
      bondId: string;
      units: number;
      cost: number;
      costAnchor: number;
      investmentCashAnchor: number;
    }
  | { ok: false; reason: string };

export async function nppBuyBond(
  db: Db,
  npp: Pick<NPP, "_id" | "countryId">,
  bondId: ObjectId,
  units: number,
  currentTurn: number,
  /** Pre-loaded home FX rate (local per ₳); loaded on demand when omitted. */
  homeRate?: number
): Promise<NppBondBuyResult> {
  if (!Number.isInteger(units) || units <= 0) {
    return { ok: false, reason: "Units must be a positive integer." };
  }

  const bond = await db.collection<Bond>("bonds").findOne({ _id: bondId });
  if (!bond) return { ok: false, reason: "Bond not found." };
  if (bond.maturityTurn <= currentTurn) return { ok: false, reason: "Bond has matured." };
  if ((bond.publicFloat ?? 0) < units) {
    return { ok: false, reason: `Only ${bond.publicFloat ?? 0} units available.` };
  }

  const homeCurrency = COUNTRY_CURRENCY_MAP[npp.countryId ?? "US"] ?? "USD";
  if (bond.currencyCode && bond.currencyCode !== homeCurrency) {
    return { ok: false, reason: "NPPs only buy bonds in their home currency." };
  }

  const pricePerUnit = BOND_UNIT_FACE_VALUE * bond.marketPrice;
  const cost = Math.round(units * pricePerUnit * 100) / 100;
  // Bond price is LOCAL; the economic account is ₳ — convert at the FX boundary.
  const rate = homeRate ?? (await nppHomeFxRate(db, npp.countryId));
  const costAnchor = localToAnchor(cost, rate);
  const now = new Date();

  // Deduct from the personal forex account first (atomic guard), then reserve
  // units. NOT campaign `funds` — investing is real-economy, not political.
  const deducted = await db
    .collection<NPP>("npps")
    .findOneAndUpdate(
      { _id: npp._id, nppInvestmentCashAnchor: { $gte: costAnchor } },
      { $inc: { nppInvestmentCashAnchor: -costAnchor }, $set: { updatedAt: now } },
      { returnDocument: "after" }
    );
  if (!deducted) {
    return { ok: false, reason: "Insufficient investment capital for bond purchase." };
  }

  const reserved = await reserveBondUnitsForHolder(
    db,
    bondId,
    { field: "nppId", id: npp._id },
    units,
    now,
    { avgCostPerUnit: Math.round(pricePerUnit * 100) / 100 }
  );
  if (!reserved) {
    // Float was taken between read and reserve — refund and bail, no partial state.
    await db
      .collection<NPP>("npps")
      .updateOne(
        { _id: npp._id },
        { $inc: { nppInvestmentCashAnchor: costAnchor }, $set: { updatedAt: new Date() } }
      );
    return { ok: false, reason: "Bond units no longer available; purchase refunded." };
  }

  await creditBondPool(db, bondPoolCurrency(bond), cost, "purchasesIn", now);

  return {
    ok: true,
    bondId: bondId.toString(),
    units,
    cost,
    costAnchor,
    investmentCashAnchor: deducted.nppInvestmentCashAnchor ?? 0,
  };
}
