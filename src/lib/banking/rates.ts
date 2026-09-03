import type { Db, ObjectId } from "mongodb";
import type { BankCharter } from "@/lib/db/types/bank";
import type { Corporation } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { isPrivateBankingEnabled } from "@/lib/banking/featureFlag";
import { getRateCorridors, isOffsetInCorridor } from "@/lib/banking/regulationQ";
import { charterMay } from "@/lib/banking/rules/capabilities";

/** Floor on effective deposit rate (percent). Provisional - flagged for user review. */
export const MIN_DEPOSIT_RATE_PERCENT = 0.05;

/** Floor on effective lending rate (percent). Provisional - flagged for user review. */
export const MIN_LENDING_RATE_PERCENT = 0.1;

export type SetBankRatesResult =
  { ok: true; depositOffset: number; lendingOffset: number } | { ok: false; error: string };

/**
 * CEO sets deposit and lending offsets against prime. Rejects out-of-corridor
 * values (does not silently clamp). Investment charters take no deposits and
 * cannot set rates through this path.
 */
export async function setBankRates(
  db: Db,
  corporationId: ObjectId,
  depositOffset: number,
  lendingOffset: number
): Promise<SetBankRatesResult> {
  if (!(await isPrivateBankingEnabled())) {
    return { ok: false, error: "Private banking is not enabled" };
  }

  if (!Number.isFinite(depositOffset) || !Number.isFinite(lendingOffset)) {
    return { ok: false, error: "Rate offsets must be finite numbers" };
  }

  const corporation = await db.collection<Corporation>("corporations").findOne({
    _id: corporationId,
  });
  if (!corporation) {
    return { ok: false, error: "Corporation not found" };
  }

  const charter = corporation.bankCharter;
  if (!charter || charter.status !== "active") {
    return { ok: false, error: "Corporation has no active bank charter" };
  }
  if (!charterMay(charter, "setRates")) {
    return {
      ok: false,
      error:
        charter.type === "investment"
          ? "Investment banks take no deposits and cannot set deposit rates"
          : "Only retail or universal charters can set bank rates",
    };
  }

  const countryId = getCountryIdForCurrency(charter.currency);
  const corridors = await getRateCorridors(db, countryId);

  if (!isOffsetInCorridor(depositOffset, corridors.deposit)) {
    return {
      ok: false,
      error: `Deposit offset ${depositOffset} is outside corridor [${corridors.deposit.minOffset}, ${corridors.deposit.maxOffset}]`,
    };
  }
  if (!isOffsetInCorridor(lendingOffset, corridors.lending)) {
    return {
      ok: false,
      error: `Lending offset ${lendingOffset} is outside corridor [${corridors.lending.minOffset}, ${corridors.lending.maxOffset}]`,
    };
  }

  const result = await db.collection<Corporation>("corporations").updateOne(
    {
      _id: corporationId,
      "bankCharter.status": "active",
      "bankCharter.type": { $in: ["retail", "universal"] },
    },
    {
      $set: {
        "bankCharter.depositOffset": depositOffset,
        "bankCharter.lendingOffset": lendingOffset,
        updatedAt: new Date(),
      },
    }
  );

  if (result.matchedCount !== 1) {
    return { ok: false, error: "Failed to update bank rates (charter no longer eligible)" };
  }

  return { ok: true, depositOffset, lendingOffset };
}

/**
 * Effective deposit and lending rates = prime + offsets, floored at
 * {@link MIN_DEPOSIT_RATE_PERCENT} / {@link MIN_LENDING_RATE_PERCENT}.
 */
export async function getEffectiveBankRates(
  db: Db,
  charter: BankCharter
): Promise<{ depositRatePercent: number; lendingRatePercent: number }> {
  const countryId = getCountryIdForCurrency(charter.currency);
  const bankId = getBankId(countryId);
  const bank = await db
    .collection<CentralBank>("centralBanks")
    .findOne({ _id: bankId }, { projection: { primeRate: 1 } });
  return effectiveBankRatesFromPrime(charter, bank?.primeRate);
}

/**
 * Pure counterpart for callers that already hold the CB doc (the banking turn
 * bulk-loads every central bank anyway) — no per-charter findOne.
 */
export function effectiveBankRatesFromPrime(
  charter: BankCharter,
  primeRateRaw: number | undefined | null
): { depositRatePercent: number; lendingRatePercent: number } {
  const primeRate =
    typeof primeRateRaw === "number" && Number.isFinite(primeRateRaw) ? primeRateRaw : 0;
  return {
    depositRatePercent: Math.max(MIN_DEPOSIT_RATE_PERCENT, primeRate + charter.depositOffset),
    lendingRatePercent: Math.max(MIN_LENDING_RATE_PERCENT, primeRate + charter.lendingOffset),
  };
}
