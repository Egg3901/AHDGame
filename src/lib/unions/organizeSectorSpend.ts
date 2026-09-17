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
import type { Character, CorporateSector, Union } from "@/lib/db/types";

/** Action-points debit failed: the pool raced, or the character row is gone. */
export const ORGANIZE_ACTIONS_CHANGED = "ORGANIZE_ACTIONS_CHANGED";
/** Treasury debit failed: the strike fund raced, or the union row is gone. */
export const ORGANIZE_TREASURY_CHANGED = "ORGANIZE_TREASURY_CHANGED";
/** Sector write failed: the shop moved under the drive, or the row is gone. */
export const ORGANIZE_SECTOR_CHANGED = "ORGANIZE_SECTOR_CHANGED";

export interface OrganizeSectorSpendInput {
  characterId: ObjectId;
  unionId: ObjectId;
  sectorId: ObjectId;
  actionCost: number;
  treasuryCost: number;
  /**
   * Pre-drive sector values the sector write guards on. Passed through
   * exactly as read (nullish stays nullish), matching the historical
   * optimistic-concurrency filter.
   */
  priorUnionization: number | undefined;
  priorRepresentingUnionId: ObjectId | null | undefined;
  /** Post-drive sector values. Ignored unless `applySector` is true. */
  nextUnionization: number;
  nextRepresentingUnionId: ObjectId | null;
  now: Date;
  /**
   * False for a raid that lost its contest: the spend above is the entire
   * penalty and the sector is left exactly as it was, so the flow is the two
   * debit legs only.
   */
  applySector: boolean;
  /**
   * Caller-chosen fingerprint of the intended drive
   * (e.g. `organize-sector:<union>:<sector>`). Stable across recovery
   * retries: the cost is recomputed live before the flow, and the stored
   * steps always win (key guards converge) while the caller reports its
   * recomputed plan, matching the stored one whenever the sector did not
   * move between attempts.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same drive replays the stored outcome instead of
   * charging again. Omit to mint one: the drive is still crash-safe within
   * the attempt, but a client retry mints a new key and is treated as a new
   * drive (still guarded by the atomic debits).
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface: the actions debit (a raced
  // pool was `Your available actions changed`, 409), the treasury debit (a
  // raced fund was `Union treasury changed`, 409), and the terminal sector
  // write (a moved shop was `Sector state changed`, 409), each with the
  // applied prefix compensated.
  if (step.name === "actions-debit") return new Error(`${ORGANIZE_ACTIONS_CHANGED}:${outcome}`);
  if (step.name === "treasury-debit") return new Error(`${ORGANIZE_TREASURY_CHANGED}:${outcome}`);
  return new Error(`${ORGANIZE_SECTOR_CHANGED}:${outcome}`);
}

/**
 * Charge a targeted organizing drive (action-points debit + treasury debit +
 * sector transition) so the result is exactly-once on every topology (issue
 * #1672). Step order mirrors the historical write order: actions first,
 * treasury second, the sector transition last, and a later failure
 * compensates the applied prefix in reverse — the historical
 * spend-then-refund-on-failure, made crash-safe.
 *
 * Under real transactions the debits, the sector write, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between them leaves an `in_progress`
 * receipt, and retrying with the same key reconciles to exactly one charged
 * drive instead of charging for a push that never landed (or landing it
 * twice). A retry after a terminal failure throws `MoneyFlowTerminalError`
 * (fail closed); a new attempt needs a new key.
 */
export async function applyOrganizeSectorSpend(
  db: Db,
  input: OrganizeSectorSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.characterId || !input.unionId || !input.sectorId) {
    throw new TypeError("Organize sector spend needs characterId, unionId, and sectorId");
  }
  if (!Number.isFinite(input.actionCost) || input.actionCost <= 0) {
    throw new RangeError("Organize sector action cost must be positive");
  }
  if (!Number.isFinite(input.treasuryCost) || input.treasuryCost < 0) {
    throw new RangeError("Organize sector treasury cost must be non-negative");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Organize sector idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const characters = db.collection<Character>("characters");
  const unions = db.collection<Union>("unions");
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const now = input.now;

  // Terminal step: nothing runs after it, so it carries no inverse. The
  // atomic guard is the pre-drive sector snapshot plus the key: a moved shop
  // trips the guard (409 with the debits compensated), a same-key recovery
  // converges to `already-applied`.
  const sectorStep: MoneyFlowStep = {
    name: "sector-apply",
    apply: (stepOpts) =>
      applyKeyedUpdate(
        key,
        {
          collection: sectors,
          filter: {
            _id: input.sectorId,
            unionization: input.priorUnionization,
            representingUnionId: input.priorRepresentingUnionId,
          },
          update: {
            $set: {
              unionization: input.nextUnionization,
              representingUnionId: input.nextRepresentingUnionId,
              updatedAt: now,
            },
          },
        },
        stepOpts ?? {}
      ),
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        makeLegStep(key, {
          name: "actions-debit",
          collection: characters,
          docId: input.characterId,
          field: "actions",
          delta: -input.actionCost,
          minBalance: input.actionCost,
          set: { updatedAt: now },
        }),
        // A zero treasury cost moves no balance, so there is no debit to
        // guard, compensate, or collide with (a zero-delta leg is rejected).
        ...(input.treasuryCost > 0
          ? [
              makeLegStep(key, {
                name: "treasury-debit",
                collection: unions,
                docId: input.unionId,
                field: "treasury",
                delta: -input.treasuryCost,
                minBalance: input.treasuryCost,
                set: { updatedAt: now },
              }),
            ]
          : []),
        // A lost raid charges the debits and leaves the sector untouched.
        ...(input.applySector ? [sectorStep] : []),
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
