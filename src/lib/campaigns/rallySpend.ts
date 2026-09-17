import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Campaign, ElectionCandidate } from "@/lib/db/types";

/** Campaign-actions debit failed: the pool raced, or the campaign row is gone. */
export const RALLY_ACTIONS_CHANGED = "RALLY_ACTIONS_CHANGED";
/** Candidate write failed: the throttle raced, or the candidate row is gone. */
export const RALLY_CANDIDATE_CHANGED = "RALLY_CANDIDATE_CHANGED";

export interface RallySpendInput {
  campaignId: ObjectId;
  /** `_id` of the `electionCandidates` row backing this campaign. */
  candidateRowId: ObjectId;
  actionCost: number;
  /**
   * Pre-rally `lastRallyTurn` the candidate write guards on (`undefined`
   * matches an unset field). The one-per-turn throttle lives in this guard,
   * so two same-turn fires cannot both land.
   */
  priorLastRallyTurn: number | undefined;
  /** Clamped post-rally support (60% immediate bump already applied). */
  nextSupport: number;
  currentTurn: number;
  /** 40% trailing-drip entry queued on the candidate row. */
  accrualEntry: { amountPerTurn: number; turnsRemaining: number };
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended rally
   * (e.g. `rally:<campaign>:<candidate>:<turn>`). Turn-scoped, matching the
   * throttle: a same-key retry next turn conflicts (fail closed) instead of
   * replaying last turn's rally.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same rally replays the stored outcome instead of
   * spending again. Omit to mint one: the rally is still crash-safe within
   * the attempt, but a client retry mints a new key and is treated as a new
   * rally (still throttled by the atomic `lastRallyTurn` guard).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded
  // campaign-actions debit (a raced pool was `Campaign actions changed since
  // page load`, 409). Index 1 is the terminal candidate write — a survived
  // guard failure (a real crash runs no code at all, so anything observed
  // here is a failure the process lived through) compensates the debit
  // prefix instead of stranding spent-for-nothing actions: a lost throttle
  // race was `Rally state changed since page load`, 409, and a vanished row
  // was `Candidate not found`, 404.
  if (step.index === 0) return new Error(`${RALLY_ACTIONS_CHANGED}:${outcome}`);
  if (outcome === "missing") return new Error(`${RALLY_CANDIDATE_CHANGED}:candidate-missing`);
  return new Error(`${RALLY_CANDIDATE_CHANGED}:${outcome}`);
}

/**
 * Fire a one-shot rally (campaign-actions debit + candidate support write
 * with trailing-drip accrual) so the result is exactly-once on every
 * topology (issue #1672). Step order mirrors the historical write order: the
 * actions debit lands first, the candidate write second, and a candidate
 * failure compensates the debit in reverse.
 *
 * Under real transactions the debit, the candidate write, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between them leaves an `in_progress`
 * receipt, and retrying with the same key reconciles to exactly one charged
 * rally instead of spending actions for support that never landed (or
 * landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 */
export async function applyRallySpend(
  db: Db,
  input: RallySpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.campaignId || !input.candidateRowId) {
    throw new TypeError("Rally spend needs campaignId and candidateRowId");
  }
  if (!Number.isFinite(input.actionCost) || input.actionCost <= 0) {
    throw new RangeError("Rally action cost must be positive");
  }
  if (!Number.isFinite(input.nextSupport)) {
    throw new RangeError("Rally next support must be finite");
  }
  if (!Number.isFinite(input.currentTurn)) {
    throw new RangeError("Rally current turn must be finite");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Rally idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const campaigns = db.collection<Campaign>("campaigns");
  const candidates = db.collection<ElectionCandidate>("electionCandidates");
  const now = input.now;

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "campaign-actions-debit",
          collection: campaigns,
          docId: input.campaignId,
          field: "actions",
          delta: -input.actionCost,
          minBalance: input.actionCost,
          set: { updatedAt: now },
        }),
        {
          // Terminal step: nothing runs after it, so it carries no inverse.
          // The atomic guard is the one-per-turn throttle plus the key: a
          // same-turn rival fire trips the throttle guard (409), a same-key
          // recovery converges to `already-applied`.
          name: "candidate-apply",
          apply: (stepOpts) =>
            applyKeyedUpdate(
              key,
              {
                collection: candidates,
                filter: {
                  _id: input.candidateRowId,
                  ...(input.priorLastRallyTurn === undefined
                    ? { lastRallyTurn: { $exists: false } }
                    : { lastRallyTurn: input.priorLastRallyTurn }),
                },
                update: {
                  $set: { support: input.nextSupport, lastRallyTurn: input.currentTurn },
                  $push: { supportAccrual: input.accrualEntry },
                },
              },
              stepOpts ?? {}
            ),
        },
      ],
      mapSpendError,
      opts
    );
    return { duplicate: claim === "in-progress" };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
