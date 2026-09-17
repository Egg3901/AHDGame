import { randomUUID } from "node:crypto";
import type { ClientSession, Collection, Db, Filter, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyIdempotentLeg,
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  runMoneyFlowSteps,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { NPP, PoliticalParty, StatePartyOrg } from "@/lib/db/types";

export const NATIONAL_RECRUITMENT_CHANGED = "NATIONAL_RECRUITMENT_CHANGED";
export const STATE_RECRUITMENT_CHANGED = "STATE_RECRUITMENT_CHANGED";

export type RecruitSpendScope = "national" | "state";

export interface RecruitSpendCooldown {
  /** Fields to `$set` when the recruit starts a fresh cooldown. */
  set: { nppRecruitmentCooldownUntil: Date; nppRecruitmentCooldownUntilTurn: number };
  /** Readiness filter fragment spread into the atomic deduct. */
  readyFilter: Record<string, unknown>;
  /**
   * Pre-recruit cooldown fields, for restoring the exact prior state if the
   * flow compensates (mirrors the historical manual rollback: `$set` the
   * fields that existed, `$unset` the ones that did not, so a revert never
   * leaves a phantom cooldown behind).
   */
  prior: { nppRecruitmentCooldownUntil?: Date; nppRecruitmentCooldownUntilTurn?: number };
}

export interface RecruitSpendInput {
  scope: RecruitSpendScope;
  /** National scope: the party row (also carries the prior cooldown). */
  partyObjectId: ObjectId;
  /**
   * State scope: the state-party-org row `_id` read by the route. Null when
   * the row does not exist: the spend refuses before claiming any receipt,
   * preserving the historical 409 (the deduct could never match).
   */
  orgDocId: string | null;
  /** Flat Action Points cost (AP pool of the scope's row). */
  recruitCost: number;
  /** Treasury cost in the scope row's currency. */
  recruitFund: number;
  cooldown: RecruitSpendCooldown;
  /** NPP row to record; the `_id` is derived from the idempotency key. */
  npp: Omit<NPP, "_id">;
  /**
   * Caller-chosen fingerprint of the intended recruit
   * (e.g. `national:party:state:turn`). A retry presenting the same key with
   * a different fingerprint is rejected instead of returning the stored
   * outcome for the wrong recruit.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same recruit replays the stored outcome instead of
   * spending again. Omit to mint one: the recruit is still crash-safe within
   * the attempt, but a client retry mints a new key and is treated as a new
   * recruit (still guarded by the atomic cooldown/balance deduct).
   */
  idempotencyKey?: string;
}

function changedSentinel(scope: RecruitSpendScope): string {
  return scope === "national" ? NATIONAL_RECRUITMENT_CHANGED : STATE_RECRUITMENT_CHANGED;
}

function mapSpendError(
  scope: RecruitSpendScope
): (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => Error {
  return (step, outcome) => {
    // Preserve the historical sentinel surface: a rejected spend debit (a
    // raced balance, a lost cooldown race, or a missing row) was
    // `*_RECRUITMENT_CHANGED` (409). The terminal NPP-row insert can only
    // report applied/already-applied on success (a duplicate `_id` IS the
    // convergence case); anything else compensates the debit prefix and fails
    // closed, where the old code rolled back and threw (500).
    if (step.name === "spend-debit") return new Error(changedSentinel(scope));
    return new Error(`RECRUIT_CONFLICT:${outcome}`);
  };
}

/**
 * Spend a political recruitment (scope-row Action Points + treasury) and
 * record the recruited NPP so the result is exactly-once on every topology
 * (issue #1672). One shared primitive for the national route (party row) and
 * the state route (state-party-org row); the two scopes differ only in which
 * row the debit guards.
 *
 * Under real transactions the debit, the NPP insert, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between the debit and the insert leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged recruit instead of spending for an NPP that never landed (or
 * landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyRecruitSpend(
  db: Db,
  input: RecruitSpendInput
): Promise<{ duplicate: boolean; nppId: ObjectId }> {
  if (!input.partyObjectId) {
    throw new TypeError("Recruit spend needs partyObjectId");
  }
  if (input.scope === "state" && input.orgDocId == null) {
    // No state-party-org row: the historical deduct matched nothing and the
    // route answered 409. Refuse before claiming so a doomed attempt settles
    // no receipt.
    throw new Error(changedSentinel(input.scope));
  }
  if (!Number.isFinite(input.recruitCost) || input.recruitCost <= 0) {
    throw new RangeError("Recruit cost must be positive");
  }
  if (!Number.isFinite(input.recruitFund) || input.recruitFund <= 0) {
    throw new RangeError("Recruit fund cost must be positive");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Recruit idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const npps = db.collection<NPP>("npps");
  const nppId = keyedInsertId(key, "npp-recruit");
  const now = new Date();
  const mapStepError = mapSpendError(input.scope);

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean, nppId };

    // The debit and its inverse close over one scope's row. The inverse
    // restores the exact prior cooldown ($set what existed, $unset what did
    // not) so a compensated attempt leaves no phantom cooldown behind; the
    // balance guards are dropped on the inverse so a refund is never blocked.
    // Generic per scope so the national (party) and state (org) rows share
    // one shape: `Collection<T>` is invariant (via `bulkWrite`), so the two
    // scopes meet only behind the collection-erased `MoneyFlowStep`.
    const spendDebitStep = <TDoc extends MoneyFlowAccount>(
      collection: Collection<TDoc>,
      docId: TDoc["_id"]
    ): MoneyFlowStep => {
      const revertCooldownSet: Record<string, unknown> = { updatedAt: new Date() };
      const revertCooldownUnset: Record<string, ""> = {};
      if (input.cooldown.prior.nppRecruitmentCooldownUntil) {
        revertCooldownSet.nppRecruitmentCooldownUntil =
          input.cooldown.prior.nppRecruitmentCooldownUntil;
      } else {
        revertCooldownUnset.nppRecruitmentCooldownUntil = "";
      }
      if (input.cooldown.prior.nppRecruitmentCooldownUntilTurn != null) {
        revertCooldownSet.nppRecruitmentCooldownUntilTurn =
          input.cooldown.prior.nppRecruitmentCooldownUntilTurn;
      } else {
        revertCooldownUnset.nppRecruitmentCooldownUntilTurn = "";
      }
      return {
        name: "spend-debit",
        apply: (stepOpts) =>
          applyIdempotentLeg(
            key,
            {
              name: "spend-debit",
              collection,
              docId,
              field: "nppActionPoints",
              delta: -input.recruitCost,
              minBalance: input.recruitCost,
              extraIncs: { treasury: -input.recruitFund },
              extraFilter: {
                treasury: { $gte: input.recruitFund },
                ...input.cooldown.readyFilter,
              } as Filter<TDoc>,
              set: { ...input.cooldown.set, updatedAt: now },
            },
            stepOpts ?? {}
          ),
        revert: (stepOpts) =>
          applyKeyedUpdate(
            `${key}:compensate:spend-debit`,
            {
              collection,
              filter: { _id: docId } as Filter<TDoc>,
              update: {
                $inc: { nppActionPoints: input.recruitCost, treasury: input.recruitFund },
                $set: revertCooldownSet,
                ...(Object.keys(revertCooldownUnset).length > 0
                  ? { $unset: revertCooldownUnset }
                  : {}),
              },
            },
            stepOpts ?? {}
          ),
      };
    };

    const debitStep =
      input.scope === "national"
        ? spendDebitStep(db.collection<PoliticalParty>("politicalParties"), input.partyObjectId)
        : spendDebitStep(db.collection<StatePartyOrg>("statePartyOrg"), input.orgDocId as string);

    await runMoneyFlowSteps(
      receipts,
      key,
      [debitStep, makeInsertStep("npp-row", npps, { ...input.npp, _id: nppId })],
      mapStepError,
      opts
    );
    return { duplicate: claim === "in-progress", nppId };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
