/**
 * Savings commands: deposit, withdraw, transfer the holder, accrue and credit
 * interest, resolve a failed holder. Each is a pure decision over the account
 * snapshot and the context the caller loaded, returning one balanced
 * transition for the settlement journal.
 *
 * The money model these commands enforce:
 *
 * - A deposit moves cash from the owner's wallet into the account. When the
 *   holder is a bank, the cash lands in that bank's vault and the bank's
 *   player-deposit liability rises by the same amount. When the holder is the
 *   central bank, the cash leaves circulation into the household pool.
 * - A withdrawal is the mirror. A bank that cannot cover it is refused before
 *   anything moves.
 * - A holder transfer moves the BACKING, never the balance: the whole balance
 *   leaves the old holder's cash and lands in the new holder's, and each
 *   holder's liability changes by the same amount. The owner's displayed
 *   balance is unchanged by construction.
 * - Interest at a bank is paid from the bank's vault into the account;
 *   interest at the central bank is currency creation, recorded as a mint.
 * - Resolving a failed bank transfers every account it holds back to the
 *   central bank, funded by the estate, the insurance fund and the treasury
 *   in that order; the owner's balance is unchanged.
 */

import type { SavingsHolder } from "@/lib/db/types/bank";
import {
  CENTRAL_BANK_HOLDER,
  isBankHolder,
  type SavingsAccountSnapshot,
} from "@/lib/savings/rules/accounts";
import {
  oid,
  type BankingTransition,
  type TransitionLeg,
  type TransitionProjection,
} from "@/lib/banking/rules/boundary";

export interface HolderSnapshot {
  holder: SavingsHolder;
  /** Cash the holder has available to pay out (a bank's vault). Ignored for the central bank. */
  cash: number;
  /** Whether the holder may accept new player deposits right now. */
  acceptsDeposits: boolean;
  /** Player deposits the holder already carries, for the ceiling check. */
  playerDeposits: number;
  /** Deposit ceiling for a bank holder; omit for the central bank. */
  depositCeiling?: number;
  /** Whether the holder's charter is active. Always true for the central bank. */
  active: boolean;
}

export interface SavingsContext {
  turn: number;
  /** Central bank document id for the currency. */
  centralBankId: string;
  /** Whether private banking is enabled at all. */
  privateBanking: boolean;
  /** Expected account version, for optimistic concurrency. */
  expectedVersion?: number;
}

export type SavingsCommand =
  | { type: "deposit"; amount: number; walletBalance: number; holder: HolderSnapshot }
  | { type: "withdraw"; amount: number; holder: HolderSnapshot }
  | { type: "transfer_holder"; from: HolderSnapshot; to: HolderSnapshot }
  | { type: "accrue_interest"; amount: number }
  | { type: "credit_interest"; holder: HolderSnapshot }
  | {
      type: "resolve_failed_holder";
      holder: HolderSnapshot;
      /** How much of this account's balance the estate can cover from its own cash. */
      fromEstate: number;
      fromInsuranceFund: number;
      fromTreasury: number;
    };

export type SavingsRefusal =
  | { code: "invalid_amount" }
  | { code: "account_status"; status: SavingsAccountSnapshot["status"] }
  | { code: "version_conflict"; expected: number; actual: number }
  | { code: "insufficient_funds"; available: number }
  | { code: "holder_cannot_pay"; available: number }
  | { code: "holder_refuses"; detail: string }
  | { code: "same_holder" }
  | { code: "ceiling"; max: number }
  | { code: "currency_mismatch" }
  | { code: "banking_disabled" }
  | { code: "not_failed" };

export type SavingsDecision =
  | { allowed: true; transition: BankingTransition; next: SavingsAccountSnapshot }
  | { allowed: false; refusal: SavingsRefusal; message: string };

function refuse(refusal: SavingsRefusal, message: string): SavingsDecision {
  return { allowed: false, refusal, message };
}

function positive(amount: number): number | null {
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/** Where a holder's backing cash lives. */
function holderCashTarget(
  holder: SavingsHolder,
  centralBankId: string
): Pick<TransitionLeg, "collection" | "filter" | "path"> {
  if (!isBankHolder(holder)) {
    return {
      collection: "centralBanks",
      filter: { _id: centralBankId },
      path: "externalBroadMoney",
    };
  }
  return {
    collection: "corporations",
    filter: { _id: oid(holder), "bankCharter.status": "active" },
    path: "bankCharter.cashReserves",
  };
}

/** The liability counter a holder carries for player deposits. */
function holderLiabilityProjection(
  holder: SavingsHolder,
  delta: number,
  centralBankId: string
): TransitionProjection | null {
  if (delta === 0) return null;
  if (!isBankHolder(holder)) {
    return {
      collection: "centralBanks",
      filter: { _id: centralBankId },
      update: { $inc: { householdSavingsLiability: delta } },
      note: "central bank's liability on the savings it holds",
    };
  }
  return {
    collection: "corporations",
    filter: { _id: oid(holder) },
    update: { $inc: { "bankCharter.playerDeposits": delta } },
    note: "bank's liability on the player savings it holds",
  };
}

function accountProjection(
  account: SavingsAccountSnapshot,
  next: SavingsAccountSnapshot,
  key: string,
  turn: number
): TransitionProjection {
  return {
    collection: "savingsAccounts",
    // Guarded on the version we decided against: a concurrent command that
    // won the race leaves this one matching nothing, which the journal
    // reports as a partial the caller retries from a fresh snapshot.
    filter: { _id: oid(account.id), version: account.version },
    update: {
      $set: {
        balance: next.balance,
        holder: next.holder,
        status: next.status,
        accruedInterest: next.accruedInterest,
        interestEarned: next.interestEarned,
        lastSettlementKey: key,
        lastSettledTurn: turn,
      },
      $inc: { version: 1 },
    },
    note: "the authoritative savings account",
  };
}

/** Compatibility projection onto the character document, for existing readers. */
function legacyProjectionFor(
  account: SavingsAccountSnapshot,
  next: SavingsAccountSnapshot
): TransitionProjection | null {
  if (account.ownerType !== "character") return null;
  return {
    collection: "characters",
    filter: { _id: oid(account.ownerId) },
    update: {
      $set: {
        [`currencyBalances.savings.${account.currency}`]: next.balance,
        [`currencyBalances.savingsHolder.${account.currency}`]: next.holder,
        [`currencyBalances.pendingSavingsInterest.${account.currency}`]: next.accruedInterest,
        [`currencyBalances.interestEarned.${account.currency}`]: next.interestEarned,
      },
    },
    note: "legacy character savings fields kept in step",
  };
}

function walletLeg(
  account: SavingsAccountSnapshot,
  kind: "debit" | "credit",
  amount: number
): TransitionLeg {
  return {
    kind,
    amount,
    collection: account.ownerType === "character" ? "characters" : "npps",
    filter: { _id: oid(account.ownerId) },
    path:
      account.ownerType === "character"
        ? `currencyBalances.personal.${account.currency}`
        : `currencyBalances.personal.${account.currency}`,
    note:
      kind === "debit" ? "cash leaves the owner's wallet" : "cash returns to the owner's wallet",
  };
}

function checkVersion(
  account: SavingsAccountSnapshot,
  ctx: SavingsContext
): SavingsDecision | null {
  if (ctx.expectedVersion !== undefined && ctx.expectedVersion !== account.version) {
    return refuse(
      { code: "version_conflict", expected: ctx.expectedVersion, actual: account.version },
      "The account changed while that was in flight. Try again."
    );
  }
  return null;
}

function transitionFor(
  account: SavingsAccountSnapshot,
  ctx: SavingsContext,
  kind: string,
  suffix: string,
  legs: TransitionLeg[],
  projections: (TransitionProjection | null)[],
  event: BankingTransition["event"]
): BankingTransition {
  return {
    key: `${kind}:${account.id}:${suffix}`,
    kind,
    turn: ctx.turn,
    currency: account.currency,
    legs,
    projections: projections.filter((p): p is TransitionProjection => p !== null),
    event,
  };
}

export function decideSavingsCommand(
  account: SavingsAccountSnapshot,
  command: SavingsCommand,
  ctx: SavingsContext,
  commandId: string
): SavingsDecision {
  const conflict = checkVersion(account, ctx);
  if (conflict) return conflict;
  const suffix = `${ctx.turn}:${commandId}`;

  switch (command.type) {
    case "deposit": {
      if (account.status !== "open") {
        return refuse(
          { code: "account_status", status: account.status },
          "This savings account is not open for deposits right now."
        );
      }
      if (command.holder.holder !== account.holder) {
        return refuse(
          { code: "holder_refuses", detail: "holder mismatch" },
          "The account's holder changed. Reload and try again."
        );
      }
      const amount = positive(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, "Invalid amount");
      if (amount > command.walletBalance + 1e-9) {
        return refuse(
          { code: "insufficient_funds", available: command.walletBalance },
          "Insufficient liquid balance"
        );
      }
      if (isBankHolder(account.holder)) {
        if (!ctx.privateBanking)
          return refuse({ code: "banking_disabled" }, "Private banking is not enabled");
        if (!command.holder.active || !command.holder.acceptsDeposits) {
          return refuse(
            { code: "holder_refuses", detail: "not accepting" },
            "This bank is not accepting deposits right now."
          );
        }
        const ceiling = command.holder.depositCeiling;
        if (ceiling !== undefined && command.holder.playerDeposits + amount > ceiling + 1e-9) {
          return refuse(
            { code: "ceiling", max: Math.max(0, ceiling - command.holder.playerDeposits) },
            "Bank deposit ceiling reached; cannot accept additional player deposits"
          );
        }
      }
      const next = { ...account, balance: account.balance + amount, version: account.version + 1 };
      const target = holderCashTarget(account.holder, ctx.centralBankId);
      return {
        allowed: true,
        next,
        transition: transitionFor(
          account,
          ctx,
          "savings_deposit",
          suffix,
          [
            walletLeg(account, "debit", amount),
            { kind: "credit", amount, ...target, note: "deposit backs the account at its holder" },
          ],
          [
            holderLiabilityProjection(account.holder, amount, ctx.centralBankId),
            accountProjection(account, next, `savings_deposit:${account.id}:${suffix}`, ctx.turn),
            legacyProjectionFor(account, next),
          ],
          {
            kind: "account.deposited",
            command: "savings.deposit",
            subjectType: "savingsAccount",
            subjectId: account.id,
            statusAfter: account.holder,
            amount,
          }
        ),
      };
    }

    case "withdraw": {
      if (account.status !== "open") {
        return refuse(
          { code: "account_status", status: account.status },
          "This savings account cannot pay out right now."
        );
      }
      if (command.holder.holder !== account.holder) {
        return refuse(
          { code: "holder_refuses", detail: "holder mismatch" },
          "The account's holder changed. Reload and try again."
        );
      }
      const amount = positive(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, "Invalid amount");
      if (amount > account.balance + 1e-9) {
        return refuse(
          { code: "insufficient_funds", available: account.balance },
          "Insufficient savings balance"
        );
      }
      if (isBankHolder(account.holder) && amount > command.holder.cash + 1e-9) {
        return refuse(
          { code: "holder_cannot_pay", available: Math.max(0, command.holder.cash) },
          "The bank cannot cover that withdrawal from its cash right now. Withdraw less, or move your savings to the central bank."
        );
      }
      const next = { ...account, balance: account.balance - amount, version: account.version + 1 };
      const source = holderCashTarget(account.holder, ctx.centralBankId);
      return {
        allowed: true,
        next,
        transition: transitionFor(
          account,
          ctx,
          "savings_withdrawal",
          suffix,
          [
            { kind: "debit", amount, ...source, note: "the holder pays out from its cash" },
            walletLeg(account, "credit", amount),
          ],
          [
            holderLiabilityProjection(account.holder, -amount, ctx.centralBankId),
            accountProjection(
              account,
              next,
              `savings_withdrawal:${account.id}:${suffix}`,
              ctx.turn
            ),
            legacyProjectionFor(account, next),
          ],
          {
            kind: "account.withdrawn",
            command: "savings.withdraw",
            subjectType: "savingsAccount",
            subjectId: account.id,
            statusAfter: account.holder,
            amount: -amount,
          }
        ),
      };
    }

    case "transfer_holder": {
      if (account.status !== "open") {
        return refuse(
          { code: "account_status", status: account.status },
          "This savings account cannot be moved right now."
        );
      }
      if (command.from.holder !== account.holder) {
        return refuse(
          { code: "holder_refuses", detail: "holder mismatch" },
          "The account's holder changed. Reload and try again."
        );
      }
      if (command.to.holder === account.holder) {
        return refuse({ code: "same_holder" }, "Your savings are already held there.");
      }
      const toBank = isBankHolder(command.to.holder);
      if (toBank) {
        if (!ctx.privateBanking)
          return refuse({ code: "banking_disabled" }, "Private banking is not enabled");
        if (!command.to.active || !command.to.acceptsDeposits) {
          return refuse(
            { code: "holder_refuses", detail: "target not accepting" },
            "Target bank must have an active retail or universal charter"
          );
        }
        const ceiling = command.to.depositCeiling;
        if (ceiling !== undefined && command.to.playerDeposits + account.balance > ceiling + 1e-9) {
          return refuse(
            { code: "ceiling", max: Math.max(0, ceiling - command.to.playerDeposits) },
            "Bank deposit ceiling reached; cannot accept additional player deposits"
          );
        }
      }
      const amount = account.balance;
      if (isBankHolder(account.holder) && amount > command.from.cash + 1e-9) {
        return refuse(
          { code: "holder_cannot_pay", available: Math.max(0, command.from.cash) },
          "The bank cannot release your savings from its cash right now."
        );
      }
      const next = { ...account, holder: command.to.holder, version: account.version + 1 };
      const legs: TransitionLeg[] = [];
      if (amount > 0) {
        legs.push(
          {
            kind: "debit",
            amount,
            ...holderCashTarget(account.holder, ctx.centralBankId),
            note: "backing cash leaves the old holder",
          },
          {
            kind: "credit",
            amount,
            ...holderCashTarget(command.to.holder, ctx.centralBankId),
            note: "backing cash arrives at the new holder",
          }
        );
      }
      return {
        allowed: true,
        next,
        transition: transitionFor(
          account,
          ctx,
          "savings_holder_transfer",
          suffix,
          legs,
          [
            holderLiabilityProjection(account.holder, -amount, ctx.centralBankId),
            holderLiabilityProjection(command.to.holder, amount, ctx.centralBankId),
            accountProjection(
              account,
              next,
              `savings_holder_transfer:${account.id}:${suffix}`,
              ctx.turn
            ),
            legacyProjectionFor(account, next),
          ],
          {
            kind: "account.holder_changed",
            command: "savings.holder.change",
            subjectType: "savingsAccount",
            subjectId: account.id,
            statusBefore: account.holder,
            statusAfter: command.to.holder,
            amount,
          }
        ),
      };
    }

    case "accrue_interest": {
      const amount = positive(command.amount);
      if (amount === null) return refuse({ code: "invalid_amount" }, "Invalid amount");
      if (account.status !== "open") {
        return refuse(
          { code: "account_status", status: account.status },
          "closed accounts accrue nothing"
        );
      }
      const next = {
        ...account,
        accruedInterest: account.accruedInterest + amount,
        version: account.version + 1,
      };
      return {
        allowed: true,
        next,
        transition: transitionFor(
          account,
          ctx,
          "savings_interest_accrual",
          suffix,
          [],
          [
            accountProjection(
              account,
              next,
              `savings_interest_accrual:${account.id}:${suffix}`,
              ctx.turn
            ),
            legacyProjectionFor(account, next),
          ],
          {
            kind: "account.interest_paid",
            command: "savings.interest.accrue",
            subjectType: "savingsAccount",
            subjectId: account.id,
            amount,
            meta: { credited: false },
          }
        ),
      };
    }

    case "credit_interest": {
      const amount = account.accruedInterest;
      if (!(amount > 0)) return refuse({ code: "invalid_amount" }, "nothing accrued");
      if (command.holder.holder !== account.holder) {
        return refuse({ code: "holder_refuses", detail: "holder mismatch" }, "holder changed");
      }
      const bank = isBankHolder(account.holder);
      if (bank && amount > command.holder.cash + 1e-9) {
        return refuse(
          { code: "holder_cannot_pay", available: Math.max(0, command.holder.cash) },
          "the bank cannot fund the interest due"
        );
      }
      const next = {
        ...account,
        balance: account.balance + amount,
        accruedInterest: 0,
        interestEarned: account.interestEarned + amount,
        version: account.version + 1,
      };
      // A bank pays interest out of its vault into the liability it already
      // carries: the cash stays where it is and the liability grows. The
      // central bank creates the money.
      const legs: TransitionLeg[] = bank
        ? []
        : [
            { kind: "mint", amount, note: "central bank creates the interest it pays" },
            {
              kind: "credit",
              amount,
              ...holderCashTarget(CENTRAL_BANK_HOLDER, ctx.centralBankId),
              note: "interest enters the household pool",
            },
          ];
      return {
        allowed: true,
        next,
        transition: transitionFor(
          account,
          ctx,
          "savings_interest_credit",
          suffix,
          legs,
          [
            holderLiabilityProjection(account.holder, amount, ctx.centralBankId),
            bank
              ? null
              : {
                  collection: "centralBanks",
                  filter: { _id: ctx.centralBankId },
                  update: {
                    $inc: { netMoneyCreatedLifetime: amount, savingsInterestPaidLifetime: amount },
                  },
                  note: "money creation recorded at the central bank",
                },
            accountProjection(
              account,
              next,
              `savings_interest_credit:${account.id}:${suffix}`,
              ctx.turn
            ),
            legacyProjectionFor(account, next),
          ],
          {
            kind: "account.interest_paid",
            command: "savings.interest.credit",
            subjectType: "savingsAccount",
            subjectId: account.id,
            amount,
            meta: { credited: true, payer: bank ? "bank" : "centralBank" },
          }
        ),
      };
    }

    case "resolve_failed_holder": {
      if (!isBankHolder(account.holder)) return refuse({ code: "not_failed" }, "not bank-held");
      if (command.holder.holder !== account.holder) {
        return refuse({ code: "holder_refuses", detail: "holder mismatch" }, "holder changed");
      }
      const amount = account.balance;
      const covered = command.fromEstate + command.fromInsuranceFund + command.fromTreasury;
      if (Math.abs(covered - amount) > 1e-6) {
        return refuse({ code: "invalid_amount" }, "the resolution must fund the whole balance");
      }
      const next = {
        ...account,
        holder: CENTRAL_BANK_HOLDER,
        status: "open" as const,
        version: account.version + 1,
      };
      const legs: TransitionLeg[] = [];
      if (command.fromEstate > 0) {
        legs.push({
          kind: "debit",
          amount: command.fromEstate,
          collection: "corporations",
          filter: { _id: oid(account.holder) },
          path: "bankCharter.cashReserves",
          note: "the estate returns what cash it holds",
        });
      }
      if (command.fromInsuranceFund > 0) {
        legs.push({
          kind: "debit",
          amount: command.fromInsuranceFund,
          collection: "depositInsuranceFunds",
          filter: { _id: account.currency },
          path: "balance",
          note: "deposit insurance covers the shortfall",
        });
      }
      if (command.fromTreasury > 0) {
        legs.push({
          kind: "mint",
          amount: command.fromTreasury,
          note: "treasury backstop, deficit financed",
        });
      }
      if (amount > 0) {
        legs.push({
          kind: "credit",
          amount,
          ...holderCashTarget(CENTRAL_BANK_HOLDER, ctx.centralBankId),
          note: "backing returns to the central bank's household pool",
        });
      }
      return {
        allowed: true,
        next,
        transition: transitionFor(
          account,
          ctx,
          "savings_failed_holder_resolution",
          suffix,
          legs,
          [
            holderLiabilityProjection(account.holder, -amount, ctx.centralBankId),
            holderLiabilityProjection(CENTRAL_BANK_HOLDER, amount, ctx.centralBankId),
            accountProjection(
              account,
              next,
              `savings_failed_holder_resolution:${account.id}:${suffix}`,
              ctx.turn
            ),
            legacyProjectionFor(account, next),
          ],
          {
            kind: "account.holder_changed",
            command: "savings.holder.resolve",
            subjectType: "savingsAccount",
            subjectId: account.id,
            statusBefore: account.holder,
            statusAfter: CENTRAL_BANK_HOLDER,
            amount,
            meta: {
              fromEstate: command.fromEstate,
              fromInsuranceFund: command.fromInsuranceFund,
              fromTreasury: command.fromTreasury,
            },
          }
        ),
      };
    }
  }
}
