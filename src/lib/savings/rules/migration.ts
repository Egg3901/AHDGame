/**
 * The savings account migration, planned as pure data.
 *
 * The migration recognizes every bank-held player balance as a real
 * liability of that bank, backed by cash transferred from the central bank's
 * household pool. Before a single write, this planner says what that would
 * do: how many accounts per currency, how much backing each bank needs,
 * which banks would then breach their reserve requirement or fall into
 * negative equity, which rows cannot be mapped at all, and whether the pool
 * can fund it. A plan whose invariants fail is not applied.
 */

import type { SavingsHolder } from "@/lib/db/types/bank";
import { bankEquity, requiredReserves } from "@/lib/banking/rules/balanceSheet";
import {
  CENTRAL_BANK_HOLDER,
  RECONCILE_TOLERANCE,
  type LegacySavingsRow,
} from "@/lib/savings/rules/accounts";

export interface MigrationCharterInput {
  bankId: string;
  currency: string;
  status: "active" | "revoked" | "failed";
  /** Whether the charter may hold player deposits (a deposit-taking type). */
  acceptsDeposits: boolean;
  cashReserves: number;
  npcDeposits: number;
  totalDeposits: number;
  totalLoans: number;
  borrowings: number;
}

export interface MigrationInput {
  rows: LegacySavingsRow[];
  charters: MigrationCharterInput[];
  /** Central bank household pool (`externalBroadMoney`) per currency. */
  poolByCurrency: Map<string, number>;
  reserveRatioByCurrency: Map<string, number>;
  /** Accounts that already exist (an earlier, partial run), keyed by owner:currency. */
  existingAccountKeys?: ReadonlySet<string>;
}

export interface BankMigrationPlan {
  bankId: string;
  currency: string;
  accounts: number;
  /** Player balances the bank will owe once recognized. */
  liability: number;
  /** Cash that must move from the pool into the bank's vault. */
  backingTransfer: number;
  /** The charter's pointer aggregate today, for the before/after record. */
  charterPointerDeposits: number;
  cashAfter: number;
  requiredReservesAfter: number;
  reserveBreach: boolean;
  equityAfter: number;
  solvencyBreach: boolean;
}

export interface UnmappableRow {
  ownerId: string;
  currency: string;
  reason:
    | "negative_balance"
    | "non_finite"
    | "duplicate"
    | "unknown_holder"
    | "holder_not_deposit_taking";
  balance: number;
  holder: SavingsHolder;
  /** What the migration would do with it: reassign to the central bank, or refuse. */
  remedy: "reassign_to_central_bank" | "refuse";
}

export interface CurrencyMigrationPlan {
  currency: string;
  accountsToCreate: number;
  accountsExisting: number;
  ownerTotal: number;
  centralBankHeld: number;
  bankHeld: number;
  backingRequired: number;
  poolAvailable: number;
  poolShortfall: number;
  banks: BankMigrationPlan[];
  unmappable: UnmappableRow[];
  /** Sum of legacy balances vs sum of planned account balances; must be zero. */
  aggregateDifference: number;
}

export interface SavingsMigrationPlan {
  currencies: CurrencyMigrationPlan[];
  invariantFailures: string[];
  ok: boolean;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

export function planSavingsMigration(input: MigrationInput): SavingsMigrationPlan {
  const failures: string[] = [];
  const currencies = new Set<string>(input.rows.map((r) => r.currency));
  for (const charter of input.charters) currencies.add(charter.currency);
  const charterByBank = new Map(input.charters.map((c) => [c.bankId, c]));
  const plans: CurrencyMigrationPlan[] = [];

  for (const currency of [...currencies].sort()) {
    const rows = input.rows.filter((r) => r.currency === currency);
    const unmappable: UnmappableRow[] = [];
    const seen = new Set<string>();
    const liabilityByBank = new Map<string, { balance: number; accounts: number }>();
    let ownerTotal = 0;
    let centralBankHeld = 0;
    let accountsToCreate = 0;
    let accountsExisting = 0;
    let plannedTotal = 0;

    for (const row of rows) {
      const key = `${row.ownerId}:${currency}`;
      const balance = finite(row.savings);
      const holder = row.savingsHolder ?? CENTRAL_BANK_HOLDER;
      if (seen.has(key)) {
        unmappable.push({
          ownerId: row.ownerId,
          currency,
          reason: "duplicate",
          balance,
          holder,
          remedy: "refuse",
        });
        failures.push(`${currency}: duplicate legacy row for owner ${row.ownerId}`);
        continue;
      }
      seen.add(key);
      if (Number.isNaN(balance)) {
        unmappable.push({
          ownerId: row.ownerId,
          currency,
          reason: "non_finite",
          balance,
          holder,
          remedy: "refuse",
        });
        failures.push(`${currency}: non-finite balance for owner ${row.ownerId}`);
        continue;
      }
      if (balance < 0) {
        unmappable.push({
          ownerId: row.ownerId,
          currency,
          reason: "negative_balance",
          balance,
          holder,
          remedy: "refuse",
        });
        failures.push(`${currency}: negative balance for owner ${row.ownerId}`);
        continue;
      }
      ownerTotal += balance;
      if (input.existingAccountKeys?.has(key)) accountsExisting += 1;
      else accountsToCreate += 1;
      plannedTotal += balance;

      let effectiveHolder: SavingsHolder = holder;
      if (holder !== CENTRAL_BANK_HOLDER) {
        const charter = charterByBank.get(holder);
        if (!charter || charter.currency !== currency || charter.status !== "active") {
          unmappable.push({
            ownerId: row.ownerId,
            currency,
            reason: "unknown_holder",
            balance,
            holder,
            remedy: "reassign_to_central_bank",
          });
          effectiveHolder = CENTRAL_BANK_HOLDER;
        } else if (!charter.acceptsDeposits) {
          unmappable.push({
            ownerId: row.ownerId,
            currency,
            reason: "holder_not_deposit_taking",
            balance,
            holder,
            remedy: "reassign_to_central_bank",
          });
          effectiveHolder = CENTRAL_BANK_HOLDER;
        }
      }
      if (effectiveHolder === CENTRAL_BANK_HOLDER) {
        centralBankHeld += balance;
      } else {
        const row2 = liabilityByBank.get(effectiveHolder) ?? { balance: 0, accounts: 0 };
        row2.balance += balance;
        row2.accounts += 1;
        liabilityByBank.set(effectiveHolder, row2);
      }
    }

    const ratio = input.reserveRatioByCurrency.get(currency) ?? 0;
    const banks: BankMigrationPlan[] = input.charters
      .filter((c) => c.currency === currency && c.status === "active")
      .map((c) => {
        const held = liabilityByBank.get(c.bankId) ?? { balance: 0, accounts: 0 };
        const cashAfter = c.cashReserves + held.balance;
        const requiredAfter = requiredReserves(
          { npcDeposits: c.npcDeposits + held.balance },
          ratio
        );
        const equityAfter = bankEquity({
          cashReserves: cashAfter,
          totalLoans: c.totalLoans,
          npcDeposits: c.npcDeposits + held.balance,
          interbankDebt: c.borrowings,
        });
        return {
          bankId: c.bankId,
          currency,
          accounts: held.accounts,
          liability: held.balance,
          backingTransfer: held.balance,
          charterPointerDeposits: Math.max(0, c.totalDeposits - c.npcDeposits),
          cashAfter,
          requiredReservesAfter: requiredAfter,
          reserveBreach: cashAfter < requiredAfter - RECONCILE_TOLERANCE,
          equityAfter,
          solvencyBreach: equityAfter < -RECONCILE_TOLERANCE,
        };
      })
      .filter((b) => b.accounts > 0 || b.charterPointerDeposits > RECONCILE_TOLERANCE);

    const backingRequired = banks.reduce((s, b) => s + b.backingTransfer, 0);
    const poolAvailable = input.poolByCurrency.get(currency) ?? 0;
    const poolShortfall = Math.max(0, backingRequired - poolAvailable);
    if (poolShortfall > RECONCILE_TOLERANCE) {
      failures.push(
        `${currency}: household pool short by ${poolShortfall} for the backing transfers`
      );
    }
    const aggregateDifference = ownerTotal - plannedTotal;
    if (Math.abs(aggregateDifference) > RECONCILE_TOLERANCE) {
      failures.push(`${currency}: planned balances differ from legacy by ${aggregateDifference}`);
    }

    plans.push({
      currency,
      accountsToCreate,
      accountsExisting,
      ownerTotal,
      centralBankHeld,
      bankHeld: backingRequired,
      backingRequired,
      poolAvailable,
      poolShortfall,
      banks,
      unmappable,
      aggregateDifference,
    });
  }

  return { currencies: plans, invariantFailures: failures, ok: failures.length === 0 };
}

/** One line per currency and bank, for a terminal or a runbook. */
export function renderMigrationPlan(plan: SavingsMigrationPlan): string {
  const lines: string[] = [];
  for (const c of plan.currencies) {
    lines.push(
      `${c.currency}: ${c.accountsToCreate} accounts to create, ${c.accountsExisting} existing, owner total ${c.ownerTotal.toFixed(2)}, central bank ${c.centralBankHeld.toFixed(2)}, banks ${c.bankHeld.toFixed(2)}, backing ${c.backingRequired.toFixed(2)} of pool ${c.poolAvailable.toFixed(2)}${c.poolShortfall > 0 ? ` SHORT ${c.poolShortfall.toFixed(2)}` : ""}`
    );
    for (const b of c.banks) {
      lines.push(
        `  bank ${b.bankId}: ${b.accounts} accounts, liability ${b.liability.toFixed(2)} (charter pointer ${b.charterPointerDeposits.toFixed(2)}), cash after ${b.cashAfter.toFixed(2)} vs required ${b.requiredReservesAfter.toFixed(2)}${b.reserveBreach ? " RESERVE BREACH" : ""}, equity after ${b.equityAfter.toFixed(2)}${b.solvencyBreach ? " INSOLVENT" : ""}`
      );
    }
    for (const u of c.unmappable) {
      lines.push(`  unmappable ${u.ownerId}: ${u.reason} (${u.remedy})`);
    }
  }
  for (const f of plan.invariantFailures) lines.push(`INVARIANT FAILED: ${f}`);
  lines.push(plan.ok ? "PLAN OK" : "PLAN BLOCKED");
  return lines.join("\n");
}
