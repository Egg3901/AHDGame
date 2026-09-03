/**
 * Shell for the Banking Rules boundary: load one bank's immutable snapshot.
 *
 * Everything the rules need to decide a command, read once. The route or
 * turn stage that calls this passes the result straight to `decideBankCommand`
 * and then to `settleTransition`; nothing below the boundary reads the
 * database again.
 */

import type { Db, ObjectId } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import { getBankDepositCeiling } from "@/lib/banking/capacityAllocation";
import { resolveCorpLiquidCurrencyCode } from "@/lib/currency/corporationCapital";
import { getCurrentTurn } from "@/lib/currentTurn";
import type { BankCharterSnapshot, BankingSnapshot } from "@/lib/banking/rules/boundary";

export type { BankingSnapshot } from "@/lib/banking/rules/boundary";

export interface LoadedBankingSnapshot {
  snapshot: BankingSnapshot;
  /** The corporation document the snapshot was taken from, for names and ids. */
  corporation: Corporation;
}

/** Project the stored sub-document onto the fields the rules read. */
export function charterSnapshotFrom(
  charter: Corporation["bankCharter"] | null | undefined
): BankCharterSnapshot | null {
  if (!charter) return null;
  return {
    type: charter.type,
    status: charter.status,
    currency: charter.currency,
    postedCapital: charter.postedCapital,
    cashReserves: charter.cashReserves,
    npcDeposits: charter.npcDeposits,
    playerDeposits: charter.playerDeposits,
    totalDeposits: charter.totalDeposits,
    totalLoans: charter.totalLoans,
    depositOffset: charter.depositOffset,
    lendingOffset: charter.lendingOffset,
    discountWindowDebt: charter.discountWindowDebt,
    discountWindowArrears: charter.discountWindowArrears,
    cbMarginDebt: charter.cbMarginDebt,
    cbMarginArrears: charter.cbMarginArrears,
    interbankDebt: charter.interbankDebt,
    propBookMarkValue: charter.propBookMarkValue,
    capitalStanding: charter.capitalStanding,
    warningBand: charter.warningBand,
    undercapitalizedSinceTurn: charter.undercapitalizedSinceTurn,
    failedTurn: charter.failedTurn,
    revokedTurn: charter.revokedTurn,
    resolutionClaimedTurn: charter.resolutionClaimedTurn,
    depositorsResolvedTurn: charter.depositorsResolvedTurn,
    requireApproval: charter.requireApproval,
    lendingProfile: charter.lendingProfile,
    charterSwitchCooldownUntilTurn: charter.charterSwitchCooldownUntilTurn,
  };
}

export async function loadBankingSnapshot(
  db: Db,
  corporationId: ObjectId,
  options: { withCapacityCeiling?: boolean; turn?: number } = {}
): Promise<LoadedBankingSnapshot | null> {
  const corporation = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: corporationId });
  if (!corporation) return null;

  const charter = corporation.bankCharter;
  const currency = (charter?.currency ??
    resolveCorpLiquidCurrencyCode(corporation) ??
    "USD") as CurrencyCode;
  const centralBankId = getBankId(getCountryIdForCurrency(currency));

  const [policy, reserveRatio, centralBank, turn, capacityCeiling] = await Promise.all([
    loadBankingPolicy(db),
    getReserveRequirement(db, currency),
    db
      .collection<CentralBank>("centralBanks")
      .findOne({ _id: centralBankId }, { projection: { primeRate: 1 } }),
    options.turn !== undefined ? Promise.resolve(options.turn) : getCurrentTurn(db),
    options.withCapacityCeiling && charter
      ? getBankDepositCeiling(db, corporation)
      : Promise.resolve(undefined),
  ]);

  const primeRate =
    typeof centralBank?.primeRate === "number" && Number.isFinite(centralBank.primeRate)
      ? centralBank.primeRate
      : 0;

  return {
    corporation,
    snapshot: {
      turn,
      policy,
      bankId: corporationId.toString(),
      currency,
      charter: charterSnapshotFrom(charter),
      corporationLiquidCapital: Math.max(0, corporation.liquidCapital ?? 0),
      reserveRatio,
      playerDepositsAreLiabilities: savingsReadsAuthoritative(policy, currency),
      primeRate,
      centralBankId,
      ...(capacityCeiling !== undefined ? { capacityCeiling } : {}),
    },
  };
}
