/**
 * NPP savings command cores (V3 full-agency finance).
 *
 * Lets an autonomous NPP move money between its liquid campaign war-chest
 * (`npp.funds`, stored in LOCAL home currency) and an interest-bearing savings
 * balance (`npp.currencyBalances.savings[homeCcy]`, same LOCAL units — no anchor
 * conversion, since both are home-currency). The savings interest turn phase
 * (v3-gated) accrues APY on that balance, exactly like a player's savings.
 *
 * Both operations are a single atomic findOneAndUpdate with a balance guard, so
 * concurrent turn writes can't drive either bucket negative. Gated upstream by
 * nppAutonomyLevel v3 (callers only invoke these when v3 is active).
 */

import type { Db } from "mongodb";
import type { NPP } from "@/lib/db/types";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";

export type NppSavingsResult =
  | { ok: true; amount: number; currency: string; funds: number; savings: number }
  | { ok: false; reason: string };

/** The home-currency code an NPP's funds/savings are denominated in. */
function homeCurrencyForNpp(npp: Pick<NPP, "countryId">): string {
  return COUNTRY_CURRENCY_MAP[npp.countryId ?? "US"] ?? "USD";
}

/** Move `amount` (LOCAL home currency) from liquid funds into savings. */
export async function depositNppSavings(
  db: Db,
  npp: Pick<NPP, "_id" | "countryId">,
  amount: number
): Promise<NppSavingsResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Deposit amount must be positive." };
  }
  const currency = homeCurrencyForNpp(npp);
  const savingsField = `currencyBalances.savings.${currency}`;

  const updated = await db.collection<NPP>("npps").findOneAndUpdate(
    { _id: npp._id, funds: { $gte: amount } },
    {
      $inc: { funds: -amount, [savingsField]: amount },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after" }
  );
  if (!updated) {
    return { ok: false, reason: "Insufficient liquid funds for deposit." };
  }
  return {
    ok: true,
    amount,
    currency,
    funds: updated.funds ?? 0,
    savings: updated.currencyBalances?.savings?.[currency as never] ?? 0,
  };
}

/** Move `amount` (LOCAL home currency) from savings back into liquid funds. */
export async function withdrawNppSavings(
  db: Db,
  npp: Pick<NPP, "_id" | "countryId">,
  amount: number
): Promise<NppSavingsResult> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "Withdrawal amount must be positive." };
  }
  const currency = homeCurrencyForNpp(npp);
  const savingsField = `currencyBalances.savings.${currency}`;

  const updated = await db.collection<NPP>("npps").findOneAndUpdate(
    { _id: npp._id, [savingsField]: { $gte: amount } },
    {
      $inc: { funds: amount, [savingsField]: -amount },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: "after" }
  );
  if (!updated) {
    return { ok: false, reason: "Insufficient savings for withdrawal." };
  }
  return {
    ok: true,
    amount,
    currency,
    funds: updated.funds ?? 0,
    savings: updated.currencyBalances?.savings?.[currency as never] ?? 0,
  };
}
