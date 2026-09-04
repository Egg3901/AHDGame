/**
 * Banking health: the reconciliation a generic turn health check cannot do.
 *
 * "The turn succeeded" and "the trial balance is green" were both true while
 * an investment bank's loans sat unserviced and a player's savings were
 * counted at a bank that never received them. This report answers the
 * product-level questions: per currency, do the pointer totals the banks
 * carry match what the characters actually hold at them; how much of the
 * deposit base is real cash; is any bank under its reserve requirement; and
 * how old is the oldest settlement that started and never finished.
 */

import type { Db } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { MONEY_MOVE_COLLECTION } from "@/lib/banking/moneyMove";
import { bankBalanceSheet } from "@/lib/banking/rules/balanceSheet";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { loadBankingTelemetry, type BankingTelemetryDoc } from "@/lib/banking/telemetry";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { savingsReadsAuthoritative } from "@/lib/banking/rules/policy";
import { lifecycleStage, type BankLifecycleStage } from "@/lib/banking/rules/lifecycle";
import { buildSavingsComparison, readCohort, type SavingsComparison } from "@/lib/savings/shadow";
import { getCurrentTurn } from "@/lib/currentTurn";

export interface CurrencyBankingHealth {
  currency: CurrencyCode;
  activeBanks: number;
  /** Player savings whose holder pointer names one of this currency's banks. */
  playerHeldAtBanks: number;
  /** What the charters claim as pointer deposits (totalDeposits less household). */
  charterPointerDeposits: number;
  /** playerHeldAtBanks minus charterPointerDeposits. Non-zero means a stale aggregate. */
  pointerDrift: number;
  /** Cash-backed (household) deposits across the currency's banks. */
  cashBackedDeposits: number;
  /** Player savings counted as cash-backed liabilities (currency in the read cohort). */
  playerCashDeposits: number;
  /** Active charters by lifecycle stage. */
  stages: Partial<Record<BankLifecycleStage, number>>;
  cashReserves: number;
  totalLoans: number;
  requiredReserves: number;
  /** Banks whose cash is below their reserve requirement. */
  banksUnderReserve: number;
  /** Banks whose cash is below the run line. */
  banksUnderRunLine: number;
}

export interface UnfinishedSettlementsHealth {
  count: number;
  oldestKey: string | null;
  oldestAgeMs: number | null;
  byKind: Record<string, number>;
}

export interface BankingHealthReport {
  generatedAt: Date;
  currencies: CurrencyBankingHealth[];
  unfinishedSettlements: UnfinishedSettlementsHealth;
  /** Newest first. */
  telemetry: BankingTelemetryDoc[];
  /** Savings account rollout stage and the projection comparison, when on. */
  savingsAccounts: {
    mode: "off" | "shadow" | "authoritative";
    readCurrencies: string[];
    comparison: SavingsComparison | null;
  };
  /** Estates claimed for resolution or revocation and not yet settled. */
  resolvingEstates: Array<{ bankId: string; status: string; claimedTurn: number }>;
  /**
   * The activation gate. Widening the savings rollout (next currency into the
   * read cohort, shadow to authoritative) is refused while this is false, and
   * the reasons say what must be clean first: nothing unfinished from an
   * earlier turn, no estate stuck in resolution, no projection drift.
   */
  gate: { ok: boolean; reasons: string[] };
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Player savings pointed at each bank, keyed by bank hex, for one currency. */
async function playerHeldByBank(db: Db, currency: CurrencyCode): Promise<Map<string, number>> {
  const holderPath = `currencyBalances.savingsHolder.${currency}`;
  const rows = await db
    .collection<Character>("characters")
    .find({ [holderPath]: { $exists: true, $ne: "centralBank" } })
    .project<Pick<Character, "currencyBalances">>({
      [holderPath]: 1,
      [`currencyBalances.savings.${currency}`]: 1,
    })
    .toArray();
  const totals = new Map<string, number>();
  for (const row of rows) {
    const holder = String(row.currencyBalances?.savingsHolder?.[currency] ?? "");
    if (!holder) continue;
    totals.set(
      holder,
      (totals.get(holder) ?? 0) + finite(row.currencyBalances?.savings?.[currency])
    );
  }
  return totals;
}

export async function buildBankingHealth(db: Db, now = new Date()): Promise<BankingHealthReport> {
  const banks = await db
    .collection<Corporation>("corporations")
    .find({ "bankCharter.status": "active" })
    .project<Pick<Corporation, "_id" | "bankCharter">>({ bankCharter: 1 })
    .toArray();

  const byCurrency = new Map<CurrencyCode, typeof banks>();
  for (const bank of banks) {
    const currency = bank.bankCharter?.currency as CurrencyCode | undefined;
    if (!currency) continue;
    byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), bank]);
  }

  const policy = await loadBankingPolicy(db);
  const currencies: CurrencyBankingHealth[] = [];
  for (const [currency, rows] of [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [held, reserveRatio] = await Promise.all([
      playerHeldByBank(db, currency),
      getReserveRequirement(db, currency),
    ]);
    const health: CurrencyBankingHealth = {
      currency,
      activeBanks: rows.length,
      playerHeldAtBanks: 0,
      charterPointerDeposits: 0,
      pointerDrift: 0,
      cashBackedDeposits: 0,
      playerCashDeposits: 0,
      stages: {},
      cashReserves: 0,
      totalLoans: 0,
      requiredReserves: 0,
      banksUnderReserve: 0,
      banksUnderRunLine: 0,
    };
    for (const bank of rows) {
      const charter = bank.bankCharter!;
      const sheet = bankBalanceSheet({
        charter,
        reserveRatio,
        playerDepositsAreLiabilities: savingsReadsAuthoritative(policy, currency),
      });
      health.playerCashDeposits += sheet.playerDeposits;
      const stage = lifecycleStage(charter);
      health.stages[stage] = (health.stages[stage] ?? 0) + 1;
      health.playerHeldAtBanks += held.get(bank._id.toString()) ?? 0;
      health.charterPointerDeposits += sheet.pointerDeposits;
      health.cashBackedDeposits += sheet.cashBackedDeposits;
      health.cashReserves += sheet.cashReserves;
      health.totalLoans += sheet.totalLoans;
      health.requiredReserves += sheet.requiredReserves;
      if (sheet.reserveSurplus < 0) health.banksUnderReserve += 1;
      if (sheet.headroomToRunLine < 0) health.banksUnderRunLine += 1;
    }
    health.pointerDrift = health.playerHeldAtBanks - health.charterPointerDeposits;
    currencies.push(health);
  }

  const unfinished = await db
    .collection<{ _id: string; kind: string; turn?: number; createdAt: Date; status: string }>(
      MONEY_MOVE_COLLECTION
    )
    .find({ status: "partial" })
    .sort({ createdAt: 1 })
    .limit(500)
    .toArray();
  const byKind: Record<string, number> = {};
  for (const row of unfinished) byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
  const oldest = unfinished[0];

  const currentTurn = await getCurrentTurn(db);
  const comparison =
    policy.savingsAccounts === "off"
      ? null
      : await buildSavingsComparison(db, currentTurn, {
          authoritativeCurrencies: readCohort(policy),
        });

  const resolvingRows = await db
    .collection<Corporation>("corporations")
    .find({
      "bankCharter.resolutionClaimedTurn": { $exists: true },
      "bankCharter.depositorsResolvedTurn": { $exists: false },
    })
    .project<Pick<Corporation, "_id" | "bankCharter">>({ bankCharter: 1 })
    .toArray();
  const resolvingEstates = resolvingRows
    .filter((row) => lifecycleStage(row.bankCharter) === "resolving")
    .map((row) => ({
      bankId: row._id.toString(),
      status: row.bankCharter!.status,
      claimedTurn: row.bankCharter!.resolutionClaimedTurn ?? 0,
    }));

  const reasons: string[] = [];
  const staleUnfinished = unfinished.filter(
    (row) => typeof row.turn === "number" && row.turn < currentTurn
  );
  if (staleUnfinished.length > 0) {
    reasons.push(
      `${staleUnfinished.length} settlement(s) from earlier turns are unfinished (oldest ${staleUnfinished[0]._id})`
    );
  }
  const stuck = resolvingEstates.filter((estate) => estate.claimedTurn < currentTurn);
  if (stuck.length > 0) {
    reasons.push(`${stuck.length} estate(s) claimed on earlier turns are still in resolution`);
  }
  if (comparison && comparison.totalDiscrepancies > 0) {
    reasons.push(
      `${comparison.totalDiscrepancies} savings projection discrepancy(ies) in the last comparison`
    );
  }

  return {
    generatedAt: now,
    currencies,
    unfinishedSettlements: {
      count: unfinished.length,
      oldestKey: oldest?._id ?? null,
      oldestAgeMs: oldest?.createdAt ? now.getTime() - new Date(oldest.createdAt).getTime() : null,
      byKind,
    },
    telemetry: await loadBankingTelemetry(db),
    savingsAccounts: {
      mode: policy.savingsAccounts,
      readCurrencies: [...policy.savingsReadCurrencies],
      comparison,
    },
    resolvingEstates,
    gate: { ok: reasons.length === 0, reasons },
  };
}
