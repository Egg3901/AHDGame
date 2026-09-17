import { createHash } from "node:crypto";
import { ObjectId, type ClientSession, type Collection, type Filter } from "mongodb";

/**
 * Partial-write safety for money flows on deployments without transaction
 * support (issue #1672).
 *
 * INVARIANTS (read before adding a call site):
 *
 * 1. Every balance mutation MUST go through `applyIdempotentLeg`. The
 *    idempotency key is recorded on the account document in the SAME atomic
 *    single-document write as the balance change (`$inc` + `$push` with a
 *    `$ne: key` filter), so a crashed-and-retried leg applies at most once
 *    no matter how many times it is re-run. A leg applied any other way
 *    cannot be reconciled safely.
 * 2. Legs always run in order and never skip: leg N runs only after every
 *    earlier leg reported `applied` or `already-applied`. If a leg fails
 *    after earlier legs applied, the applied prefix is reversed with
 *    compensation legs (also keyed, so crash-safe) before the receipt
 *    settles. A flow therefore ends `completed` (every leg applied exactly
 *    once) or terminal without effect (`failed` when nothing applied,
 *    `compensated` when the prefix was reversed). Never a partial state.
 * 3. First attempt and crash recovery are the SAME operation
 *    (`runMoneyFlowLegs`): re-running legs after a crash converges instead
 *    of double-applying, because of invariant 1.
 * 4. One key = one attempt. A key that settled `failed`/`compensated` stays
 *    terminal; a retry with the same key throws `MoneyFlowTerminalError`
 *    (fail closed) and a new attempt needs a new key. A key reused with a
 *    different fingerprint throws `MoneyFlowKeyConflictError`.
 * 5. Under real transactions this module is behavior-preserving: legs and
 *    receipt writes accept the caller's session and join the transaction,
 *    so commit/abort keeps the old atomicity. The key guard is harmless
 *    there (a re-invoked transaction callback re-applies cleanly).
 *
 * COVERAGE (issue #1672): migrated call sites express their balance writes
 * as legs (same-collection via `runMoneyFlowLegs`, cross-collection via
 * per-leg `makeLegStep` + `runMoneyFlowSteps`) and their guarded `$set` /
 * deterministic-insert side effects as revertible steps (`applyKeyedUpdate`,
 * `insertKeyedDoc` via `makeInsertStep`, deterministic `_id` via
 * `keyedInsertId`). Migrated: character transfers, donations, election
 * travel/primary/surge, state-attack, canvassing, nominate, player ads,
 * treasury transfer (budget leg + reserve-credit/history/mutex-release step,
 * key-adopted mutex claim), national + state NPP recruitment (shared
 * recruit-spend primitive: AP/treasury leg with cooldown guard, prior-
 * restoring inverse, deterministic NPP insert), campaign donations
 * (party-treasury + character campaign-funds paths via the shared
 * campaignDonationSpend primitive), targeted ads (candidate inventory) and
 * cross-character standing ads (shared adSpend primitive; self-purchase stays
 * a single atomic update), union busting (guarded sector-claim + corp-debit
 * via unionBustingSpend), union bargaining escalation (campaign claim +
 * treasury leg + per-local strike steps via bargainingEscalationSpend),
 * campaign strength purchases (character debit + campaign credit +
 * deterministic audit insert via campaignStrengthSpend, with command-level
 * success/race/missing/activity/key-path tests), rallies (campaign-actions
 * debit + throttled candidate write via rallySpend, with command-level
 * atomic/tamper/throttle/key-path tests), union treasury funding (character
 * campaign-funds debit + treasury credit via unionTreasuryFundingSpend),
 * union organizing drives (actions + treasury debits + snapshot-guarded
 * sector transition via organizeSectorSpend), union founding (combined
 * actions/funds debit + deterministic union insert + guarded leadership
 * claim via unionFoundingSpend, with command-level replay/conflict/settled
 * key tests), forex request surfaces (limit-order create, peer fill,
 * cancel, direct create/accept/decline via the forexSpend primitives, web
 * + v1 market-maker exchange via executeMarketMakerTrade, all with
 * Idempotency-Key validation/forwarding and route-level replay/invalid/
 * conflict tests; merged per-bank spread steps via
 * makeSpreadDistributionStepsForFees), bond sales (positional holder claim
 * + gated pool debit + character/imperial/corporation payout via the
 * bondSellSpend primitive, with Idempotency-Key validation/forwarding and
 * route-level compensation/replay/invalid-key tests; zero-unit holder
 * cleanup stays post-commit best effort), bond buybacks (guarded corp debit
 * + float retire + gated pool credit via the bondBuybackSpend primitive,
 * with Idempotency-Key validation/forwarding and route-level
 * compensation/replay/conflict tests; full-retirement flags stay post-commit
 * best effort), index-fund bond purchases (guarded fund debit + keyed holder
 * reserve + pool credit + deterministic tx row via purchaseBondUnitsForFund)
 * and index-fund liquidity sales (per-bond release-first sub-flows — holder
 * release, gated pool debit, fund credit, deterministic tx row — via
 * sellFundBondHoldingsForCash, keyed per bond/units/proceeds; pool-depth and
 * position races skip the bond, later failures compensate and abort), bond
 * purchases (guarded buyer debit + keyed holder reserve + pool credit via
 * the bondBuySpend primitive for character/imperial/corporation/NPP buyers,
 * with Idempotency-Key validation/forwarding and route-level
 * compensation/replay/invalid-key/conflict tests; corp FX spread routing
 * runs inside the flow; the financial-tx audit row stays post-commit best
 * effort), bond payoffs (parent payoff of a subsidiary's bonds + cash cure
 * of an issuer's own defaulted bonds via the shared bondPayoffSpend
 * primitive: guarded payer debit with liquid/escrow split, one resumable
 * credit per character/imperial/corp/fund/NPP holder, per-bond maturity
 * claims, with Idempotency-Key validation/forwarding and route-level
 * replay/minted-key/invalid-key/conflict/terminal/partial- and
 * empty-remainder-recovery/payer-issuer-mismatch tests; the resume plan is
 * persisted on the receipt at claim time, so a same-key retry after partial
 * maturity reconciles the stored plan instead of conflicting, and an
 * empty-remainder retry reports the stored outcome; the financial-tx
 * maturity rows stay post-commit best effort), bond-default refinance
 * (debt-for-debt swap via the bondRefinanceSpend primitive: guarded
 * refinance-count claim + deterministic replacement-bond insert under a
 * key-derived _id + per-bond cure claims, with Idempotency-Key
 * validation/forwarding and route-level
 * replay/minted-key/invalid-key/conflict/terminal/empty-remainder tests;
 * the cashless bond_issuance ledger row stays post-commit best effort) and
 * bond-default restructure (sector liquidation as an idempotent caller
 * pre-step with per-sector restore tokens, then corp liquid-capital net +
 * holder credits + per-bond cures via the bondRestructureSpend primitive,
 * same key contract and route tests; the bond_maturity rows stay
 * post-commit best effort). Refinance and restructure both run through
 * executeCorporationBondRefinance/Restructure on the routes and on the
 * bondTurn auto-resolver with deterministic per-turn keys, and bond-default
 * dissolution (per-bond market-pool recovery shares plus one resumable
 * credit per character/imperial/corp-creditor/corp-equity/central-bank/
 * index-fund payee via the bondDissolutionSpend primitive, with a stored
 * resume plan, remainder resume, terminal semantics, and route replay
 * helpers; the creditor-bond liquidation pull and in-kind cross-equity move
 * stay convergent caller pre-steps, the financial-tx rows stay post-commit
 * best effort, and the terminal ownership cleanup re-runs as a naturally
 * idempotent pass). Dissolution runs through
 * executeCorporationBondDefaultDissolution on the CEO dissolve and admin
 * force-liquidate routes (client Idempotency-Key, minted when absent) and
 * on the vote/cascade/NPP callers with deterministic per-event keys
 * (per-vote, per-corp, NPP stable across turns).
 * Ownership-only and excluded (no balance writes): union leadership
 * accept/resign/decline/vote (ownerId/unionLeaderOf/vote rows only),
 * bargaining settlement (campaign claim + agreement insert + expectation
 * restore move no balances), campaign upgrades (single-document guarded
 * spend).
 * Forex turn triggered-limit fills are migrated (applyForexTurnFillSpend:
 * deterministic per-turn key, resume plan persisted on the receipt at
 * claim, keyed credit/settle/spread/history steps with legacy-exact
 * amounts and phase order, same-key replay/resume/terminal semantics,
 * key-only orphan recovery re-driven by the turn driver before its scan).
 * Forex turn expiry refunds are migrated (applyForexExpireSpend: stable
 * order-derived key with no turn — expiration is once-only per order, so a
 * per-turn key could refund twice across turns — guarded expire + refund
 * steps with legacy-exact eligibility, currency/owner semantics, and phase
 * order, same-key replay/resume/terminal semantics, key-only orphan
 * recovery re-driven by the turn driver before its scan; the driver tallies
 * guarded transitions, mirroring the legacy modifiedCount).
 * State-org build is migrated (campaign actions + treasury debit via a
 * keyed leg with the extra actions guard, then the throttle/level-guarded
 * org upsert as a terminal keyed step via the stateOrgBuildSpend primitive,
 * with the same-key E11000 retry converging to already-applied; a lost race
 * compensates the debit and reports the historical ORG_RACE_OR_THROTTLE 409,
 * with Idempotency-Key validation/forwarding and route-level
 * replay/terminal/conflict tests).
 * Player-to-NPP direct actions are migrated (AP + campaign-funds debit via a
 * keyed leg that keeps the exact historical dual guard, including the
 * zero-cash actions-only shape with its `$gte: 0` funds assertion, then the
 * relationship upsert, the conditional endorsement upsert, the NPP stat
 * write, and the deterministic audit row via the directActionSpend
 * primitive, with Idempotency-Key validation/forwarding and route-level
 * replay/terminal/conflict tests). Validation runs only for fresh keys: a
 * receipt already on file means the first attempt validated, so a
 * crash-recovery retry skips the cost gates (which post-debit reads would
 * fail) and reconciles through the keyed steps, reporting the stored audit
 * row. The endorsement keeps the historical conditional shape (refresh the
 * active row for the target, else insert and withdraw the stale rows) but
 * the insert `_id` is derived from the idempotency key, so concurrent
 * same-key applies collapse onto one row via E11000 instead of duplicating
 * it; cross-key races keep the legacy no-transaction semantics, and the
 * revert removes only this attempt's row and reactivates the snapshot set
 * (unlike the historical rollback, which deleted every row for the
 * election). Reporting always follows the stored docs, so a retry returns
 * the first attempt's exact result.
 * Military recruitment is migrated (ministerial-action + manpower +
 * defence-appropriation + arsenal-lots debits plus the deterministic unit
 * insert via the militaryRecruitSpend primitive, driven by the
 * applyMilitaryRecruit command shell: the resume plan is persisted on the
 * receipt at claim time, so a same-key retry after a crash rebuilds its
 * steps from the stored plan instead of post-debit live reads; the degraded
 * arsenal fill resolves once and pins `drawnLots`; the manpower revert
 * refunds under the live ceiling clamp (bounded by the drawn amount,
 * exactly once per compensation key, so the live read cannot over-credit
 * under crash or concurrency); a failed revert settles `failed` with an
 * UNCOMPENSATED marker while the caller still sees the original step error,
 * with command-level validation-order/key-path/fresh-vs-replay/stored-
 * outcome/degraded-plan/error-parity tests and Idempotency-Key
 * validation/forwarding/minting plus settled/conflict route tests).
 * Forex turn chair interventions are migrated
 * (applyForexInterventionSpend: deterministic per-turn key, resume plan
 * persisted on the receipt at claim, keyed rate-writeback + combined
 * reserve-draw/infamy bank steps with legacy-exact amounts, phase order,
 * and single-update write shape, same-key replay/resume/terminal
 * semantics, key-only orphan recovery re-driven by the turn driver before
 * its country loop; the failure mail stays post-commit best effort like
 * the fill notifications). All forex monetary paths are now migrated:
 * request surfaces, market-maker exchange, turn fills, expiry refunds, and
 * interventions. What remains unkeyed in the forex turn is not money:
 * per-currency rate/history/policy writebacks for in-band or policy-less
 * rows are bare `$set`s with no balance effect, and a same-turn retry of a
 * completed intervention replays instead of clobbering.
 * Derived subkeys stay within the key cap via `deriveMoneyFlowKey`: a base
 * key near the accepted 128-character limit keeps its ordinary short
 * derivations byte-identical and hashes only the overflowing ones, so long
 * client keys flow through dissolution fan-out and compensation paths
 * instead of throwing `RangeError`.
 * Still on the legacy debit-first-plus-compensation fallback:
 * index-fund cron/rebalancing orchestration (its bond purchase/sale legs
 * are keyed; surrounding equity/dividend/cross-fund writes are not).
 *
 * Operations note: receipts accumulate one small document per keyed flow. The
 * TTL index on `createdAt` is seeded by `seedMoneyFlowIndexes` (registered in
 * `src/lib/admin/seed/seedIndexes.ts`); this module never creates indexes at
 * runtime.
 */

export const NON_ATOMIC_MONEY_FLOW_RECEIPTS_COLLECTION = "nonAtomicMoneyFlowReceipts";

/** Cap on stored keys per account document; bounds growth, not correctness. */
export const MAX_APPLIED_MONEY_FLOW_KEYS = 100;

/**
 * Maximum length of any money-flow idempotency key, including derived
 * subkeys. Routes accept client `Idempotency-Key` values up to this length,
 * so every internal derivation must stay within it too.
 */
export const MAX_MONEY_FLOW_KEY_LENGTH = 128;

export type MoneyFlowReceiptStatus = "in_progress" | "completed" | "failed" | "compensated";

export interface MoneyFlowReceipt {
  /** Idempotency key supplied by the caller. */
  _id: string;
  status: MoneyFlowReceiptStatus;
  /**
   * Caller-chosen fingerprint of the intended transfer
   * (e.g. `sender:target:amount:field`). A retry presenting the same key
   * with a different fingerprint is rejected instead of returning the
   * stored outcome for the wrong transfer.
   */
  fingerprint: string;
  /** Sentinel error code when the flow settled without completing. */
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Account documents that can carry keyed money-flow legs. */
export interface MoneyFlowAccount {
  _id: ObjectId | string;
  appliedMoneyFlowKeys?: string[];
}

export type MoneyFlowLegOutcome = "applied" | "already-applied" | "missing" | "guard-rejected";

export interface MoneyFlowLeg<TDoc extends MoneyFlowAccount> {
  /** Stable name used in compensation keys (`deriveMoneyFlowKey(key, "compensate", name)`). */
  name: string;
  collection: Collection<TDoc>;
  docId: TDoc["_id"];
  /** Dotted balance field, e.g. `currencyBalances.campaign`. */
  field: string;
  /** Negative for a debit, positive for a credit. */
  delta: number;
  /**
   * Debit guard: the balance must be at least this before the write. Omit
   * for pure credits. Lives in the same filter as the key guard, so the
   * check and the mutation are one atomic step.
   */
  minBalance?: number;
  /**
   * Extra `$inc` entries applied to the SAME document in the same atomic
   * write (e.g. a combined actions+funds debit). Same-document legs must
   * share one leg: two legs on one document under one key collide, because
   * the first leg's key record trips the second leg's `$ne: key` guard and
   * the second balance change is silently skipped. Compensation negates
   * these alongside `delta`.
   */
  extraIncs?: Record<string, number>;
  /**
   * Extra filter clauses merged into the atomic guard (e.g. cooldown
   * readiness, optimistic-concurrency stamps). Dropped on compensation so a
   * revert is never guard-blocked.
   */
  extraFilter?: Filter<TDoc>;
  /**
   * Extra `$set` entries merged into the atomic write (e.g. `updatedAt`).
   * Never a guard; kept on compensation.
   */
  set?: Record<string, unknown>;
}

export type MoneyFlowClaim = "fresh" | "in-progress" | "duplicate";

export class MoneyFlowKeyConflictError extends Error {
  readonly key: string;
  constructor(key: string) {
    super("Idempotency key was reused for a different transfer");
    this.name = "MoneyFlowKeyConflictError";
    this.key = key;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class MoneyFlowTerminalError extends Error {
  readonly key: string;
  readonly status: MoneyFlowReceiptStatus;
  constructor(key: string, status: MoneyFlowReceiptStatus, detail?: string) {
    super(
      `Transfer already settled as ${status}; start a new attempt with a new key` +
        (detail ? `: ${detail}` : "")
    );
    this.name = "MoneyFlowTerminalError";
    this.key = key;
    this.status = status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface MoneyFlowOptions {
  session?: ClientSession;
}

function sessionOpt(options: MoneyFlowOptions): { session: ClientSession } | undefined {
  return options.session ? { session: options.session } : undefined;
}

function isDuplicateKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: unknown }).code === 11000;
}

function validateKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_MONEY_FLOW_KEY_LENGTH) {
    throw new RangeError("Money flow idempotency key must be 1-128 characters");
  }
}

/**
 * Derive a deterministic subkey for one leg, step, or compensation of a flow
 * (issue #1672). A client key near the accepted 128-character limit would
 * overflow the cap once a `:holder:...` / `:pool:...` / `:compensate:...`
 * suffix is appended, and the derived write would then throw `RangeError`
 * instead of moving money. This keeps ordinary short keys byte-identical to
 * the old `${base}:${segments...}` form (readable, back-compatible) and
 * bounds long ones: `${head}:${suffix}:h:${hash}` where `hash` is 128 bits
 * of SHA-256 over the full untruncated candidate, so the derivation is
 * retry-stable (pure function of its inputs) and collision-resistant. The
 * purpose suffix is preserved verbatim for ops readability; only the base
 * head is truncated. When the suffix itself nearly fills the cap, the head
 * of the whole candidate is truncated instead. Every output passes
 * `validateKey`.
 */
export function deriveMoneyFlowKey(baseKey: string, ...segments: string[]): string {
  validateKey(baseKey);
  if (segments.length === 0) {
    throw new TypeError("Derived money flow key needs at least one segment");
  }
  for (const segment of segments) {
    if (typeof segment !== "string" || segment.length === 0) {
      throw new TypeError("Derived money flow key segments must be non-empty strings");
    }
  }
  const suffix = segments.join(":");
  const candidate = `${baseKey}:${suffix}`;
  if (candidate.length <= MAX_MONEY_FLOW_KEY_LENGTH) return candidate;
  const hash = createHash("sha256").update(candidate).digest("hex").slice(0, 32);
  const headBudget = MAX_MONEY_FLOW_KEY_LENGTH - suffix.length - 36;
  if (headBudget >= 1) {
    return `${baseKey.slice(0, headBudget)}:${suffix}:h:${hash}`;
  }
  const headLength = MAX_MONEY_FLOW_KEY_LENGTH - 35;
  return `${candidate.slice(0, headLength)}:h:${hash}`;
}

function validateLeg<TDoc extends MoneyFlowAccount>(leg: MoneyFlowLeg<TDoc>): void {
  if (!leg || typeof leg.name !== "string" || leg.name.length === 0) {
    throw new TypeError("Money flow leg needs a non-empty name");
  }
  if (!leg.collection || typeof leg.collection.updateOne !== "function") {
    throw new TypeError(`Money flow leg "${leg.name}" needs a collection`);
  }
  if (!leg.docId) {
    throw new TypeError(`Money flow leg "${leg.name}" needs a docId`);
  }
  if (typeof leg.field !== "string" || leg.field.length === 0) {
    throw new TypeError(`Money flow leg "${leg.name}" needs a balance field`);
  }
  if (!Number.isFinite(leg.delta) || leg.delta === 0) {
    throw new RangeError(`Money flow leg "${leg.name}" needs a finite non-zero delta`);
  }
  if (leg.minBalance !== undefined && (!Number.isFinite(leg.minBalance) || leg.minBalance < 0)) {
    throw new RangeError(`Money flow leg "${leg.name}" needs a finite non-negative minBalance`);
  }
  if (leg.extraIncs !== undefined) {
    for (const [field, delta] of Object.entries(leg.extraIncs)) {
      if (
        typeof field !== "string" ||
        field.length === 0 ||
        !Number.isFinite(delta) ||
        delta === 0
      ) {
        throw new RangeError(`Money flow leg "${leg.name}" needs finite non-zero extraIncs`);
      }
    }
  }
  if (leg.set !== undefined && (typeof leg.set !== "object" || leg.set === null)) {
    throw new TypeError(`Money flow leg "${leg.name}" needs an object set`);
  }
}

/**
 * Apply one balance leg at most once per key. The `$ne: key` guard, the
 * optional `$gte` balance guard, the `$inc`, and the key record are a single
 * atomic update, so concurrent or retried applications cannot double-apply.
 * A `matchedCount === 0` is disambiguated with one projected read:
 * missing document, already applied, or guard rejected.
 */
export async function applyIdempotentLeg<TDoc extends MoneyFlowAccount>(
  key: string,
  leg: MoneyFlowLeg<TDoc>,
  options: MoneyFlowOptions = {}
): Promise<MoneyFlowLegOutcome> {
  validateKey(key);
  validateLeg(leg);
  const filter = {
    _id: leg.docId,
    appliedMoneyFlowKeys: { $ne: key },
    ...(leg.minBalance !== undefined ? { [leg.field]: { $gte: leg.minBalance } } : {}),
    ...(leg.extraFilter ?? {}),
  } as Filter<TDoc>;
  const update = {
    $inc: { [leg.field]: leg.delta, ...(leg.extraIncs ?? {}) },
    ...(leg.set !== undefined ? { $set: leg.set } : {}),
    $push: {
      appliedMoneyFlowKeys: {
        $each: [key],
        $slice: -MAX_APPLIED_MONEY_FLOW_KEYS,
      },
    },
  } as unknown as Parameters<Collection<TDoc>["updateOne"]>[1];
  const result = await leg.collection.updateOne(filter, update, sessionOpt(options));
  if (result.matchedCount === 1) return "applied";

  const existing = await leg.collection.findOne({ _id: leg.docId } as Filter<TDoc>, {
    projection: { appliedMoneyFlowKeys: 1 },
    ...sessionOpt(options),
  });
  if (!existing) return "missing";
  if (existing.appliedMoneyFlowKeys?.includes(key)) return "already-applied";
  return "guard-rejected";
}

/**
 * Claim the receipt for a key. `fresh` means this call owns the attempt;
 * `in-progress` means a previous attempt crashed (or a duplicate request is
 * racing) and the caller must reconcile by re-running the legs;
 * `duplicate` means the flow already completed. Terminal failures throw
 * `MoneyFlowTerminalError` (fail closed); key reuse with a different
 * fingerprint throws `MoneyFlowKeyConflictError`.
 */
export async function claimMoneyFlowReceipt(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  fingerprint: string,
  options: MoneyFlowOptions = {}
): Promise<MoneyFlowClaim> {
  validateKey(key);
  if (typeof fingerprint !== "string" || fingerprint.length === 0) {
    throw new TypeError("Money flow claim needs a non-empty fingerprint");
  }
  const now = new Date();
  try {
    await receipts.insertOne(
      { _id: key, status: "in_progress", fingerprint, createdAt: now, updatedAt: now },
      sessionOpt(options)
    );
    return "fresh";
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const existing = await receipts.findOne(
    { _id: key } as Filter<MoneyFlowReceipt>,
    sessionOpt(options)
  );
  if (!existing) {
    throw new Error("MONEY_FLOW_RECEIPT_LOST");
  }
  if (existing.fingerprint !== fingerprint) {
    throw new MoneyFlowKeyConflictError(key);
  }
  if (existing.status === "completed") return "duplicate";
  if (existing.status === "in_progress") return "in-progress";
  throw new MoneyFlowTerminalError(key, existing.status, existing.error);
}

/**
 * Settle a receipt `failed` with a caller-chosen error WITHOUT running any
 * step. For pre-step validation failures on a fresh claim only (nothing
 * applied yet, so `failed` is truthful): a retry of a crashed attempt must
 * never settle here, because the crashed prefix may have moved money — it
 * reconciles through the keyed steps instead, or stays `in_progress`
 * (TTL-visible) when it cannot.
 */
export async function failMoneyFlowReceipt(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  error: string,
  options: MoneyFlowOptions = {}
): Promise<void> {
  await settleMoneyFlowReceipt(receipts, key, "failed", error, options);
}

async function settleMoneyFlowReceipt(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  status: Extract<MoneyFlowReceiptStatus, "completed" | "failed" | "compensated">,
  error: string | undefined,
  options: MoneyFlowOptions
): Promise<void> {
  await receipts.updateOne(
    { _id: key } as Filter<MoneyFlowReceipt>,
    {
      $set: {
        status,
        updatedAt: new Date(),
        ...(error !== undefined ? { error } : {}),
      },
    },
    sessionOpt(options)
  );
}

/**
 * A keyed single-document write that is not a balance leg: a guarded `$set`
 * (travel state, turnout, sector flags, nomination pushes), a guarded claim,
 * or any other update the caller can express idempotently. The caller's
 * update MUST NOT touch `appliedMoneyFlowKeys`; the key record is merged in.
 * Disambiguation reads by `_id` when the filter carries one, so a guard that
 * no longer matches (stale stamp, lost race) reports `guard-rejected` rather
 * than `missing`.
 */
export interface KeyedUpdate<TDoc extends MoneyFlowAccount = MoneyFlowAccount> {
  collection: Collection<TDoc>;
  filter: Filter<TDoc>;
  update: Record<string, unknown>;
}

function updateTouchesFlowKeys(update: Record<string, unknown>): boolean {
  for (const operator of ["$set", "$unset", "$push"]) {
    const clause = update[operator];
    if (clause !== null && typeof clause === "object" && "appliedMoneyFlowKeys" in clause) {
      return true;
    }
  }
  return false;
}

export async function applyKeyedUpdate<TDoc extends MoneyFlowAccount>(
  key: string,
  update: KeyedUpdate<TDoc>,
  options: MoneyFlowOptions = {}
): Promise<MoneyFlowLegOutcome> {
  validateKey(key);
  if (!update || typeof update.collection?.updateOne !== "function") {
    throw new TypeError("Keyed update needs a collection");
  }
  if (!update.filter || typeof update.filter !== "object") {
    throw new TypeError("Keyed update needs a filter");
  }
  if (!update.update || typeof update.update !== "object") {
    throw new TypeError("Keyed update needs an update document");
  }
  if (updateTouchesFlowKeys(update.update)) {
    throw new TypeError("Keyed update must not touch appliedMoneyFlowKeys");
  }
  const keyPush = {
    appliedMoneyFlowKeys: {
      $each: [key],
      $slice: -MAX_APPLIED_MONEY_FLOW_KEYS,
    },
  };
  const existingPush =
    update.update.$push !== null && typeof update.update.$push === "object"
      ? (update.update.$push as Record<string, unknown>)
      : undefined;
  const merged = {
    ...update.update,
    $push: { ...(existingPush ?? {}), ...keyPush },
  } as unknown as Parameters<Collection<TDoc>["updateOne"]>[1];
  const filter = {
    ...update.filter,
    appliedMoneyFlowKeys: { $ne: key },
  } as Filter<TDoc>;
  const result = await update.collection.updateOne(filter, merged, sessionOpt(options));
  if (result.matchedCount === 1) return "applied";

  const rawFilter = update.filter as Record<string, unknown>;
  const identityFilter = (
    "_id" in rawFilter ? { _id: rawFilter._id } : update.filter
  ) as Filter<TDoc>;
  const existing = await update.collection.findOne(identityFilter, {
    projection: { appliedMoneyFlowKeys: 1 },
    ...sessionOpt(options),
  });
  if (!existing) return "missing";
  if (existing.appliedMoneyFlowKeys?.includes(key)) return "already-applied";
  return "guard-rejected";
}

/**
 * Derive a deterministic insert `_id` from a flow's idempotency key. A client
 * retry (or crash recovery) under the same key rebuilds the same `_id`, so
 * the insert step converges to `already-applied` instead of duplicating the
 * row. The domain salts the hash so two flows sharing a key string (e.g. a
 * state attack and a player ad) never collide. Keys minted per request
 * (`randomUUID`) still yield unique ids per attempt, preserving the old
 * non-idempotent behavior for keyless callers.
 */
export function keyedInsertId(key: string, domain: string): ObjectId {
  validateKey(key);
  if (typeof domain !== "string" || domain.length === 0) {
    throw new TypeError("Keyed insert id needs a non-empty domain");
  }
  const digest = createHash("sha256").update(`${domain}:${key}`).digest();
  return new ObjectId(Buffer.from(digest.subarray(0, 12)));
}

/**
 * Insert a document with a caller-supplied `_id` (pre-generated before the
 * flow starts so every attempt and every recovery uses the same one; see
 * `keyedInsertId`). A duplicate key means this step already applied; anything
 * else throws.
 */
export async function insertKeyedDoc<TSchema>(
  collection: Collection<TSchema>,
  doc: TSchema,
  options: MoneyFlowOptions = {}
): Promise<"applied" | "already-applied"> {
  if (!collection || typeof collection.insertOne !== "function") {
    throw new TypeError("Keyed insert needs a collection");
  }
  if (!doc || typeof doc !== "object" || (doc as { _id?: unknown })._id == null) {
    throw new TypeError("Keyed insert needs a document with a pre-generated _id");
  }
  try {
    await collection.insertOne(
      doc as Parameters<Collection<TSchema>["insertOne"]>[0],
      sessionOpt(options) as Parameters<Collection<TSchema>["insertOne"]>[1]
    );
    return "applied";
  } catch (error) {
    if (isDuplicateKeyError(error)) return "already-applied";
    throw error;
  }
}

/**
 * One ordered step of a money flow: a keyed write plus its keyed inverse.
 * Balance legs build steps with an automatic `$inc` inverse; side effects
 * (guarded `$set`, deterministic inserts) supply their own inverse or none
 * when they are terminal (nothing runs after them, so there is nothing to
 * undo them for). A step with no inverse that fails after earlier steps
 * applied settles the receipt `failed` with an `UNCOMPENSATED` marker
 * (fail closed for ops) instead of pretending the prefix was reversed.
 */
export interface MoneyFlowStep {
  name: string;
  apply(options?: MoneyFlowOptions): Promise<MoneyFlowLegOutcome>;
  revert?(options?: MoneyFlowOptions): Promise<MoneyFlowLegOutcome>;
}

/**
 * A deterministic insert as a terminal step. A survived insert error (a real
 * crash runs no code at all, so anything observed here is a failure the
 * process lived through) reports `guard-rejected` so the applied prefix is
 * compensated instead of stranded debited-with-no-row; the caller maps the
 * step to its own error. Duplicate `_id` still converges to
 * `already-applied` inside `insertKeyedDoc`.
 */
export function makeInsertStep<TSchema>(
  name: string,
  collection: Collection<TSchema>,
  doc: TSchema
): MoneyFlowStep {
  if (typeof name !== "string" || name.length === 0) {
    throw new TypeError("Insert step needs a non-empty name");
  }
  return {
    name,
    apply: async (options) => {
      try {
        return await insertKeyedDoc(collection, doc, options ?? {});
      } catch {
        return "guard-rejected";
      }
    },
  };
}

/**
 * A balance leg as a revertible step (inverse: negated `$inc`, guards off).
 * Generic per leg so one flow can mix collections (`Collection<Character>`,
 * `Collection<PoliticalParty>`, ...): `Collection<T>` is invariant (via
 * `bulkWrite`), so heterogeneous legs meet only here behind the
 * collection-erased `MoneyFlowStep`, never in a shared typed array.
 */
export function makeLegStep<TDoc extends MoneyFlowAccount>(
  key: string,
  leg: MoneyFlowLeg<TDoc>
): MoneyFlowStep {
  validateKey(key);
  validateLeg(leg);
  const negatedExtraIncs = Object.fromEntries(
    Object.entries(leg.extraIncs ?? {}).map(([field, delta]) => [field, -delta])
  );
  return {
    name: leg.name,
    apply: (options) => applyIdempotentLeg(key, leg, options ?? {}),
    revert: (options) =>
      applyIdempotentLeg(
        deriveMoneyFlowKey(key, "compensate", leg.name),
        {
          ...leg,
          delta: -leg.delta,
          minBalance: undefined,
          extraFilter: undefined,
          extraIncs: Object.keys(negatedExtraIncs).length > 0 ? negatedExtraIncs : undefined,
        },
        options ?? {}
      ),
  };
}

export interface MoneyFlowStepRef {
  index: number;
  name: string;
}

/**
 * Run steps in order to exactly one terminal state. Idempotent: safe both as
 * the first attempt and as crash recovery, because every step is keyed
 * (invariant 1). On a step failure the applied prefix is reversed in order
 * with each step's inverse before the receipt settles, so the receipt never
 * rests partial. Throws the caller's mapped error for the failed step.
 */
export async function runMoneyFlowSteps(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  steps: MoneyFlowStep[],
  mapStepError: (step: MoneyFlowStepRef, outcome: MoneyFlowLegOutcome) => Error,
  options: MoneyFlowOptions = {}
): Promise<void> {
  validateKey(key);
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new TypeError("Money flow needs at least one step");
  }

  const applied: MoneyFlowStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const outcome = await step.apply(options);
    if (outcome === "applied" || outcome === "already-applied") {
      applied.push(step);
      continue;
    }

    if (applied.length === 0) {
      const error = mapStepError({ index, name: step.name }, outcome);
      await settleMoneyFlowReceipt(receipts, key, "failed", error.message, options);
      throw error;
    }

    for (let back = applied.length - 1; back >= 0; back -= 1) {
      const done = applied[back]!;
      if (!done.revert) {
        const error = mapStepError({ index, name: step.name }, outcome);
        await settleMoneyFlowReceipt(
          receipts,
          key,
          "failed",
          `UNCOMPENSATED:${done.name}:no-revert`,
          options
        );
        throw error;
      }
      const reversal = await done.revert(options);
      if (reversal !== "applied" && reversal !== "already-applied") {
        const error = mapStepError({ index, name: step.name }, outcome);
        await settleMoneyFlowReceipt(
          receipts,
          key,
          "failed",
          `UNCOMPENSATED:${done.name}:${reversal}`,
          options
        );
        throw error;
      }
    }
    const error = mapStepError({ index, name: step.name }, outcome);
    await settleMoneyFlowReceipt(receipts, key, "compensated", error.message, options);
    throw error;
  }

  await settleMoneyFlowReceipt(receipts, key, "completed", undefined, options);
}

/**
 * Run legs in order to exactly one terminal state. Idempotent: safe both as
 * the first attempt and as crash recovery, because every leg is keyed
 * (invariant 1). On a leg failure the already-applied prefix is reversed
 * with compensation keys before settling, so the receipt never rests
 * partial. Throws the caller's mapped error for the failed leg.
 */
export async function runMoneyFlowLegs<TDoc extends MoneyFlowAccount>(
  receipts: Collection<MoneyFlowReceipt>,
  key: string,
  legs: Array<MoneyFlowLeg<TDoc>>,
  mapLegError: (index: number, outcome: MoneyFlowLegOutcome) => Error,
  options: MoneyFlowOptions = {}
): Promise<void> {
  legs.forEach(validateLeg);
  return runMoneyFlowSteps(
    receipts,
    key,
    legs.map((leg) => makeLegStep(key, leg)),
    (step, outcome) => mapLegError(step.index, outcome),
    options
  );
}
