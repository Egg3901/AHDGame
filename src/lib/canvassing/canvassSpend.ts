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
import type { Campaign, Character, StateDemographicTurnout } from "@/lib/db/types";

export interface CanvassTurnoutWrite {
  /** `_id` of the state demographic turnout document. */
  stateId: string;
  /** Optimistic-concurrency stamp read before the spend. */
  lastUpdated: Date;
  /** Dotted modifier path, e.g. `modifiers.youth.students`. */
  modifierPath: string;
  modifierValue: number;
  campaignModifiers: Record<string, unknown>;
}

export interface CanvassSpendInput {
  characterId: ObjectId;
  /** Balance field holding campaign funds (`funds` pre-forex). */
  campaignFundsField: string;
  totalFundsCostLocal: number;
  totalActionsCost: number;
  /**
   * Ticket campaign whose shared per-day surrogate pool to draw down. When
   * present the draw is the FIRST step inside the flow (guarded by `$gte`),
   * so a depleted pool blocks the canvass with no character debit and a
   * crash can never strand the pool drawn with no canvass behind it.
   */
  surrogateCampaignId?: ObjectId;
  turnout: CanvassTurnoutWrite;
  /**
   * Caller-chosen fingerprint of the intended canvass
   * (e.g. `character:state:path:count`). Must exclude volatile reads like
   * `lastUpdated`: a retry re-reads them, and a fingerprint that moves per
   * attempt would false-conflict on recovery.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same canvass replays the stored outcome instead
   * of charging again. Omit to mint one.
   */
  idempotencyKey?: string;
}

function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical sentinel surface. The surrogate-pool draw is a
  // distinct shortage (429/409 copy in the route) from the character's own
  // funds/actions, and a raced turnout stamp is a refresh-and-retry.
  if (step.name === "surrogate-pool") return new Error("SURROGATE_DEPLETED");
  if (step.name === "character-spend") return new Error("INSUFFICIENT_RESOURCES");
  return new Error(`TURNOUT_CONFLICT:${outcome}`);
}

/**
 * Charge a canvass (optional surrogate-pool draw, character funds+actions)
 * and apply the turnout boost so the result is exactly-once on every
 * topology (issue #1672).
 *
 * Under real transactions the legs, the turnout write, and the idempotency
 * receipt join the transaction and commit atomically, preserving the old
 * behavior. On a standalone deployment the fallback runs the same writes as
 * keyed idempotent steps: a crash between the spend and the turnout write
 * leaves an `in_progress` receipt, and retrying with the same key
 * reconciles to exactly one charged canvass instead of charging for a boost
 * that never landed (or landing it twice). The turnout write is terminal,
 * so it carries no inverse; a failure there compensates the spend prefix.
 */
export async function applyCanvassSpend(
  db: Db,
  input: CanvassSpendInput
): Promise<{ duplicate: boolean }> {
  if (!input.characterId) {
    throw new TypeError("Canvass spend needs characterId");
  }
  if (typeof input.campaignFundsField !== "string" || input.campaignFundsField.length === 0) {
    throw new TypeError("Canvass spend needs a campaign funds field");
  }
  if (!Number.isFinite(input.totalFundsCostLocal) || input.totalFundsCostLocal <= 0) {
    throw new RangeError("Canvass totalFundsCostLocal must be positive");
  }
  if (!Number.isFinite(input.totalActionsCost) || input.totalActionsCost <= 0) {
    throw new RangeError("Canvass totalActionsCost must be positive");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Canvass idempotency key must be 1-128 characters");
  }

  const characters = db.collection<Character>("characters");
  const campaigns = db.collection<Campaign>("campaigns");
  const turnout = db.collection<StateDemographicTurnout>("stateDemographicTurnout");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const now = new Date();

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") return { duplicate: true as boolean };
    await runMoneyFlowSteps(
      receipts,
      key,
      [
        ...(input.surrogateCampaignId
          ? [
              makeLegStep(key, {
                name: "surrogate-pool",
                collection: campaigns,
                docId: input.surrogateCampaignId,
                field: "runningMateSurrogateActionsRemaining",
                delta: -input.totalActionsCost,
                minBalance: input.totalActionsCost,
                set: { updatedAt: now },
              }),
            ]
          : []),
        makeLegStep(key, {
          name: "character-spend",
          collection: characters,
          docId: input.characterId,
          field: input.campaignFundsField,
          delta: -input.totalFundsCostLocal,
          minBalance: input.totalFundsCostLocal,
          extraIncs: { actions: -input.totalActionsCost },
          extraFilter: { actions: { $gte: input.totalActionsCost } },
        }),
        {
          name: "turnout-boost",
          apply: (stepOpts) =>
            applyKeyedUpdate(
              key,
              {
                collection: turnout,
                filter: { _id: input.turnout.stateId, lastUpdated: input.turnout.lastUpdated },
                update: {
                  $set: {
                    [input.turnout.modifierPath]: input.turnout.modifierValue,
                    campaignModifiers: input.turnout.campaignModifiers,
                    lastUpdated: now,
                  },
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
