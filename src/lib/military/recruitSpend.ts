import { randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import type { ClientSession, Collection, Db, Filter } from "mongodb";
import { getMoneyFlowReceiptsCollection } from "@/lib/db/collections/moneyFlowReceipts";
import { getDefenseAppropriation } from "@/lib/db/collections/defenseAppropriation";
import { getNationalArsenal } from "@/lib/db/collections/nationalArsenal";
import {
  applyIdempotentLeg,
  claimMoneyFlowReceipt,
  deriveMoneyFlowKey,
  failMoneyFlowReceipt,
  keyedInsertId,
  makeInsertStep,
  makeLegStep,
  runMoneyFlowSteps,
  type MoneyFlowAccount,
  type MoneyFlowLegOutcome,
  type MoneyFlowOptions,
  type MoneyFlowReceipt,
  type MoneyFlowStep,
  type MoneyFlowStepRef,
} from "@/lib/db/nonAtomicMoneyFlow";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import type { CountryId } from "@/lib/constants/countries";
import type { MilitaryUnit, UnitDomain } from "@/lib/db/types/militaryUnit";
import { equipUnit } from "@/lib/military/arsenal";
import { manpowerCeilingFor } from "@/lib/military/manpowerPool";

/** Ministerial-action debit lost its race (or the member row went): retryable 409. */
export const MILITARY_RECRUIT_ACTION = "MILITARY_RECRUIT_ACTION";
/** Manpower draw lost its race: retryable 409. */
export const MILITARY_RECRUIT_MANPOWER = "MILITARY_RECRUIT_MANPOWER";
/** Defence appropriation cannot cover the price: 409 with the live shortfall. */
export const MILITARY_RECRUIT_APPROPRIATION = "MILITARY_RECRUIT_APPROPRIATION";
/** Unit insert failed after the prefix applied: prefix compensated, 500. */
export const MILITARY_RECRUIT_UNIT = "MILITARY_RECRUIT_UNIT";

/** Domain for the deterministic unit `_id` derived from the flow key. */
const UNIT_INSERT_DOMAIN = "military-recruit";

export interface MilitaryRecruitUnitInput {
  branchId: string;
  /** Caller-trimmed display name. */
  name: string;
  type: string;
  icon: string;
  basePower: number;
  upkeepBase: number;
}

export interface MilitaryRecruitSpendInput {
  countryId: CountryId;
  /** Cabinet-members row debited for the ministerial action. */
  memberId: ObjectId;
  /** Pre-debit action count, for stable reporting. */
  actionsBefore: number;
  /** National-manpower row drawn from. */
  manpowerDocId: ObjectId;
  /** Pre-draw pool, for stable reporting. */
  poolBefore: number;
  /** Men drawn (the archetype's full establishment). */
  personnel: number;
  /** Federal-budget `_id` carrying the defence appropriation. */
  budgetId: string;
  /** Rounded appropriation debit, in the appropriation's own units. */
  price: number;
  domain: UnitDomain;
  /**
   * National-arsenal row drawn from. Null when no document exists: the
   * historical `drawLots` draws nothing from a missing store, so the unit is
   * raised hollow by construction and no arsenal write ever runs.
   */
  arsenalDocId: ObjectId | null;
  /** Lots the archetype needs for a full load. */
  neededLots: number;
  /** `min(needed, floor(stock))` at plan time; 0 when no arsenal doc exists. */
  plannedDrawn: number;
  /** `grade[domain]` at plan time; the issue tier derives from it. */
  arsenalGrade: number;
  unit: MilitaryRecruitUnitInput;
  createdTurn: number;
  readyAtTurn: number;
  /**
   * Caller-chosen fingerprint of the intended recruit
   * (see `buildMilitaryRecruitFingerprint`). Amounts in it (personnel,
   * price) are retry-stable: the flow never rewrites gdp or establishment,
   * and the data-dependent draw outcome lives in the stored plan, not the
   * fingerprint. A retry with the same key and fingerprint reconciles the
   * stored plan; a different fingerprint is a different recruit and stays a
   * `MoneyFlowKeyConflictError`.
   */
  fingerprint: string;
  /**
   * Caller-supplied idempotency key (e.g. `Idempotency-Key` header echoed by
   * the route). Same key + same recruit replays the stored outcome instead of
   * raising a second unit. Omit to mint one: the attempt is still crash-safe
   * within itself, but a client retry mints a new key and is treated as a new
   * recruit (still guarded by the atomic debits).
   */
  idempotencyKey?: string;
}

/**
 * Deterministic fingerprint for a recruit attempt. Covers the operation
 * identity (country, minister, branch, type, name, turn) plus the
 * retry-stable amounts, so a key reused for a different recruit fails closed
 * instead of replaying the wrong outcome.
 */
export function buildMilitaryRecruitFingerprint(input: {
  countryId: string;
  memberId: ObjectId;
  branchId: string;
  type: string;
  name: string;
  createdTurn: number;
  personnel: number;
  price: number;
}): string {
  return [
    "military-recruit",
    input.countryId,
    input.memberId.toHexString(),
    input.branchId,
    input.type,
    input.name,
    `turn:${input.createdTurn}`,
    `men:${input.personnel}`,
    `price:${input.price}`,
  ].join(":");
}

/** Stored response numbers, written post-commit so a replay reports stably. */
export interface MilitaryRecruitOutcome {
  price: number;
  actionsRemaining: number;
  manpowerRemaining: number;
  appropriationRemaining: number;
  unitIdHex: string;
}

/**
 * Crash-resume plan persisted on the flow receipt right after the fresh
 * claim, before any resource moves. A same-key retry after a crash rebuilds
 * its steps from THIS plan, never from the caller's live input: the route
 * rebuilds every call from live state, so post-crash input is computed from
 * post-debit reads (a drained pool, a spent action, a drawn arsenal) and
 * running it would double-spend or report the wrong outcome. Resuming the
 * stored plan keeps the action debit, the manpower draw, the appropriation
 * debit, the arsenal draw, the issue tier, and every compensation inverse at
 * exactly the attempted amounts.
 *
 * The degraded arsenal path is pinned here too: `plannedDrawn` (from the
 * pre-claim stock read) and the resolved `drawnLots` are plan data, so a
 * retry cannot recalculate a different fill from post-draw stock, and the
 * unit's tier/equipment always derive from the lots that actually left the
 * store on the first attempt.
 */
export interface MilitaryRecruitStoredPlan {
  version: 1;
  countryId: string;
  memberIdHex: string;
  actionsBefore: number;
  manpowerDocIdHex: string;
  poolBefore: number;
  personnel: number;
  budgetId: string;
  price: number;
  domain: UnitDomain;
  arsenalDocIdHex: string | null;
  neededLots: number;
  plannedDrawn: number;
  drawnLots: number | null;
  arsenalGrade: number;
  unit: MilitaryRecruitUnitInput;
  createdTurn: number;
  readyAtTurn: number;
  outcome?: MilitaryRecruitOutcome;
}

function toStoredPlan(input: MilitaryRecruitSpendInput): MilitaryRecruitStoredPlan {
  return {
    version: 1,
    countryId: input.countryId,
    memberIdHex: input.memberId.toHexString(),
    actionsBefore: input.actionsBefore,
    manpowerDocIdHex: input.manpowerDocId.toHexString(),
    poolBefore: input.poolBefore,
    personnel: input.personnel,
    budgetId: input.budgetId,
    price: input.price,
    domain: input.domain,
    arsenalDocIdHex: input.arsenalDocId ? input.arsenalDocId.toHexString() : null,
    neededLots: input.neededLots,
    plannedDrawn: input.plannedDrawn,
    drawnLots: null,
    arsenalGrade: input.arsenalGrade,
    unit: { ...input.unit },
    createdTurn: input.createdTurn,
    readyAtTurn: input.readyAtTurn,
  };
}

function isStoredPlan(value: unknown): value is MilitaryRecruitStoredPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Record<string, unknown>;
  return (
    plan.version === 1 &&
    typeof plan.countryId === "string" &&
    typeof plan.memberIdHex === "string" &&
    typeof plan.manpowerDocIdHex === "string" &&
    typeof plan.budgetId === "string" &&
    typeof plan.domain === "string" &&
    Array.isArray((plan as { unit?: unknown }).unit) === false &&
    typeof plan.unit === "object"
  );
}

/** Receipt rows carry the resume plan under this field (never in the shared type). */
type MilitaryRecruitReceipt = MoneyFlowReceipt & { militaryRecruitPlan?: unknown };

interface NormalizedRecruitPlan {
  countryId: CountryId;
  memberId: ObjectId;
  actionsBefore: number;
  manpowerDocId: ObjectId;
  poolBefore: number;
  personnel: number;
  budgetId: string;
  price: number;
  domain: UnitDomain;
  arsenalDocId: ObjectId | null;
  neededLots: number;
  plannedDrawn: number;
  drawnLots: number | null;
  arsenalGrade: number;
  unit: MilitaryRecruitUnitInput;
  createdTurn: number;
  readyAtTurn: number;
  outcome?: MilitaryRecruitOutcome;
}

function planFromInput(live: MilitaryRecruitSpendInput): NormalizedRecruitPlan {
  return {
    countryId: live.countryId,
    memberId: live.memberId,
    actionsBefore: live.actionsBefore,
    manpowerDocId: live.manpowerDocId,
    poolBefore: live.poolBefore,
    personnel: live.personnel,
    budgetId: live.budgetId,
    price: live.price,
    domain: live.domain,
    arsenalDocId: live.arsenalDocId,
    neededLots: live.neededLots,
    plannedDrawn: live.plannedDrawn,
    drawnLots: null,
    arsenalGrade: live.arsenalGrade,
    unit: { ...live.unit },
    createdTurn: live.createdTurn,
    readyAtTurn: live.readyAtTurn,
  };
}

function planFromStored(stored: MilitaryRecruitStoredPlan): NormalizedRecruitPlan {
  return {
    countryId: stored.countryId as CountryId,
    memberId: new ObjectId(stored.memberIdHex),
    actionsBefore: stored.actionsBefore,
    manpowerDocId: new ObjectId(stored.manpowerDocIdHex),
    poolBefore: stored.poolBefore,
    personnel: stored.personnel,
    budgetId: stored.budgetId,
    price: stored.price,
    domain: stored.domain,
    arsenalDocId: stored.arsenalDocIdHex ? new ObjectId(stored.arsenalDocIdHex) : null,
    neededLots: stored.neededLots,
    plannedDrawn: stored.plannedDrawn,
    drawnLots: stored.drawnLots,
    arsenalGrade: stored.arsenalGrade,
    unit: { ...stored.unit },
    createdTurn: stored.createdTurn,
    readyAtTurn: stored.readyAtTurn,
    outcome: stored.outcome ? { ...stored.outcome } : undefined,
  };
}

function mapRecruitError(stepName: string, outcome: MoneyFlowLegOutcome): Error {
  // Preserve the historical surface: a lost action race is the 409
  // no-actions refusal, a lost manpower race the 409 try-again refusal, a
  // short appropriation the 409 shortfall refusal. Anything after resources
  // moved compensates its own prefix; the terminal insert failure is the 500
  // the old unwind-and-throw produced.
  if (stepName === "action-debit") return new Error(`${MILITARY_RECRUIT_ACTION}:${outcome}`);
  if (stepName === "manpower-draw") return new Error(`${MILITARY_RECRUIT_MANPOWER}:${outcome}`);
  if (stepName === "appropriation-debit")
    return new Error(`${MILITARY_RECRUIT_APPROPRIATION}:${outcome}`);
  return new Error(`${MILITARY_RECRUIT_UNIT}:${outcome}`);
}

/** A step that does nothing: for zero-amount debits the historical helpers are no-ops. */
function noopStep(name: string): MoneyFlowStep {
  return {
    name,
    apply: async () => "applied" as MoneyFlowLegOutcome,
    revert: async () => "applied" as MoneyFlowLegOutcome,
  };
}

interface ManpowerDoc {
  _id: ObjectId;
  pool: number;
  appliedMoneyFlowKeys?: string[];
}

/**
 * Exactly-once clamped manpower refund (the revert for `manpower-draw`).
 * Mirrors `returnManpower`: the refund never pushes the pool above its live
 * ceiling, and a pool already at or above the ceiling converges to a no-op.
 * The compensation key is amount-independent, so at most one refund leg ever
 * applies per flow: a crash between the live read and the leg recomputes on
 * retry (nothing applied yet, still safe), and a crash after the leg sees
 * `already-applied` and stops. A concurrent credit that trips the guarded
 * first attempt falls back to one recomputed unguarded attempt under the same
 * key — still exactly once, still clamped at recompute time.
 */
async function refundManpowerClamped(
  db: Db,
  countryId: string,
  manpowerDocId: ObjectId,
  compKey: string,
  personnel: number,
  options: MoneyFlowOptions
): Promise<MoneyFlowLegOutcome> {
  const col = db.collection<ManpowerDoc>("nationalManpower");
  const live = await col.findOne(
    { _id: manpowerDocId },
    {
      projection: { pool: 1, appliedMoneyFlowKeys: 1 },
      ...(options.session ? { session: options.session } : {}),
    }
  );
  if (!live) return "missing";
  if (live.appliedMoneyFlowKeys?.includes(compKey)) return "already-applied";
  const ceiling = await manpowerCeilingFor(db, countryId);
  const refund = Math.min(personnel, Math.max(0, ceiling - live.pool));
  if (!(refund > 0)) return "applied";
  const leg = {
    name: "manpower-draw",
    collection: col as unknown as Collection<MoneyFlowAccount>,
    docId: manpowerDocId,
    field: "pool",
    delta: refund,
  };
  const guarded = await applyIdempotentLeg(
    compKey,
    {
      ...leg,
      extraFilter: { pool: { $lte: ceiling - refund } } as Filter<MoneyFlowAccount>,
    },
    options
  );
  if (guarded === "applied" || guarded === "already-applied") return guarded;
  if (guarded === "missing") return guarded;
  // A concurrent credit landed between the read and the leg: recompute once
  // against the new pool, then apply unguarded under the same key.
  const reread = await col.findOne(
    { _id: manpowerDocId },
    {
      projection: { pool: 1, appliedMoneyFlowKeys: 1 },
      ...(options.session ? { session: options.session } : {}),
    }
  );
  if (!reread) return "missing";
  if (reread.appliedMoneyFlowKeys?.includes(compKey)) return "already-applied";
  const ceilingNow = await manpowerCeilingFor(db, countryId);
  const refundNow = Math.min(personnel, Math.max(0, ceilingNow - reread.pool));
  if (!(refundNow > 0)) return "applied";
  return applyIdempotentLeg(compKey, { ...leg, delta: refundNow }, options);
}

function buildRecruitSteps(
  db: Db,
  receipts: Collection<MilitaryRecruitReceipt>,
  key: string,
  plan: NormalizedRecruitPlan
): MoneyFlowStep[] {
  const members = db.collection<MoneyFlowAccount>("cabinetMembers");
  const manpower = db.collection<MoneyFlowAccount>("nationalManpower");
  const budgets = db.collection<MoneyFlowAccount>("federalBudget");
  const arsenals = db.collection<MoneyFlowAccount>("nationalArsenal");
  const units = db.collection<MilitaryUnit>("militaryUnits");

  const actionKey = deriveMoneyFlowKey(key, "action-debit");
  const actionStep = makeLegStep(actionKey, {
    name: "action-debit",
    collection: members,
    docId: plan.memberId,
    field: "ministerialActions",
    delta: -1,
    minBalance: 1,
  });

  const manpowerKey = deriveMoneyFlowKey(key, "manpower-draw");
  const manpowerStep: MoneyFlowStep =
    plan.personnel > 0
      ? {
          name: "manpower-draw",
          apply: (stepOpts) =>
            applyIdempotentLeg(
              manpowerKey,
              {
                name: "manpower-draw",
                collection: manpower,
                docId: plan.manpowerDocId,
                field: "pool",
                delta: -plan.personnel,
                minBalance: plan.personnel,
              },
              stepOpts ?? {}
            ),
          revert: (stepOpts) =>
            refundManpowerClamped(
              db,
              plan.countryId,
              plan.manpowerDocId,
              deriveMoneyFlowKey(manpowerKey, "compensate", "manpower-draw"),
              plan.personnel,
              stepOpts ?? {}
            ),
        }
      : noopStep("manpower-draw");

  // The historical guard spends UNCOMMITTED appropriation (balance net of
  // procurement encumbrance), not the raw balance: a recruit must not spend
  // money an open contract relies on. The `$expr` rides the leg's filter, so
  // the check and the debit stay one atomic step. Compensation drops it, like
  // every revert: a refund is never guard-blocked.
  const appropriationKey = deriveMoneyFlowKey(key, "appropriation-debit");
  const appropriationStep: MoneyFlowStep =
    plan.price > 0
      ? makeLegStep(appropriationKey, {
          name: "appropriation-debit",
          collection: budgets,
          docId: plan.budgetId,
          field: "defenseAppropriation.balance",
          delta: -plan.price,
          extraFilter: {
            $expr: {
              $gte: [
                {
                  $subtract: [
                    { $ifNull: ["$defenseAppropriation.balance", 0] },
                    { $ifNull: ["$defenseAppropriation.encumbered", 0] },
                  ],
                },
                plan.price,
              ],
            },
          } as unknown as Filter<MoneyFlowAccount>,
        })
      : noopStep("appropriation-debit");

  // The degraded arsenal path as a durable checkpoint. `drawLots` draws the
  // full need when guarded, else whatever the store holds, else nothing — and
  // the unit is raised either way. The plan pins the attempted amount up
  // front; the resolved draw is written back to the receipt the moment its
  // leg applies, so a retry never recalculates from post-draw stock:
  // same-key legs converge to `already-applied` and the stored `drawnLots`
  // wins. A guard-rejected planned draw reads the live remainder once and
  // draws exactly that (a second rejection means the store drained to zero
  // mid-flight, which the historical partial path also reports as zero).
  const arsenalKey = deriveMoneyFlowKey(key, "arsenal-draw");
  const persistDrawn = async (drawn: number, options: MoneyFlowOptions): Promise<void> => {
    // `plan` is per-run mutable state: keeping the resolved draw on it means
    // the post-commit outcome write below persists the resolved value instead
    // of wiping it back to null.
    plan.drawnLots = drawn;
    await receipts.updateOne(
      { _id: key },
      {
        $set: {
          "militaryRecruitPlan.drawnLots": drawn,
          updatedAt: new Date(),
        },
      },
      options.session ? { session: options.session } : {}
    );
  };
  const readStoredDrawn = async (options: MoneyFlowOptions): Promise<number | null> => {
    const receipt = await receipts.findOne(
      { _id: key },
      options.session ? { session: options.session } : {}
    );
    const stored = (receipt as MilitaryRecruitReceipt | null)?.militaryRecruitPlan;
    return isStoredPlan(stored) && typeof stored.drawnLots === "number" ? stored.drawnLots : null;
  };
  const arsenalStep: MoneyFlowStep = {
    name: "arsenal-draw",
    apply: async (stepOpts) => {
      const opts = stepOpts ?? {};
      const stored = await readStoredDrawn(opts);
      // A resolved draw always wins over a recompute: post-draw stock is
      // smaller, so recalculating would draw the remainder a second time.
      if (stored != null) plan.drawnLots = stored;
      const target = plan.drawnLots ?? plan.plannedDrawn;
      const docId = plan.arsenalDocId;
      if (docId == null || !(target > 0)) {
        await persistDrawn(0, opts);
        return "applied";
      }
      const field = `stock.${plan.domain}`;
      const outcome = await applyIdempotentLeg(
        arsenalKey,
        {
          name: "arsenal-draw",
          collection: arsenals,
          docId,
          field,
          delta: -target,
          minBalance: target,
          set: { updatedAt: new Date() },
        },
        opts
      );
      if (outcome === "applied") {
        await persistDrawn(target, opts);
        return outcome;
      }
      if (outcome === "already-applied") {
        // A concurrent same-key attempt resolved first: prefer its stored
        // value over this attempt's recompute.
        const winner = await readStoredDrawn(opts);
        plan.drawnLots = winner ?? target;
        return outcome;
      }
      if (outcome === "missing") {
        // The arsenal row vanished mid-flight: hollow, like a missing store.
        await persistDrawn(0, opts);
        return "applied";
      }
      // Guard-rejected: another order drew first. Read the live remainder
      // once and draw exactly that, mirroring `drawLots`' partial path.
      const live = await getNationalArsenal(db, plan.countryId);
      const remainder = Math.max(0, Math.min(target, Math.floor(live.stock[plan.domain] ?? 0)));
      const liveDoc = await arsenals.findOne(
        { countryId: plan.countryId } as Filter<MoneyFlowAccount>,
        { projection: { _id: 1 }, ...(opts.session ? { session: opts.session } : {}) }
      );
      if (liveDoc == null || !(remainder > 0)) {
        await persistDrawn(0, opts);
        return "applied";
      }
      const second = await applyIdempotentLeg(
        arsenalKey,
        {
          name: "arsenal-draw",
          collection: arsenals,
          docId: liveDoc._id,
          field,
          delta: -remainder,
          minBalance: remainder,
          set: { updatedAt: new Date() },
        },
        opts
      );
      if (second === "applied") {
        await persistDrawn(remainder, opts);
        return second;
      }
      if (second === "already-applied") {
        const winner = await readStoredDrawn(opts);
        plan.drawnLots = winner ?? remainder;
        return second;
      }
      // The store drained to zero between the remainder read and the leg —
      // the historical partial path reports zero here too.
      await persistDrawn(0, opts);
      return "applied";
    },
    revert: (stepOpts) => {
      const drawn = plan.drawnLots;
      if (drawn == null || !(drawn > 0) || plan.arsenalDocId == null) {
        return Promise.resolve("applied" as MoneyFlowLegOutcome);
      }
      return applyIdempotentLeg(
        deriveMoneyFlowKey(arsenalKey, "compensate", "arsenal-draw"),
        {
          name: "arsenal-draw",
          collection: arsenals,
          docId: plan.arsenalDocId,
          field: `stock.${plan.domain}`,
          delta: drawn,
          set: { updatedAt: new Date() },
        },
        stepOpts ?? {}
      );
    },
  };

  // Terminal: nothing runs after it, so it carries no inverse. A survived
  // insert error compensates the prefix instead of stranding it (the
  // historical unwind-and-throw). The `_id` derives from the flow key, so a
  // crash between the insert and the receipt completion converges instead of
  // raising a second unit.
  const unitId = keyedInsertId(key, UNIT_INSERT_DOMAIN);
  const issuedFrom = (drawn: number): ReturnType<typeof equipUnit> =>
    equipUnit(drawn, plan.neededLots, plan.arsenalGrade);
  const unitStep: MoneyFlowStep = {
    name: "unit-insert",
    apply: async (stepOpts) => {
      const stored = await readStoredDrawn(stepOpts ?? {});
      if (stored != null) plan.drawnLots = stored;
      const drawn = plan.drawnLots ?? plan.plannedDrawn;
      plan.drawnLots = drawn;
      const issued = issuedFrom(drawn);
      return makeInsertStep("unit-insert", units, {
        _id: unitId,
        countryId: plan.countryId,
        branchId: plan.unit.branchId,
        domain: plan.domain,
        name: plan.unit.name,
        type: plan.unit.type,
        icon: plan.unit.icon,
        posture: "standard",
        techTier: issued.techTier,
        personnel: plan.personnel,
        readiness: 70,
        basePower: plan.unit.basePower,
        upkeepBase: plan.unit.upkeepBase,
        vet: 1,
        xp: 0,
        equipment: issued.equipment,
        drill: null,
        theaterId: "reserve",
        assignedGeneralId: null,
        createdTurn: plan.createdTurn,
        readyAtTurn: plan.readyAtTurn,
      } satisfies MilitaryUnit).apply(stepOpts);
    },
  };

  return [actionStep, manpowerStep, appropriationStep, arsenalStep, unitStep];
}

/**
 * Raise one military unit (ministerial action + manpower + defence
 * appropriation + arsenal lots + unit row) so the result is exactly-once on
 * every topology (issue #1672).
 *
 * Step order mirrors the historical write order, and a later-step failure
 * compensates its own prefix (action refunded, manpower refunded under its
 * ceiling clamp, appropriation credited, lots returned) instead of leaving
 * a strand where the country paid but no unit exists, or a unit exists but
 * was free.
 *
 * Fan-out keying: every step carries its own idempotent sub-operation key
 * derived from the flow key via `deriveMoneyFlowKey` (`action-debit`,
 * `manpower-draw`, `appropriation-debit`, `arsenal-draw` suffixes), so a
 * crash between any two writes resumes per step: applied steps report
 * `already-applied` and are skipped while the rest still land.
 *
 * Under real transactions the debits, the arsenal draw, the unit insert, and
 * the idempotency receipt join the transaction and commit atomically,
 * preserving the old behavior. On a standalone deployment the fallback runs
 * the same writes as keyed idempotent steps: a crash between them leaves an
 * `in_progress` receipt, and retrying with the same key and fingerprint
 * reconciles to exactly one raised unit. A retry after a terminal failure
 * throws `MoneyFlowTerminalError` (fail closed); a new attempt needs a new
 * key.
 */
export async function applyMilitaryRecruitSpend(
  db: Db,
  input: MilitaryRecruitSpendInput
): Promise<{ duplicate: boolean; outcome: MilitaryRecruitOutcome }> {
  if (!input.memberId) {
    throw new TypeError("Military recruit spend needs memberId");
  }
  if (!input.manpowerDocId) {
    throw new TypeError("Military recruit spend needs manpowerDocId");
  }
  if (typeof input.budgetId !== "string" || input.budgetId.length === 0) {
    throw new TypeError("Military recruit spend needs budgetId");
  }
  if (!Number.isFinite(input.personnel) || input.personnel < 0) {
    throw new RangeError("Military recruit personnel must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new RangeError("Military recruit price must be a finite non-negative amount");
  }
  if (!Number.isFinite(input.neededLots) || input.neededLots <= 0) {
    throw new RangeError("Military recruit neededLots must be positive");
  }
  if (!Number.isFinite(input.plannedDrawn) || input.plannedDrawn < 0) {
    throw new RangeError("Military recruit plannedDrawn must be a finite non-negative amount");
  }
  if (typeof input.unit?.name !== "string" || input.unit.name.length === 0) {
    throw new TypeError("Military recruit spend needs a unit name");
  }
  const key = input.idempotencyKey !== undefined ? input.idempotencyKey : randomUUID();
  if (key.length === 0 || key.length > 128) {
    throw new RangeError("Military recruit idempotency key must be 1-128 characters");
  }

  const receipts = await getMoneyFlowReceiptsCollection(db);
  const receiptCollection = receipts as unknown as Collection<MilitaryRecruitReceipt>;

  const loadOutcome = async (
    plan: NormalizedRecruitPlan,
    opts: { session?: ClientSession }
  ): Promise<MilitaryRecruitOutcome> => {
    if (plan.outcome) return { ...plan.outcome };
    // A completed receipt always carries the stored outcome; this fallback
    // only runs when the process crashed between settling `completed` and
    // writing the outcome row.
    const { balance } = await getDefenseAppropriation(db, plan.countryId);
    const outcome: MilitaryRecruitOutcome = {
      price: plan.price,
      actionsRemaining: plan.actionsBefore - 1,
      manpowerRemaining: plan.poolBefore - plan.personnel,
      appropriationRemaining: balance,
      unitIdHex: keyedInsertId(key, UNIT_INSERT_DOMAIN).toHexString(),
    };
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          militaryRecruitPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runPlan = async (
    plan: NormalizedRecruitPlan,
    opts: { session?: ClientSession }
  ): Promise<MilitaryRecruitOutcome> => {
    await runMoneyFlowSteps(
      receipts,
      key,
      buildRecruitSteps(db, receiptCollection, key, plan),
      (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => mapRecruitError(step.name, outcome),
      opts
    );
    const { balance } = await getDefenseAppropriation(db, plan.countryId);
    const outcome: MilitaryRecruitOutcome = {
      price: plan.price,
      actionsRemaining: plan.actionsBefore - 1,
      manpowerRemaining: plan.poolBefore - plan.personnel,
      appropriationRemaining: balance,
      unitIdHex: keyedInsertId(key, UNIT_INSERT_DOMAIN).toHexString(),
    };
    await receiptCollection.updateOne(
      { _id: key },
      {
        $set: {
          militaryRecruitPlan: { ...toStoredPlanLike(plan), outcome },
          updatedAt: new Date(),
        },
      },
      opts.session ? { session: opts.session } : {}
    );
    return outcome;
  };

  const runSpend = async (
    session?: ClientSession
  ): Promise<{ duplicate: boolean; outcome: MilitaryRecruitOutcome }> => {
    const opts = session ? { session } : {};
    const claim = await claimMoneyFlowReceipt(receipts, key, input.fingerprint, opts);
    if (claim === "duplicate") {
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.militaryRecruitPlan;
      if (!isStoredPlan(stored)) {
        throw new Error("MONEY_FLOW_RECEIPT_LOST");
      }
      return { duplicate: true, outcome: await loadOutcome(planFromStored(stored), opts) };
    }
    if (claim === "in-progress") {
      // Same fingerprint, so the live input names the same recruit — but the
      // steps run from the STORED plan, never the live input: post-crash
      // reads are post-debit state and would double-spend or misreport.
      const existing = await receiptCollection.findOne({ _id: key }, opts);
      const stored = existing?.militaryRecruitPlan;
      const plan = isStoredPlan(stored) ? planFromStored(stored) : planFromInput(input);
      return { duplicate: true, outcome: await runPlan(plan, opts) };
    }
    // A fresh claim owns the attempt. Persist the resume plan before the
    // first step: a crash from here on resumes this exact plan under the
    // same key.
    try {
      await receiptCollection.updateOne(
        { _id: key },
        { $set: { militaryRecruitPlan: toStoredPlan(input), updatedAt: new Date() } },
        opts
      );
    } catch (planError) {
      await failMoneyFlowReceipt(receipts, key, `${MILITARY_RECRUIT_UNIT}:plan-store`, opts);
      throw planError;
    }

    const outcome = await runPlan(planFromInput(input), opts);
    return { duplicate: false, outcome };
  };

  return runWithOptionalTransaction(
    async (session) => runSpend(session),
    async () => runSpend()
  );
}

/** Rebuild a storable plan snapshot from a normalized plan (for outcome writes). */
function toStoredPlanLike(plan: NormalizedRecruitPlan): MilitaryRecruitStoredPlan {
  return {
    version: 1,
    countryId: plan.countryId,
    memberIdHex: plan.memberId.toHexString(),
    actionsBefore: plan.actionsBefore,
    manpowerDocIdHex: plan.manpowerDocId.toHexString(),
    poolBefore: plan.poolBefore,
    personnel: plan.personnel,
    budgetId: plan.budgetId,
    price: plan.price,
    domain: plan.domain,
    arsenalDocIdHex: plan.arsenalDocId ? plan.arsenalDocId.toHexString() : null,
    neededLots: plan.neededLots,
    plannedDrawn: plan.plannedDrawn,
    drawnLots: plan.drawnLots,
    arsenalGrade: plan.arsenalGrade,
    unit: { ...plan.unit },
    createdTurn: plan.createdTurn,
    readyAtTurn: plan.readyAtTurn,
    ...(plan.outcome ? { outcome: { ...plan.outcome } } : {}),
  };
}
