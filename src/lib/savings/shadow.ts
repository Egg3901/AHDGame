/**
 * Shadow savings accounts.
 *
 * Before any read or write moves onto the account model, the accounts are
 * built from the legacy character fields every turn and compared, projection
 * by projection, with what the world currently believes: each owner's total,
 * each holder's total, each bank's pointer-deposit aggregate and each central
 * bank's savings stock. A discrepancy is a place where the account model and
 * the legacy model would answer a question differently, which is exactly the
 * list of things that have to be understood before the model becomes true.
 *
 * Shadow mode changes no live behaviour. Discrepancies are counted on the
 * banking telemetry, reported on the banking health page, and published as
 * audit events with aggregates only.
 */

import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import type { CentralBank } from "@/lib/db/types/centralBank";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { FOREX_ACTIVE_CURRENCIES, getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { loadBankingPolicy } from "@/lib/banking/policy";
import type { SavingsAccountsMode } from "@/lib/banking/rules/policy";
import { pointerDeposits } from "@/lib/banking/rules/balanceSheet";
import {
  RECONCILE_TOLERANCE,
  accountFromLegacy,
  bankLiabilityProjection,
  centralBankPoolProjection,
  reconcileAccounts,
  type LegacySavingsRow,
  type SavingsAccountSnapshot,
} from "@/lib/savings/rules/accounts";
import { countBankingEvent, timedBankingStage } from "@/lib/banking/telemetry";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";

export const SAVINGS_ACCOUNTS_COLLECTION = "savingsAccounts";

export interface CurrencyComparison {
  currency: string;
  /** Sum of legacy character savings in the currency. */
  legacyOwnerTotal: number;
  /** Sum of account balances in the currency. */
  accountOwnerTotal: number;
  /** Per bank: the pointer aggregate the charter carries vs the accounts held there. */
  banks: Array<{
    bankId: string;
    charterPointerDeposits: number;
    accountLiability: number;
    accounts: number;
    drift: number;
  }>;
  /** Central bank: the stored national savings stock vs the accounts it holds. */
  centralBankStock: number;
  centralBankAccounts: number;
  /** Row-level disagreements between accounts and legacy fields. */
  rowDiscrepancies: number;
  discrepancies: number;
}

export interface SavingsComparison {
  turn: number;
  currencies: CurrencyComparison[];
  totalDiscrepancies: number;
}

export interface SavingsShadowResult {
  mode: SavingsAccountsMode;
  accountsRefreshed: number;
  comparison: SavingsComparison;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Every legacy savings row across the active currencies. */
export async function loadLegacySavingsRows(db: Db): Promise<LegacySavingsRow[]> {
  const filter = {
    $or: FOREX_ACTIVE_CURRENCIES.flatMap((c) => [
      { [`currencyBalances.savings.${c}`]: { $exists: true } },
      { [`savingsAccountsOpened.${c}`]: true },
    ]),
  };
  const characters = await db
    .collection<Character>("characters")
    .find(filter)
    .project<Pick<Character, "_id" | "currencyBalances" | "savingsAccountsOpened">>({
      currencyBalances: 1,
      savingsAccountsOpened: 1,
    })
    .toArray();
  const rows: LegacySavingsRow[] = [];
  for (const character of characters) {
    const balances = character.currencyBalances ?? {};
    for (const currency of FOREX_ACTIVE_CURRENCIES) {
      const savings = balances.savings?.[currency];
      const opened = character.savingsAccountsOpened?.[currency] === true;
      if (savings === undefined && !opened) continue;
      rows.push({
        ownerId: character._id.toString(),
        currency,
        savings: finite(savings),
        savingsHolder: balances.savingsHolder?.[currency] ?? null,
        pendingSavingsInterest: finite(balances.pendingSavingsInterest?.[currency]),
        interestEarned: finite(balances.interestEarned?.[currency]),
        opened,
      });
    }
  }
  return rows;
}

function toSnapshot(doc: SavingsAccount): SavingsAccountSnapshot {
  return {
    id: doc._id.toString(),
    ownerType: doc.ownerType,
    ownerId: doc.ownerId.toString(),
    currency: doc.currency,
    balance: finite(doc.balance),
    holder: doc.holder,
    status: doc.status,
    version: finite(doc.version),
    accruedInterest: finite(doc.accruedInterest),
    interestEarned: finite(doc.interestEarned),
    lastSettlementKey: doc.lastSettlementKey,
    lastSettledTurn: doc.lastSettledTurn,
    openedTurn: finite(doc.openedTurn),
  };
}

/**
 * Materialize shadow accounts from the legacy rows. Idempotent: an existing
 * account is overwritten with the legacy values (the legacy fields are the
 * authority in shadow mode); a missing one is created. Accounts that are
 * authoritative for their currency are left alone.
 */
export async function refreshShadowAccounts(
  db: Db,
  turn: number,
  rows: LegacySavingsRow[],
  authoritativeCurrencies: ReadonlySet<string>
): Promise<number> {
  const now = new Date();
  const ops = rows
    .filter((row) => !authoritativeCurrencies.has(row.currency))
    .map((row) => {
      const built = accountFromLegacy(row, "character", turn, "");
      return {
        updateOne: {
          filter: {
            ownerType: "character",
            ownerId: new ObjectId(row.ownerId),
            currency: row.currency,
          },
          update: {
            $set: {
              balance: built.balance,
              holder: built.holder,
              status: built.status,
              accruedInterest: built.accruedInterest,
              interestEarned: built.interestEarned,
              updatedAt: now,
            },
            $setOnInsert: {
              ownerType: "character",
              ownerId: new ObjectId(row.ownerId),
              currency: row.currency,
              version: 0,
              openedTurn: turn,
              migratedFromLegacyAt: now,
              createdAt: now,
            },
          },
          upsert: true,
        },
      };
    });
  if (ops.length === 0) return 0;
  await db.collection(SAVINGS_ACCOUNTS_COLLECTION).bulkWrite(ops, { ordered: false });
  return ops.length;
}

/** Compare every projection for every currency. Pure over the loaded data. */
export function compareSavingsProjections(input: {
  turn: number;
  rows: LegacySavingsRow[];
  accounts: SavingsAccountSnapshot[];
  charters: Array<{ bankId: string; currency: string; totalDeposits: number; npcDeposits: number }>;
  centralBankStock: Map<string, number>;
}): SavingsComparison {
  const currencies = new Set<string>([
    ...input.rows.map((r) => r.currency),
    ...input.accounts.map((a) => a.currency),
  ]);
  const out: CurrencyComparison[] = [];
  let total = 0;
  for (const currency of [...currencies].sort()) {
    const rows = input.rows.filter((r) => r.currency === currency);
    const accounts = input.accounts.filter((a) => a.currency === currency);
    const rowDiscrepancies = reconcileAccounts(accounts, rows).length;
    const legacyOwnerTotal = rows.reduce((s, r) => s + Math.max(0, finite(r.savings)), 0);
    const accountOwnerTotal = accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);
    const liabilities = bankLiabilityProjection(accounts, currency);
    const banks = input.charters
      .filter((c) => c.currency === currency)
      .map((c) => {
        const held = liabilities.get(c.bankId) ?? { balance: 0, accounts: 0 };
        const pointer = pointerDeposits({
          totalDeposits: c.totalDeposits,
          npcDeposits: c.npcDeposits,
        });
        return {
          bankId: c.bankId,
          charterPointerDeposits: pointer,
          accountLiability: held.balance,
          accounts: held.accounts,
          drift: held.balance - pointer,
        };
      });
    const pool = centralBankPoolProjection(accounts).get(currency) ?? 0;
    const stock = input.centralBankStock.get(currency) ?? 0;
    let discrepancies = rowDiscrepancies;
    if (Math.abs(legacyOwnerTotal - accountOwnerTotal) > RECONCILE_TOLERANCE) discrepancies += 1;
    for (const bank of banks) {
      if (Math.abs(bank.drift) > RECONCILE_TOLERANCE) discrepancies += 1;
    }
    // The stored national savings stock is written once per turn by the
    // interest pass and lags one turn; a mismatch here is reported but
    // deliberately not counted, because the stock is not a liability anyone
    // settles against.
    total += discrepancies;
    out.push({
      currency,
      legacyOwnerTotal,
      accountOwnerTotal,
      banks,
      centralBankStock: stock,
      centralBankAccounts: pool,
      rowDiscrepancies,
      discrepancies,
    });
  }
  return { turn: input.turn, currencies: out, totalDiscrepancies: total };
}

/** Load everything the comparison needs and run it. */
export async function buildSavingsComparison(db: Db, turn: number): Promise<SavingsComparison> {
  const [rows, accountDocs, charters, banks] = await Promise.all([
    loadLegacySavingsRows(db),
    db
      .collection<SavingsAccount>(SAVINGS_ACCOUNTS_COLLECTION)
      .find({ ownerType: "character" })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({ "bankCharter.status": "active" })
      .project<Pick<Corporation, "_id" | "bankCharter">>({ bankCharter: 1 })
      .toArray(),
    db
      .collection<CentralBank>("centralBanks")
      .find({})
      .project<Pick<CentralBank, "_id" | "nationalSavingsBalance">>({ nationalSavingsBalance: 1 })
      .toArray(),
  ]);
  const stockByBankId = new Map(
    banks.map((b) => [String(b._id), finite(b.nationalSavingsBalance)])
  );
  const centralBankStock = new Map<string, number>();
  for (const currency of FOREX_ACTIVE_CURRENCIES) {
    const bankId = getBankId(getCountryIdForCurrency(currency as CurrencyCode));
    centralBankStock.set(currency, stockByBankId.get(bankId) ?? 0);
  }
  return compareSavingsProjections({
    turn,
    rows,
    accounts: accountDocs.map(toSnapshot),
    charters: charters
      .filter((c) => c.bankCharter)
      .map((c) => ({
        bankId: c._id.toString(),
        currency: c.bankCharter!.currency,
        totalDeposits: finite(c.bankCharter!.totalDeposits),
        npcDeposits: finite(c.bankCharter!.npcDeposits),
      })),
    centralBankStock,
  });
}

/**
 * The shadow phase. Refreshes accounts from legacy in shadow mode, compares in
 * shadow and authoritative modes, and is a no-op when the rollout is off.
 */
export async function processSavingsShadowTurn(db: Db, turn: number): Promise<SavingsShadowResult> {
  const policy = await loadBankingPolicy(db);
  const empty: SavingsShadowResult = {
    mode: policy.savingsAccounts,
    accountsRefreshed: 0,
    comparison: { turn, currencies: [], totalDiscrepancies: 0 },
  };
  if (policy.savingsAccounts === "off") return empty;

  return timedBankingStage(db, turn, "shadowCompare", async () => {
    let accountsRefreshed = 0;
    if (policy.savingsAccounts === "shadow") {
      const rows = await loadLegacySavingsRows(db);
      accountsRefreshed = await refreshShadowAccounts(db, turn, rows, new Set());
    }
    const comparison = await buildSavingsComparison(db, turn);
    if (comparison.totalDiscrepancies > 0) {
      countBankingEvent(db, turn, "unreconciledProjections", comparison.totalDiscrepancies);
    }
    for (const currency of comparison.currencies) {
      emitBankingAuditEvent({
        kind: "account.holder_changed",
        command: "savings.shadow.compare",
        turn,
        outcome: currency.discrepancies > 0 ? "rejected" : "ok",
        ...(currency.discrepancies > 0
          ? { reason: `${currency.discrepancies} projection discrepancies` }
          : {}),
        currency: currency.currency,
        subjectType: "currency",
        subjectId: currency.currency,
        meta: {
          mode: policy.savingsAccounts,
          legacyOwnerTotal: currency.legacyOwnerTotal,
          accountOwnerTotal: currency.accountOwnerTotal,
          banks: currency.banks.length,
          bankDrift: currency.banks.reduce((s, b) => s + Math.abs(b.drift), 0),
          rowDiscrepancies: currency.rowDiscrepancies,
        },
      });
    }
    return { mode: policy.savingsAccounts, accountsRefreshed, comparison };
  });
}
