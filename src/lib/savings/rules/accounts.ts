/**
 * The savings account model, and the projections other systems read from it.
 *
 * One authoritative record per owner and currency (see
 * `src/lib/db/types/savingsAccount.ts`). Everything below is a pure function
 * over plain account data:
 *
 * - `bankLiabilityProjection`: what each bank owes its player depositors,
 *   which is what the balance sheet, the reserve requirement, insurance and
 *   the failure waterfall consume once real-liability reads are on.
 * - `centralBankPoolProjection`: what the central bank owes on the accounts
 *   it holds, per currency.
 * - `legacyProjection`: the character-document fields that keep every
 *   existing reader working during the migration.
 * - `reconcileAccounts`: the invariant that one owner has one account per
 *   currency and that the projections agree with the accounts.
 *
 * Nothing here touches the database or the clock.
 */

import type { SavingsHolder } from "@/lib/db/types/bank";
import type { SavingsAccountStatus } from "@/lib/db/types/savingsAccount";

/** The account as the rules see it: string ids, plain numbers. */
export interface SavingsAccountSnapshot {
  id: string;
  ownerType: "character" | "npp";
  ownerId: string;
  currency: string;
  balance: number;
  holder: SavingsHolder;
  status: SavingsAccountStatus;
  version: number;
  accruedInterest: number;
  interestEarned: number;
  lastSettlementKey?: string;
  lastSettledTurn?: number;
  openedTurn: number;
}

export const CENTRAL_BANK_HOLDER: SavingsHolder = "centralBank";

export function accountKey(ownerType: string, ownerId: string, currency: string): string {
  return `${ownerType}:${ownerId}:${currency}`;
}

export function isBankHolder(holder: SavingsHolder): boolean {
  return holder !== CENTRAL_BANK_HOLDER;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Player deposits each bank owes, keyed by bank hex, for one currency. */
export function bankLiabilityProjection(
  accounts: readonly SavingsAccountSnapshot[],
  currency: string
): Map<string, { balance: number; accounts: number }> {
  const out = new Map<string, { balance: number; accounts: number }>();
  for (const account of accounts) {
    if (account.currency !== currency) continue;
    if (!isBankHolder(account.holder)) continue;
    if (account.status === "closed") continue;
    const row = out.get(account.holder) ?? { balance: 0, accounts: 0 };
    row.balance += Math.max(0, finite(account.balance));
    row.accounts += 1;
    out.set(account.holder, row);
  }
  return out;
}

/** What the central bank owes on the accounts it holds, per currency. */
export function centralBankPoolProjection(
  accounts: readonly SavingsAccountSnapshot[]
): Map<string, number> {
  const out = new Map<string, number>();
  for (const account of accounts) {
    if (isBankHolder(account.holder) || account.status === "closed") continue;
    out.set(
      account.currency,
      (out.get(account.currency) ?? 0) + Math.max(0, finite(account.balance))
    );
  }
  return out;
}

/** The character-document fields an account projects onto. */
export interface LegacySavingsProjection {
  savings: number;
  savingsHolder: SavingsHolder;
  pendingSavingsInterest: number;
  interestEarned: number;
}

export function legacyProjection(account: SavingsAccountSnapshot): LegacySavingsProjection {
  return {
    savings: Math.max(0, finite(account.balance)),
    savingsHolder: account.holder,
    pendingSavingsInterest: Math.max(0, finite(account.accruedInterest)),
    interestEarned: Math.max(0, finite(account.interestEarned)),
  };
}

/** A legacy character savings row, as read from the character document. */
export interface LegacySavingsRow {
  ownerId: string;
  currency: string;
  savings: number;
  savingsHolder?: SavingsHolder | null;
  pendingSavingsInterest?: number;
  interestEarned?: number;
  /** Whether the character opened a savings account for this currency. */
  opened?: boolean;
}

export interface AccountDiscrepancy {
  key: string;
  kind:
    | "duplicate_account"
    | "missing_account"
    | "missing_legacy"
    | "balance_mismatch"
    | "holder_mismatch"
    | "pending_mismatch"
    | "negative_balance";
  account?: number;
  legacy?: number;
  detail?: string;
}

export const RECONCILE_TOLERANCE = 0.005;

/**
 * Compare the authoritative accounts with the legacy rows. Every row must
 * have exactly one account, every account must have a row, and balances,
 * holders and pending interest must agree to half a cent.
 */
export function reconcileAccounts(
  accounts: readonly SavingsAccountSnapshot[],
  legacy: readonly LegacySavingsRow[],
  ownerType: "character" | "npp" = "character"
): AccountDiscrepancy[] {
  const out: AccountDiscrepancy[] = [];
  const byKey = new Map<string, SavingsAccountSnapshot>();
  for (const account of accounts) {
    if (account.ownerType !== ownerType) continue;
    const key = accountKey(account.ownerType, account.ownerId, account.currency);
    if (byKey.has(key)) {
      out.push({ key, kind: "duplicate_account" });
      continue;
    }
    byKey.set(key, account);
    if (finite(account.balance) < 0) {
      out.push({ key, kind: "negative_balance", account: account.balance });
    }
  }
  const seen = new Set<string>();
  for (const row of legacy) {
    const key = accountKey(ownerType, row.ownerId, row.currency);
    seen.add(key);
    const account = byKey.get(key);
    if (!account) {
      // A legacy row with nothing in it and no open flag is not an account.
      if (finite(row.savings) > 0 || row.opened) {
        out.push({ key, kind: "missing_account", legacy: finite(row.savings) });
      }
      continue;
    }
    if (Math.abs(finite(account.balance) - finite(row.savings)) > RECONCILE_TOLERANCE) {
      out.push({
        key,
        kind: "balance_mismatch",
        account: account.balance,
        legacy: finite(row.savings),
      });
    }
    const rowHolder = row.savingsHolder ?? CENTRAL_BANK_HOLDER;
    if (account.holder !== rowHolder) {
      out.push({ key, kind: "holder_mismatch", detail: `${account.holder} vs ${rowHolder}` });
    }
    if (
      Math.abs(finite(account.accruedInterest) - finite(row.pendingSavingsInterest)) >
      RECONCILE_TOLERANCE
    ) {
      out.push({
        key,
        kind: "pending_mismatch",
        account: account.accruedInterest,
        legacy: finite(row.pendingSavingsInterest),
      });
    }
  }
  for (const [key, account] of byKey) {
    if (!seen.has(key) && account.status !== "closed") {
      out.push({ key, kind: "missing_legacy", account: account.balance });
    }
  }
  return out;
}

/** Build a fresh account snapshot from a legacy row (the migration's seed). */
export function accountFromLegacy(
  row: LegacySavingsRow,
  ownerType: "character" | "npp",
  turn: number,
  id: string
): SavingsAccountSnapshot {
  return {
    id,
    ownerType,
    ownerId: row.ownerId,
    currency: row.currency,
    balance: Math.max(0, finite(row.savings)),
    holder: row.savingsHolder ?? CENTRAL_BANK_HOLDER,
    status: "open",
    version: 0,
    accruedInterest: Math.max(0, finite(row.pendingSavingsInterest)),
    interestEarned: Math.max(0, finite(row.interestEarned)),
    openedTurn: turn,
  };
}
