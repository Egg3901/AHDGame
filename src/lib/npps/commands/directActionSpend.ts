import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db, Filter } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import {
  MAX_APPLIED_MONEY_FLOW_KEYS,
  applyKeyedUpdate,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowLeg,
  type MoneyFlowLegOutcome,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { CURRENCY_SYMBOLS } from "@/lib/constants/currencies";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import {
  NPP_ENDORSEMENT_REEVALUATION_TURNS,
  getEndorsementDecisionPhase,
  getEndorsementTargetId,
  isSelfEndorsementCandidate,
} from "@/lib/nppEndorsements";
import type {
  CapitalActionLog,
  CapitalActionType,
  Character,
  Election,
  ElectionCandidate,
  NPP,
  NPPEndorsement,
  NPPRelationship,
} from "@/lib/db/types";

/** Character debit guard tripped: AP or funds raced below the priced cost. */
export class DirectActionBalanceConflictError extends Error {}

/**
 * Later-step failure after the debit prefix applied. The prefix is
 * compensated before this surfaces, so unlike the historical fallback there
 * is no stranded charge; the route reports it as an unexpected failure.
 */
function mapSpendError(step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical error surface: a rejected character debit (a
  // raced balance) was `DirectActionBalanceConflictError` (409). Any later
  // step failing means the old code rolled back and threw (500); the flow
  // compensates the applied prefix instead and fails with the step name.
  if (step.index === 0) {
    return new DirectActionBalanceConflictError(
      "Action balance changed mid-interaction; reload and try again."
    );
  }
  return new Error(`DIRECT_ACTION_STEP_FAILED:${step.name}:${outcome}`);
}

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 11000;
}

export interface DirectActionFavorUpdate {
  favorability: number;
  politicalInfluence: number;
  updatedAt: Date;
  prior: {
    favorability: number;
    politicalInfluence: number;
    updatedAt: Date;
  };
}

export interface DirectActionEndorsementInput {
  /** Hex candidacy id from the validated action plan. */
  candidacyId: string;
  arrangedByParty?: string;
  now: Date;
  currentTurn: number;
  /**
   * Active endorsement rows for (npp, election) read before the attempt, used
   * to restore the pre-attempt set if the flow compensates. On a crash-
   * recovery retry this snapshot is post-first-attempt state (the rows the
   * retry observed), so a compensate-after-retry restores that instead of the
   * original set; the debit refund (the money invariant) is unaffected. Later
   * steps are near-infallible writes, so this path needs a crash plus a hard
   * failure on an unconditional write to trigger.
   */
  priorActive: NPPEndorsement[];
}

export interface DirectActionSpendInput {
  characterId: ObjectId;
  nppId: ObjectId;
  /** NPP display name for the endorsement row (stable across retries). */
  nppName: string;
  relationshipKey: string;
  action: CapitalActionType;
  /** Action-point cost (anchor price from the action config). */
  actionCost: number;
  /**
   * Priced cash debit in the character's stored home currency (may be
   * fractional under FX). The leg debits this exact value and the response
   * echoes `Math.round` of it, matching the historical write + surface.
   */
  fundCostLocal: number;
  /** Which stored balance the cash leg debits (forex flag dependent). */
  fundsField: "funds" | "currencyBalances.campaign";
  /** Charisma-scaled relationship delta (signed). */
  relationshipDelta: number;
  relationshipBefore: number;
  /** Clamped post-action score (the first attempt's value wins on replay). */
  relationshipAfter: number;
  lastAttemptTurn: number;
  priorRelationship: NPPRelationship | null;
  /** Null when the action moves neither favorability nor influence. */
  favorUpdate: DirectActionFavorUpdate | null;
  /** Null unless the plan creates an endorsement. */
  endorsement: DirectActionEndorsementInput | null;
  log: {
    actionsSpent: number;
    /** Anchor-denominated fund cost, as the historical audit row records. */
    fundsSpentAnchor: number;
    effectSummary: string;
    turn: number;
    context: { candidacyId?: ObjectId };
  };
  now: Date;
  /**
   * Caller-chosen fingerprint of the intended action
   * (see `buildDirectActionFingerprint`). A retry presenting the same key
   * with a different fingerprint is rejected instead of returning the stored
   * outcome for the wrong action. The fingerprint deliberately carries anchor
   * costs (not rate-derived local amounts), so an FX drift between a crash
   * and its same-key retry still reconciles onto the first attempt's exact
   * debited amounts instead of failing closed.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same action replays the stored outcome instead of
   * charging again. Omit to mint one: the attempt is still crash-safe within
   * itself, but a client retry mints a new key and is treated as a new action
   * (still guarded by the atomic debit).
   */
  idempotencyKey?: string;
}

export interface DirectActionSpendOutcome {
  duplicate: boolean;
  success: true;
  effect: string;
  action: CapitalActionType;
  actions: { current: number; spent: number };
  funds: { current: number; spent: number };
  homeCurrency: string;
  currencySymbol: string;
  relationship: { before: number; after: number; delta: number };
}

export function buildDirectActionFingerprint(input: {
  characterId: ObjectId;
  nppId: ObjectId;
  action: string;
  candidacyId?: string;
  actionCost: number;
  fundCostAnchor: number;
  fundsField: string;
}): string {
  return [
    "direct-action",
    input.characterId.toString(),
    input.nppId.toString(),
    input.action,
    input.candidacyId ?? "-",
    `actions:${input.actionCost}`,
    `funds:${input.fundCostAnchor}`,
    `field:${input.fundsField}`,
  ].join(":");
}

/**
 * Player-to-NPP direct action (AP + campaign-funds debit, relationship
 * upsert, conditional endorsement upsert, NPP stat write, audit row) so the
 * result is exactly-once on every topology (issue #1672). Step order mirrors
 * the historical write order; a later-step failure compensates the applied
 * prefix before settling.
 *
 * Under real transactions the debit, the side-effect writes, and the receipt
 * join the transaction and commit atomically, preserving the old behavior. On
 * a standalone deployment the fallback runs the same writes as keyed
 * idempotent steps: a crash between them leaves an `in_progress` receipt, and
 * retrying with the same key reconciles to exactly one charged action. A
 * retry after a terminal failure throws `MoneyFlowTerminalError` (fail
 * closed); a new attempt needs a new key.
 *
 * Reporting always follows the stored docs: after the steps converge, the
 * response is rebuilt from the deterministic audit row (relationship
 * before/after, spends, effect) and the current character row, never from
 * recomputed values, so a retry reports the first attempt's exact result even
 * though its recomputed deltas were derived from post-crash reads.
 *
 * Endorsement convergence: the conditional upsert keeps the historical
 * read-then-write shape (match the active row for the target and refresh it,
 * else insert and withdraw the stale rows), but the insert `_id` is derived
 * from the idempotency key instead of random, so concurrent same-key applies
 * collapse onto one row via E11000 instead of duplicating it. Cross-key races
 * behave like the legacy no-transaction fallback (a second row may land);
 * under real transactions the steps join the caller's transaction and keep
 * the old serialized semantics. The revert removes only this attempt's row
 * and reactivates the snapshot set, so unlike the historical rollback (which
 * deleted every row for the election) it never clobbers a concurrent
 * attempt's endorsement.
 */
export async function applyDirectActionSpend(
  db: Db,
  input: DirectActionSpendInput
): Promise<DirectActionSpendOutcome> {
  if (!input.characterId) throw new TypeError("Direct-action spend needs characterId");
  if (!input.nppId) throw new TypeError("Direct-action spend needs nppId");
  if (typeof input.relationshipKey !== "string" || input.relationshipKey.length === 0) {
    throw new TypeError("Direct-action spend needs relationshipKey");
  }
  if (!Number.isFinite(input.actionCost) || input.actionCost <= 0) {
    throw new RangeError("Direct-action action cost must be positive");
  }
  if (!Number.isFinite(input.fundCostLocal) || input.fundCostLocal < 0) {
    throw new RangeError("Direct-action fund cost must be non-negative");
  }
  if (input.fundsField !== "funds" && input.fundsField !== "currencyBalances.campaign") {
    throw new TypeError("Direct-action spend needs a known funds field");
  }
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new TypeError("Direct-action spend needs now");
  }
  if (typeof input.fingerprint !== "string" || input.fingerprint.length === 0) {
    throw new TypeError("Direct-action spend needs a non-empty fingerprint");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Direct-action idempotency key must be 1-128 characters");
  }

  const characters = db.collection<Character>("characters");
  const relationships = db.collection<NPPRelationship>("nppRelationships");
  const endorsements = db.collection<NPPEndorsement>("nppEndorsements");
  const npps = db.collection<NPP>("npps");
  const candidates = db.collection<ElectionCandidate>("electionCandidates");
  const elections = db.collection<Election>("elections");
  const logs = db.collection<CapitalActionLog>("capitalActionLogs");
  const receipts = await getMoneyFlowReceiptsCollection(db);
  const logId = keyedInsertId(key, "capital-action-log");
  const endorsementId = keyedInsertId(key, "npp-endorsement");

  // Zero-cash actions (endorsement asks, private meetings) still assert the
  // cash guard exactly like the historical filter (`[field]: { $gte: 0 }`),
  // so a character missing the balance field fails the same way it used to.
  const debitLeg: MoneyFlowLeg<Character> =
    input.fundCostLocal !== 0
      ? {
          name: "character-debit",
          collection: characters,
          docId: input.characterId,
          field: input.fundsField,
          delta: -input.fundCostLocal,
          minBalance: input.fundCostLocal,
          extraIncs: { actions: -input.actionCost },
          extraFilter: { actions: { $gte: input.actionCost } } as Filter<Character>,
        }
      : {
          name: "character-debit",
          collection: characters,
          docId: input.characterId,
          field: "actions",
          delta: -input.actionCost,
          minBalance: input.actionCost,
          extraFilter: { [input.fundsField]: { $gte: 0 } } as Filter<Character>,
        };

  const keyPush = {
    appliedMoneyFlowKeys: {
      $each: [key],
      $slice: -MAX_APPLIED_MONEY_FLOW_KEYS,
    },
  };

  // The relationship upsert carries no throttle or level guard beyond the key:
  // concurrent different-key attempts both land (attempts count each), exactly
  // like the historical sequential writes. A same-key retry whose key is
  // already recorded misses the `$ne: key` filter and converges below instead
  // of bumping the counters twice.
  const relationshipStep: MoneyFlowStep = {
    name: "relationship",
    apply: async (stepOpts) => {
      const session = stepOpts?.session ? { session: stepOpts.session } : {};
      const filter = {
        _id: input.relationshipKey,
        appliedMoneyFlowKeys: { $ne: key },
      } as Filter<NPPRelationship>;
      const update = {
        $set: {
          relationshipScore: input.relationshipAfter,
          lastAttemptTurn: input.lastAttemptTurn,
          updatedAt: input.now,
        },
        $setOnInsert: {
          _id: input.relationshipKey,
          characterId: input.characterId,
          nppId: input.nppId,
          createdAt: input.now,
        },
        $inc: { totalAttempts: 1, successfulAttempts: 1 },
        $push: keyPush,
      } as unknown as Parameters<Collection<NPPRelationship>["updateOne"]>[1];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await relationships.updateOne(filter, update, {
            upsert: true,
            ...session,
          });
          if (result.matchedCount === 1 || result.upsertedCount === 1) return "applied";
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
        }
        // Matched nothing without inserting, or lost an insert race: the key
        // record disambiguates a same-key retry (already applied) from a live
        // cross-key race (the row now exists, so the loop re-attempts the
        // update against it). A concurrently deleted row retries the upsert.
        const existing = await relationships.findOne(
          { _id: input.relationshipKey } as Filter<NPPRelationship>,
          { projection: { appliedMoneyFlowKeys: 1 }, ...session }
        );
        if (!existing) continue;
        const keys = (existing as unknown as { appliedMoneyFlowKeys?: unknown })
          .appliedMoneyFlowKeys;
        if (Array.isArray(keys) && keys.includes(key)) return "already-applied";
      }
      return "guard-rejected";
    },
    revert: async (stepOpts) => {
      const session = stepOpts?.session ? { session: stepOpts.session } : {};
      if (input.priorRelationship) {
        await relationships.replaceOne(
          { _id: input.relationshipKey } as Filter<NPPRelationship>,
          input.priorRelationship,
          session
        );
      } else {
        await relationships.deleteOne(
          { _id: input.relationshipKey } as Filter<NPPRelationship>,
          session
        );
      }
      return "applied";
    },
  };

  const endorsementStep: MoneyFlowStep | null = input.endorsement
    ? {
        name: "endorsement",
        apply: async (stepOpts) => {
          const session = stepOpts?.session ? { session: stepOpts.session } : {};
          const endorsement = input.endorsement!;
          const candidacy = await candidates.findOne(
            {
              _id: new ObjectId(endorsement.candidacyId),
              status: "active",
            } as Filter<ElectionCandidate>,
            session
          );
          if (!candidacy || isSelfEndorsementCandidate({ _id: input.nppId } as NPP, candidacy)) {
            return "applied";
          }
          const [election, candidateCountAtDecision] = await Promise.all([
            elections.findOne({ _id: candidacy.electionId } as Filter<Election>, session),
            candidates.countDocuments(
              { electionId: candidacy.electionId, status: "active" } as Filter<ElectionCandidate>,
              session
            ),
          ]);
          if (!election) return "applied";
          const existing = await endorsements
            .find(
              {
                nppId: input.nppId,
                electionId: candidacy.electionId,
                isActive: true,
              } as Filter<NPPEndorsement>,
              session
            )
            .toArray();
          const targetId = getEndorsementTargetId(candidacy);
          const matching = existing.find((row) => row.candidateId.equals(targetId));
          const setFields = {
            nppName: input.nppName,
            candidateName: candidacy.characterName,
            candidateIsNPP: Boolean(candidacy.isNPP),
            source: "arranged" as const,
            score: undefined as number | undefined,
            candidateCountAtDecision,
            electionPhaseAtDecision: getEndorsementDecisionPhase(
              election,
              endorsement.currentTurn,
              endorsement.now
            ),
            lastEvaluatedTurn: endorsement.currentTurn,
            reevaluateAfterTurn: endorsement.currentTurn + NPP_ENDORSEMENT_REEVALUATION_TURNS,
            arrangedBy: input.characterId,
            ...(endorsement.arrangedByParty
              ? { arrangedByParty: endorsement.arrangedByParty }
              : {}),
          };
          let converged = false;
          if (matching) {
            await endorsements.updateOne(
              { _id: matching._id } as Filter<NPPEndorsement>,
              {
                $set: setFields,
                $unset: { withdrawnAt: "", withdrawnReason: "" },
              },
              session
            );
            converged = true;
          } else {
            try {
              await endorsements.insertOne(
                {
                  _id: endorsementId,
                  nppId: input.nppId,
                  electionId: candidacy.electionId,
                  candidateId: targetId,
                  ...setFields,
                  isActive: true,
                  createdAt: endorsement.now,
                } as NPPEndorsement,
                session
              );
            } catch (error) {
              // Same-key convergence: a concurrent duplicate (or a retried
              // crash that already inserted) holds this deterministic `_id`.
              // The `_id` is unique per key, so E11000 always means this
              // attempt already landed.
              if (!isDuplicateKeyError(error)) throw error;
              converged = true;
            }
          }
          const staleIds = existing
            .filter((row) =>
              matching ? !row._id.equals(matching._id) : !row.candidateId.equals(targetId)
            )
            .map((row) => row._id);
          if (staleIds.length > 0) {
            await endorsements.updateMany(
              { _id: { $in: staleIds }, isActive: true } as Filter<NPPEndorsement>,
              {
                $set: {
                  isActive: false,
                  withdrawnAt: endorsement.now,
                  withdrawnReason: "switched" as const,
                },
              },
              session
            );
          }
          return converged ? "already-applied" : "applied";
        },
        revert: async (stepOpts) => {
          const session = stepOpts?.session ? { session: stepOpts.session } : {};
          await endorsements.deleteOne({ _id: endorsementId } as Filter<NPPEndorsement>, session);
          const restoreIds = (input.endorsement?.priorActive ?? [])
            .map((row) => row._id)
            .filter((id) => !id.equals(endorsementId));
          if (restoreIds.length > 0) {
            await endorsements.updateMany(
              { _id: { $in: restoreIds } } as Filter<NPPEndorsement>,
              { $set: { isActive: true }, $unset: { withdrawnAt: "", withdrawnReason: "" } },
              session
            );
          }
          return "applied";
        },
      }
    : null;

  const favorStep: MoneyFlowStep | null = input.favorUpdate
    ? {
        name: "npp-favor",
        apply: (stepOpts) =>
          applyKeyedUpdate(
            key,
            {
              collection: npps,
              filter: { _id: input.nppId },
              update: {
                $set: {
                  favorability: input.favorUpdate!.favorability,
                  politicalInfluence: input.favorUpdate!.politicalInfluence,
                  updatedAt: input.now,
                },
              },
            },
            stepOpts ?? {}
          ),
        revert: (stepOpts) =>
          applyKeyedUpdate(
            deriveMoneyFlowKey(key, "compensate", "npp-favor"),
            {
              collection: npps,
              filter: { _id: input.nppId },
              update: {
                $set: {
                  favorability: input.favorUpdate!.prior.favorability,
                  politicalInfluence: input.favorUpdate!.prior.politicalInfluence,
                  updatedAt: input.favorUpdate!.prior.updatedAt,
                },
              },
            },
            stepOpts ?? {}
          ),
      }
    : null;

  const steps: MoneyFlowStep[] = [makeLegStep(key, debitLeg), relationshipStep];
  if (endorsementStep) steps.push(endorsementStep);
  if (favorStep) steps.push(favorStep);
  steps.push(
    makeInsertStep("action-log", logs, {
      _id: logId,
      characterId: input.characterId,
      nppId: input.nppId,
      action: input.action,
      actionsSpent: input.log.actionsSpent,
      fundsSpent: input.log.fundsSpentAnchor,
      relationshipBefore: input.relationshipBefore,
      relationshipAfter: input.relationshipAfter,
      effectSummary: input.log.effectSummary,
      context: input.log.context,
      turn: input.log.turn,
      createdAt: input.now,
    })
  );

  const readStoredOutcome = async (
    opts: { session?: ClientSession },
    duplicate: boolean
  ): Promise<DirectActionSpendOutcome> => {
    const stored = await logs.findOne({ _id: logId } as Filter<CapitalActionLog>, opts);
    if (!stored) {
      throw new Error("DIRECT_ACTION_RECEIPT_ORPHAN");
    }
    const character = await characters.findOne({ _id: input.characterId } as Filter<Character>, {
      projection: { actions: 1, funds: 1, currencyBalances: 1, countryId: 1 },
      ...opts,
    });
    if (!character) {
      throw new Error("DIRECT_ACTION_CHARACTER_MISSING");
    }
    const homeCurrency = getHomeCurrency(character);
    return {
      duplicate,
      success: true as const,
      effect: stored.effectSummary,
      action: stored.action,
      actions: { current: character.actions ?? 0, spent: stored.actionsSpent },
      // The stored (home-currency) balance, exactly like the historical
      // after-image read; the spent echo re-rounds the priced local cost.
      // After an FX drift between a crash and its same-key retry this echo
      // may differ by the drift while the debited amount stays exact.
      funds: {
        current: character.currencyBalances?.campaign ?? character.funds ?? 0,
        spent: Math.round(input.fundCostLocal),
      },
      homeCurrency,
      currencySymbol: CURRENCY_SYMBOLS[homeCurrency] ?? "$",
      relationship: {
        before: stored.relationshipBefore,
        after: stored.relationshipAfter,
        delta: input.relationshipDelta,
      },
    };
  };

  const runSpend = async (session?: ClientSession) => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") {
      return readStoredOutcome(opts, true);
    }
    await runMoneyFlowSteps(receipts, key, steps, mapSpendError, opts);
    return readStoredOutcome(opts, claim === "in-progress");
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}
