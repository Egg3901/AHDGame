import { randomUUID } from "node:crypto";
import type { ClientSession, Db, ObjectId } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { Corporation, CorporateSector } from "@/lib/db/types";

export interface UnionBustingPrior {
  unionization: number;
  bustingCooldownUntilTurn: number | null;
  strikeStartedAtTurn: number | null;
  strikeCooldownUntilTurn: number | null;
}

export interface UnionBustingSpendInput {
  corporationId: ObjectId;
  sectorId: ObjectId;
  currentTurn: number;
  cashCost: number;
  prior: UnionBustingPrior;
  /** Resolved outcome (rolled by the caller before the flow starts). */
  newUnionization: number;
  cooldownUntilTurn: number;
  /** Success ends an active strike outright; backfire leaves it untouched. */
  endsActiveStrike: boolean;
  strikeCooldownUntilTurn: number;
  /**
   * Caller-chosen fingerprint of the intended attempt
   * (e.g. `corp:sector:turn:cost`). The roll is deliberately NOT part of it:
   * a same-key crash-recovery retry re-rolls, converges onto the already-
   * applied outcome, and reports the stored unionization (see below).
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same attempt replays the stored outcome instead
   * of charging again. Omit to mint one: the attempt is still crash-safe
   * within the attempt, but a client retry mints a new key and is treated as
   * a new attempt (still guarded by the atomic cooldown claim).
   */
  idempotencyKey?: string;
}

/** Sector claim failed: cooldown raced, or the sector row is gone. */
export const BUSTING_COOLDOWN_ACTIVE = "COOLDOWN_ACTIVE";
/** Corp debit failed: cash raced below the cost (sector claim compensated). */
export const BUSTING_INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS";

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: index 0 is the guarded sector
  // claim (a lost cooldown race was `COOLDOWN_ACTIVE`, 409), index 1 the
  // guarded cash debit (a raced balance was `INSUFFICIENT_FUNDS`, 402).
  if (step.index === 0) return new Error(`${BUSTING_COOLDOWN_ACTIVE}:${outcome}`);
  return new Error(`${BUSTING_INSUFFICIENT_FUNDS}:${outcome}`);
}

/**
 * Charge a union-busting attempt (sector unionization/cooldown claim + corp
 * cash debit) so the result is exactly-once on every topology (issue #1672).
 * Step order mirrors the historical write order: the sector claim lands
 * first, the cash debit second, and a debit failure compensates the claim.
 *
 * Under real transactions the claim, the debit, and the idempotency receipt
 * join the transaction and commit atomically, preserving the old behavior.
 * On a standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between the claim and the debit leaves an
 * `in_progress` receipt, and retrying with the same key reconciles to exactly
 * one charged attempt instead of charging for a bust that never landed (or
 * landing it twice). A retry after a terminal failure throws
 * `MoneyFlowTerminalError` (fail closed); a new attempt needs a new key.
 *
 * Reporting note: the roll happens before the flow, so a same-key recovery
 * retry may compute a different outcome than the one already applied. The
 * stored state always wins (steps converge), and on recovery the flow
 * re-reads the sector and reports the stored unionization rather than the
 * recomputed one.
 */
export async function applyUnionBustingSpend(
  db: Db,
  input: UnionBustingSpendInput
): Promise<{ duplicate: boolean; unionization: number }> {
  if (!input.corporationId || !input.sectorId) {
    throw new TypeError("Union-busting spend needs corporationId and sectorId");
  }
  if (!Number.isFinite(input.cashCost) || input.cashCost <= 0) {
    throw new RangeError("Union-busting cash cost must be positive");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Union-busting idempotency key must be 1-128 characters");
  }

  const sectors = db.collection<CorporateSector>("corporateSectors");
  const corporations = db.collection<Corporation>("corporations");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = new Date();

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") {
      const stored = await sectors.findOne(
        { _id: input.sectorId },
        { ...opts, projection: { unionization: 1 } }
      );
      return {
        duplicate: true as boolean,
        unionization: stored?.unionization ?? input.newUnionization,
      };
    }
    // The sector claim and its inverse close over the pre-attempt snapshot.
    // The inverse restores the exact prior fields (mirroring the historical
    // manual revert, including leaving `updatedAt` alone) so a compensated
    // attempt is invisible downstream; the cooldown guard is dropped on the
    // inverse so a refund is never blocked.
    const sectorClaimStep: MoneyFlowStep = {
      name: "sector-claim",
      apply: (stepOpts) =>
        applyKeyedUpdate(
          key,
          {
            collection: sectors,
            filter: {
              _id: input.sectorId,
              $or: [
                { bustingCooldownUntilTurn: null },
                { bustingCooldownUntilTurn: { $exists: false } },
                { bustingCooldownUntilTurn: { $lte: input.currentTurn } },
              ],
            },
            update: {
              $set: {
                unionization: input.newUnionization,
                bustingCooldownUntilTurn: input.cooldownUntilTurn,
                updatedAt: now,
                ...(input.endsActiveStrike && {
                  strikeStartedAtTurn: null,
                  strikeCooldownUntilTurn: input.strikeCooldownUntilTurn,
                }),
              },
            },
          },
          stepOpts ?? {}
        ),
      revert: (stepOpts) =>
        applyKeyedUpdate(
          `${key}:compensate:sector-claim`,
          {
            collection: sectors,
            filter: { _id: input.sectorId },
            update: {
              $set: {
                unionization: input.prior.unionization,
                bustingCooldownUntilTurn: input.prior.bustingCooldownUntilTurn,
                ...(input.endsActiveStrike && {
                  strikeStartedAtTurn: input.prior.strikeStartedAtTurn,
                  strikeCooldownUntilTurn: input.prior.strikeCooldownUntilTurn,
                }),
              },
            },
          },
          stepOpts ?? {}
        ),
    };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        sectorClaimStep,
        makeLegStep(key, {
          name: "cash-debit",
          collection: corporations,
          docId: input.corporationId,
          field: "liquidCapital",
          delta: -input.cashCost,
          minBalance: input.cashCost,
          set: { updatedAt: now },
        }),
      ],
      mapSpendError,
      opts
    );
    if (claim === "in-progress") {
      // Crash-recovery retry: the steps converged onto the first attempt's
      // outcome, which may differ from this call's recomputed roll. Report
      // the stored unionization, not the recomputed one.
      const stored = await sectors.findOne(
        { _id: input.sectorId },
        { ...opts, projection: { unionization: 1 } }
      );
      return {
        duplicate: true as boolean,
        unionization: stored?.unionization ?? input.newUnionization,
      };
    }
    return { duplicate: false as boolean, unionization: input.newUnionization };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
