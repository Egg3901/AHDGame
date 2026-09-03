/**
 * Shell for the savings account migration: load the planner's input from the
 * database, and apply a plan one currency at a time through the settlement
 * journal under an explicit gate.
 *
 * Every account's creation is one journaled transition with a deterministic
 * key (`savings-migrate:<owner>:<currency>`), so the migration can be
 * interrupted and resumed: a key already applied replays and moves nothing.
 * A currency batch is reconciled after its accounts are written and before
 * anything reads them; a batch that does not reconcile stops the run and
 * reports, and nothing about live behaviour changes until the rollout flag
 * names the currency.
 */

import { ObjectId, type Db } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { getReserveRequirement } from "@/lib/banking/reserves";
import { charterMay } from "@/lib/banking/rules/capabilities";
import { borrowingsFromCharter, totalBorrowings } from "@/lib/banking/rules/balanceSheet";
import { oid, type BankingTransition } from "@/lib/banking/rules/boundary";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { loadBankingPolicy } from "@/lib/banking/policy";
import {
  CENTRAL_BANK_HOLDER,
  reconcileAccounts,
  type LegacySavingsRow,
} from "@/lib/savings/rules/accounts";
import {
  planSavingsMigration,
  type MigrationInput,
  type SavingsMigrationPlan,
} from "@/lib/savings/rules/migration";
import { SAVINGS_ACCOUNTS_COLLECTION, loadLegacySavingsRows } from "@/lib/savings/shadow";

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function loadSavingsMigrationInput(db: Db): Promise<MigrationInput> {
  const [rows, corps, banks, existing] = await Promise.all([
    loadLegacySavingsRows(db),
    db
      .collection<Corporation>("corporations")
      .find({ "bankCharter.status": { $in: ["active", "revoked", "failed"] } })
      .project<Pick<Corporation, "_id" | "bankCharter">>({ bankCharter: 1 })
      .toArray(),
    db
      .collection<CentralBank>("centralBanks")
      .find({})
      .project<Pick<CentralBank, "_id" | "externalBroadMoney">>({ externalBroadMoney: 1 })
      .toArray(),
    db
      .collection<SavingsAccount>(SAVINGS_ACCOUNTS_COLLECTION)
      .find({ ownerType: "character" })
      .project<Pick<SavingsAccount, "ownerId" | "currency">>({ ownerId: 1, currency: 1 })
      .toArray(),
  ]);
  const poolByBankId = new Map(banks.map((b) => [String(b._id), finite(b.externalBroadMoney)]));
  const poolByCurrency = new Map<string, number>();
  const reserveRatioByCurrency = new Map<string, number>();
  for (const currency of FOREX_ACTIVE_CURRENCIES) {
    const bankId = getBankId(getCountryIdForCurrency(currency as CurrencyCode));
    poolByCurrency.set(currency, poolByBankId.get(bankId) ?? 0);
    reserveRatioByCurrency.set(currency, await getReserveRequirement(db, currency as CurrencyCode));
  }
  return {
    rows,
    charters: corps
      .filter((c) => c.bankCharter)
      .map((c) => {
        const charter = c.bankCharter!;
        return {
          bankId: c._id.toString(),
          currency: charter.currency,
          status: charter.status,
          acceptsDeposits: charterMay(charter, "acceptPlayerDeposits"),
          cashReserves: finite(charter.cashReserves),
          npcDeposits: finite(charter.npcDeposits),
          totalDeposits: finite(charter.totalDeposits),
          totalLoans: finite(charter.totalLoans),
          borrowings: totalBorrowings(borrowingsFromCharter(charter)),
        };
      }),
    poolByCurrency,
    reserveRatioByCurrency,
    existingAccountKeys: new Set(existing.map((a) => `${a.ownerId.toString()}:${a.currency}`)),
  };
}

export const savingsMigrationKey = (ownerId: string, currency: string): string =>
  `savings-migrate:${ownerId}:${currency}`;

/**
 * The transition that creates one account from its legacy row. Backing
 * moves from the household pool into the holder's vault when the holder is
 * a bank; the holder's liability counter rises by the balance either way.
 */
export function migrationTransition(
  row: LegacySavingsRow,
  effectiveHolder: string,
  accountId: string,
  centralBankId: string,
  turn: number
): BankingTransition {
  const balance = Math.max(0, finite(row.savings));
  const bankHeld = effectiveHolder !== CENTRAL_BANK_HOLDER;
  const key = savingsMigrationKey(row.ownerId, row.currency);
  return {
    key,
    kind: "savings_migration",
    turn,
    currency: row.currency,
    legs:
      bankHeld && balance > 0
        ? [
            {
              kind: "debit",
              amount: balance,
              collection: "centralBanks",
              filter: { _id: centralBankId },
              path: "externalBroadMoney",
              note: "backing leaves the household pool",
            },
            {
              kind: "credit",
              amount: balance,
              collection: "corporations",
              filter: { _id: oid(effectiveHolder), "bankCharter.status": "active" },
              path: "bankCharter.cashReserves",
              note: "backing arrives in the holding bank's vault",
            },
          ]
        : [],
    projections: [
      {
        collection: SAVINGS_ACCOUNTS_COLLECTION,
        insert: {
          _id: oid(accountId),
          ownerType: "character",
          ownerId: oid(row.ownerId),
          currency: row.currency,
          balance,
          holder: effectiveHolder,
          status: "open",
          version: 0,
          accruedInterest: Math.max(0, finite(row.pendingSavingsInterest)),
          interestEarned: Math.max(0, finite(row.interestEarned)),
          lastSettlementKey: key,
          lastSettledTurn: turn,
          openedTurn: turn,
          migratedFromLegacyAt: { $date: turn },
        },
        note: "the authoritative account",
      },
      bankHeld
        ? {
            collection: "corporations",
            filter: { _id: oid(effectiveHolder) },
            update: { $inc: { "bankCharter.playerDeposits": balance } },
            note: "bank's player-deposit liability recognized",
          }
        : {
            collection: "centralBanks",
            filter: { _id: centralBankId },
            update: { $inc: { householdSavingsLiability: balance } },
            note: "central bank's liability on the account it holds",
          },
      ...(effectiveHolder !== (row.savingsHolder ?? CENTRAL_BANK_HOLDER)
        ? [
            {
              collection: "characters",
              filter: { _id: oid(row.ownerId) },
              update: {
                $set: { [`currencyBalances.savingsHolder.${row.currency}`]: effectiveHolder },
              },
              note: "legacy pointer reassigned to the central bank",
            },
          ]
        : []),
    ],
    event: {
      kind: "account.holder_changed",
      command: "savings.migrate",
      subjectType: "savingsAccount",
      subjectId: accountId,
      statusBefore: row.savingsHolder ?? CENTRAL_BANK_HOLDER,
      statusAfter: effectiveHolder,
      amount: balance,
    },
  };
}

export interface MigrationBatchResult {
  currency: string;
  applied: number;
  replayed: number;
  failed: number;
  reconciled: boolean;
  discrepancies: number;
  error?: string;
}

/**
 * Apply the plan for one currency. Refuses unless the rollout mode is
 * `authoritative`, the plan is ok, and the currency is not yet a read cohort
 * (a currency that is already read from accounts has already migrated).
 */
export async function applySavingsMigrationForCurrency(
  db: Db,
  plan: SavingsMigrationPlan,
  input: MigrationInput,
  currency: string,
  turn: number
): Promise<MigrationBatchResult> {
  const result: MigrationBatchResult = {
    currency,
    applied: 0,
    replayed: 0,
    failed: 0,
    reconciled: false,
    discrepancies: 0,
  };
  const policy = await loadBankingPolicy(db);
  if (policy.savingsAccounts !== "authoritative") {
    return { ...result, error: "savingsAccountsMode must be authoritative to migrate" };
  }
  if (!plan.ok) return { ...result, error: "plan has invariant failures" };
  const currencyPlan = plan.currencies.find((c) => c.currency === currency);
  if (!currencyPlan) return { ...result, error: "currency not in plan" };
  if (policy.savingsReadCurrencies.includes(currency)) {
    return { ...result, error: "currency already reads from accounts" };
  }

  const centralBankId = getBankId(getCountryIdForCurrency(currency as CurrencyCode));
  const unmappable = new Map(currencyPlan.unmappable.map((u) => [u.ownerId, u]));
  const charterById = new Map(input.charters.map((c) => [c.bankId, c]));

  for (const row of input.rows.filter((r) => r.currency === currency)) {
    const problem = unmappable.get(row.ownerId);
    if (problem?.remedy === "refuse") {
      result.failed += 1;
      continue;
    }
    const holder = row.savingsHolder ?? CENTRAL_BANK_HOLDER;
    const charter = holder === CENTRAL_BANK_HOLDER ? undefined : charterById.get(holder);
    const effectiveHolder =
      holder === CENTRAL_BANK_HOLDER ||
      !charter ||
      charter.status !== "active" ||
      charter.currency !== currency ||
      !charter.acceptsDeposits
        ? CENTRAL_BANK_HOLDER
        : holder;
    const existing = await db
      .collection<SavingsAccount>(SAVINGS_ACCOUNTS_COLLECTION)
      .findOne({ ownerType: "character", ownerId: new ObjectId(row.ownerId), currency });
    const accountId = existing?._id.toHexString() ?? new ObjectId().toHexString();
    const transition = migrationTransition(row, effectiveHolder, accountId, centralBankId, turn);
    // The account insert carries a marker date the journal cannot revive;
    // stamp the real date here, in the shell.
    const insert = transition.projections[0].insert as Record<string, unknown>;
    insert.migratedFromLegacyAt = new Date();
    insert.createdAt = new Date();
    insert.updatedAt = new Date();

    const settled = await settleTransition(db, transition);
    if (settled.status === "applied") {
      result.applied += 1;
      emitBankingAuditEvent(
        { ...transition.event, turn, outcome: "ok", currency, settlementId: transition.key },
        db
      );
    } else if (settled.status === "replayed" && !settled.error) {
      result.replayed += 1;
    } else {
      result.failed += 1;
      result.error = settled.error ?? `settlement ${settled.status} for owner ${row.ownerId}`;
      break;
    }
  }

  // Reconcile the batch before anyone may read it.
  const accounts = await db
    .collection<SavingsAccount>(SAVINGS_ACCOUNTS_COLLECTION)
    .find({ ownerType: "character", currency })
    .toArray();
  const rows = (await loadLegacySavingsRows(db)).filter((r) => r.currency === currency);
  const discrepancies = reconcileAccounts(
    accounts.map((a) => ({
      id: a._id.toString(),
      ownerType: a.ownerType,
      ownerId: a.ownerId.toString(),
      currency: a.currency,
      balance: finite(a.balance),
      holder: a.holder,
      status: a.status,
      version: finite(a.version),
      accruedInterest: finite(a.accruedInterest),
      interestEarned: finite(a.interestEarned),
      openedTurn: finite(a.openedTurn),
    })),
    rows
  );
  result.discrepancies = discrepancies.length;
  result.reconciled = discrepancies.length === 0 && result.failed === 0;
  if (!result.reconciled && !result.error) {
    result.error = `${discrepancies.length} discrepancies after migration; currency must not be activated`;
  }
  return result;
}

/** Plan and apply every currency in the plan, stopping at the first that does not reconcile. */
export async function runSavingsMigration(
  db: Db,
  turn: number,
  currencies?: string[]
): Promise<{ plan: SavingsMigrationPlan; batches: MigrationBatchResult[] }> {
  const input = await loadSavingsMigrationInput(db);
  const plan = planSavingsMigration(input);
  const batches: MigrationBatchResult[] = [];
  if (!plan.ok) return { plan, batches };
  for (const currencyPlan of plan.currencies) {
    if (currencies && !currencies.includes(currencyPlan.currency)) continue;
    const batch = await applySavingsMigrationForCurrency(
      db,
      plan,
      input,
      currencyPlan.currency,
      turn
    );
    batches.push(batch);
    if (!batch.reconciled) break;
  }
  return { plan, batches };
}
