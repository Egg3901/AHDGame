/**
 * Shell for the Savings Accounts commands: load the account and holder
 * snapshots, decide, settle through the journal, publish the event.
 *
 * In `authoritative` mode this is the only write path for player savings.
 * An account that does not exist yet (a character who opened savings after
 * the migration, or a currency the migration has not reached) is created
 * from the legacy fields first, through the same journaled migration
 * transition, so the command that follows always has a record to guard.
 */

import { ObjectId, type Db } from "mongodb";
import type { Character, Corporation } from "@/lib/db/types";
import type { SavingsAccount } from "@/lib/db/types/savingsAccount";
import type { SavingsHolder } from "@/lib/db/types/bank";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getCountryIdForCurrency } from "@/lib/constants/currencies";
import { getBankId } from "@/lib/centralBank/helpers";
import { loadBankingPolicy } from "@/lib/banking/policy";
import { charterMay } from "@/lib/banking/rules/capabilities";
import { lifecycleRefusal } from "@/lib/banking/rules/lifecycle";
import { getBankDepositCeiling } from "@/lib/banking/capacityAllocation";
import { getCashReserves } from "@/lib/banking/rules/balanceSheet";
import { isBlockedDepositor } from "@/lib/banking/blacklist";
import { settleTransition } from "@/lib/banking/settlementJournal";
import { emitBankingAuditEvent } from "@/lib/banking/auditEvents";
import { getCurrentTurn } from "@/lib/currentTurn";
import {
  CENTRAL_BANK_HOLDER,
  isBankHolder,
  type SavingsAccountSnapshot,
} from "@/lib/savings/rules/accounts";
import {
  decideSavingsCommand,
  type HolderSnapshot,
  type SavingsCommand,
  type SavingsDecision,
} from "@/lib/savings/rules/commands";
import { SAVINGS_ACCOUNTS_COLLECTION } from "@/lib/savings/shadow";
import { migrationTransition } from "@/lib/savings/migration";

export type SavingsCommandResult =
  | { ok: true; account: SavingsAccountSnapshot; settlementId: string }
  | { ok: false; error: string; refusal?: Extract<SavingsDecision, { allowed: false }>["refusal"] };

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function toAccountSnapshot(doc: SavingsAccount): SavingsAccountSnapshot {
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
 * The account for an owner and currency, materialized from the legacy fields
 * through the migration transition if it does not exist yet.
 */
export async function ensureSavingsAccount(
  db: Db,
  ownerId: ObjectId,
  currency: CurrencyCode,
  turn: number
): Promise<SavingsAccountSnapshot | null> {
  const existing = await db
    .collection<SavingsAccount>(SAVINGS_ACCOUNTS_COLLECTION)
    .findOne({ ownerType: "character", ownerId, currency });
  if (existing) return toAccountSnapshot(existing);

  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: ownerId }, { projection: { currencyBalances: 1, savingsAccountsOpened: 1 } });
  if (!character) return null;
  const balances: Partial<NonNullable<Character["currencyBalances"]>> =
    character.currencyBalances ?? {};
  const holder = balances.savingsHolder?.[currency] ?? null;
  let effectiveHolder: SavingsHolder = holder ?? CENTRAL_BANK_HOLDER;
  if (isBankHolder(effectiveHolder)) {
    const bank = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(effectiveHolder) }, { projection: { bankCharter: 1 } });
    const charter = bank?.bankCharter;
    if (!charter || charter.currency !== currency || !charterMay(charter, "acceptPlayerDeposits")) {
      effectiveHolder = CENTRAL_BANK_HOLDER;
    }
  }
  const accountId = new ObjectId();
  const centralBankId = getBankId(getCountryIdForCurrency(currency));
  const transition = migrationTransition(
    {
      ownerId: ownerId.toString(),
      currency,
      savings: finite(balances.savings?.[currency]),
      savingsHolder: holder,
      pendingSavingsInterest: finite(balances.pendingSavingsInterest?.[currency]),
      interestEarned: finite(balances.interestEarned?.[currency]),
      opened: character.savingsAccountsOpened?.[currency] === true,
    },
    effectiveHolder,
    accountId.toHexString(),
    centralBankId,
    turn
  );
  const insert = transition.projections[0].insert as Record<string, unknown>;
  const now = new Date();
  insert.migratedFromLegacyAt = now;
  insert.createdAt = now;
  insert.updatedAt = now;
  const settled = await settleTransition(db, transition);
  if (settled.status === "rejected" || settled.status === "partial") return null;
  const created = await db
    .collection<SavingsAccount>(SAVINGS_ACCOUNTS_COLLECTION)
    .findOne({ ownerType: "character", ownerId, currency });
  return created ? toAccountSnapshot(created) : null;
}

/** What the rules need to know about a holder right now. */
export async function loadHolderSnapshot(
  db: Db,
  holder: SavingsHolder,
  currency: CurrencyCode,
  options: { ownerId?: ObjectId; withCeiling?: boolean } = {}
): Promise<HolderSnapshot | { error: string }> {
  if (!isBankHolder(holder)) {
    return {
      holder: CENTRAL_BANK_HOLDER,
      cash: 0,
      acceptsDeposits: true,
      playerDeposits: 0,
      active: true,
    };
  }
  if (!ObjectId.isValid(holder) || holder.length !== 24)
    return { error: "Invalid bank corporation id" };
  const bank = await db
    .collection<Corporation>("corporations")
    .findOne({ _id: new ObjectId(holder) });
  if (!bank) return { error: "Bank corporation not found" };
  const charter = bank.bankCharter;
  if (!charter || !charterMay(charter, "acceptPlayerDeposits")) {
    return { error: "Target bank must have an active retail or universal charter" };
  }
  const staged = lifecycleRefusal(charter, "takeDeposits");
  if (staged) return { error: staged.message };
  if (charter.currency !== currency) {
    return { error: `Bank charter currency is ${charter.currency}, not ${currency}` };
  }
  if (options.ownerId && isBlockedDepositor(charter, options.ownerId.toString())) {
    return { error: "Character is blacklisted by this bank" };
  }
  return {
    holder,
    cash: getCashReserves(charter),
    acceptsDeposits: true,
    playerDeposits: Math.max(0, finite(charter.playerDeposits)),
    active: charter.status === "active",
    ...(options.withCeiling ? { depositCeiling: await getBankDepositCeiling(db, bank) } : {}),
  };
}

/**
 * Decide and settle one savings command for a character. The command's
 * holder snapshots are loaded here from the account's current holder (and the
 * target for a transfer), so callers pass only the intent.
 */
export async function runSavingsCommand(
  db: Db,
  ownerId: ObjectId,
  currency: CurrencyCode,
  intent:
    | { type: "deposit"; amount: number }
    | { type: "withdraw"; amount: number }
    | { type: "transfer_holder"; to: SavingsHolder },
  commandId: string = new ObjectId().toHexString()
): Promise<SavingsCommandResult> {
  const [policy, turn] = await Promise.all([loadBankingPolicy(db), getCurrentTurn(db)]);
  const account = await ensureSavingsAccount(db, ownerId, currency, turn);
  if (!account) return { ok: false, error: "Character not found" };
  if (account.status !== "open") {
    // Checked before the holder is even loaded: a frozen account's holder is
    // an estate in resolution, and the answer is the account's, not the bank's.
    return {
      ok: false,
      error:
        account.status === "frozen"
          ? "This savings account is frozen while its bank is resolved. It reopens with the central bank once the resolution settles."
          : "This savings account is closed.",
    };
  }

  const current = await loadHolderSnapshot(db, account.holder, currency, { ownerId });
  if ("error" in current) {
    // The account's own holder is no longer valid (a bank that died between
    // turns). Treat it as central-bank held for the purpose of paying out;
    // the resolution pass is what moves it for real.
    return { ok: false, error: current.error };
  }

  let command: SavingsCommand;
  if (intent.type === "deposit") {
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: ownerId }, { projection: { [`currencyBalances.personal.${currency}`]: 1 } });
    let holder: HolderSnapshot = current;
    if (isBankHolder(account.holder)) {
      const withCeiling = await loadHolderSnapshot(db, account.holder, currency, {
        ownerId,
        withCeiling: true,
      });
      if ("error" in withCeiling) return { ok: false, error: withCeiling.error };
      holder = withCeiling;
    }
    command = {
      type: "deposit",
      amount: intent.amount,
      walletBalance: finite(character?.currencyBalances?.personal?.[currency]),
      holder,
    };
  } else if (intent.type === "withdraw") {
    command = { type: "withdraw", amount: intent.amount, holder: current };
  } else {
    const target = await loadHolderSnapshot(db, intent.to, currency, {
      ownerId,
      withCeiling: true,
    });
    if ("error" in target) return { ok: false, error: target.error };
    command = { type: "transfer_holder", from: current, to: target };
  }

  const ctx = {
    turn,
    centralBankId: getBankId(getCountryIdForCurrency(currency)),
    privateBanking: policy.privateBanking,
    expectedVersion: account.version,
  };
  const decision = decideSavingsCommand(account, command, ctx, commandId);
  const commandName =
    intent.type === "deposit"
      ? "savings.deposit"
      : intent.type === "withdraw"
        ? "savings.withdraw"
        : "savings.holder.change";
  if (!decision.allowed) {
    emitBankingAuditEvent(
      {
        kind:
          intent.type === "deposit"
            ? "account.deposited"
            : intent.type === "withdraw"
              ? "account.withdrawn"
              : "account.holder_changed",
        command: commandName,
        turn,
        outcome: "rejected",
        reason: decision.message,
        currency,
        subjectType: "savingsAccount",
        subjectId: account.id,
      },
      db
    );
    return { ok: false, error: decision.message, refusal: decision.refusal };
  }

  const settled = await settleTransition(db, decision.transition);
  if (settled.status === "rejected" || settled.status === "partial" || settled.error) {
    return {
      ok: false,
      error:
        settled.status === "partial" && settled.appliedLegs.length < decision.transition.legs.length
          ? "The balance moved while that was in flight. Try again."
          : (settled.error ?? "The account changed while that was in flight. Try again."),
    };
  }
  emitBankingAuditEvent(
    {
      ...decision.transition.event,
      turn,
      outcome: "ok",
      currency,
      ...(isBankHolder(decision.next.holder) ? { bankId: decision.next.holder } : {}),
      settlementId: decision.transition.key,
    },
    db
  );
  return { ok: true, account: decision.next, settlementId: decision.transition.key };
}
