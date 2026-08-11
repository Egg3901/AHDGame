import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * Audit trail for Org / Reg / Support / pool-bucket movements.
 *
 * Every change to a party's `Org%` or `Reg%`, a candidate's `Support`, or
 * a state's non-party buckets (`Independent`, `Unregistered`,
 * `UnaffiliatedOrg`) produces a row here.
 *
 * Phase 1: schema added; no rows written yet (bootstrap seed and runtime
 *   writers come online in Phase 1.5 / Phase 2 prerequisite + Phase 3).
 *
 * See docs/design/political-system-reg-support.md §5 for the full model.
 */

export type OrgRegMetric =
  "org" | "reg" | "support" | "independent" | "unregistered" | "unaffiliatedOrg";

export type OrgRegLedgerSource =
  /** Explicit player or chair action (rally, ad buy, etc.) */
  | "action"
  /** Passive `Org → Reg` drift (turn-order step 3) */
  | "drift"
  /** Passive Reg decay / erosion (turn-order step 4) */
  | "decay"
  /** Direct rival-party Reg capture (Phase 3 contest action) */
  | "poach"
  /** Any other passive source (PS trickle, NPP/officeholder bonuses) */
  | "passive"
  /** Pool-sum invariant correction (per validateRegistrationPool) */
  | "renormalize"
  /** Routing on party-row deletion (third-party collapse) */
  | "partyCollapse"
  /** Candidate Support decay (separate from Reg decay) */
  | "supportDecay"
  /** Candidate Support delta from a Support action */
  | "supportAction"
  /**
   * One-shot backfill events relevant to this ledger's metrics — e.g.
   * Phase 1.5 / Phase 2 seeding StatePartyOrg.registration from the
   * bootstrap appendix on existing rows. Field renames that don't touch
   * org/reg/support don't log here (e.g. the Phase 3 actionPool →
   * politicalStrength rename has no ledger row).
   */
  | "migration"
  /** Bootstrap seed run (initial population on country reset) */
  | "seed";

/**
 * Sentinel partyId used for state-level pool buckets (Independent,
 * Unregistered). These buckets are not scoped to a party but live in the
 * same ledger so a single per-state read returns the full audit trail.
 */
export const POOL_SENTINEL_PARTY_ID = "__pool__" as const;

export interface OrgRegLedger {
  _id: ObjectId;

  /** Game turn at which the change applied. Matches gameState.currentTurn semantics. */
  turn: number;

  countryId: CountryId;
  stateId: string;

  /**
   * For metrics scoped to a party (`org`, `reg`, `support` as a rollup, or
   * `unaffiliatedOrg` when computed for accounting). For metrics scoped to
   * the state-level pool (`independent`, `unregistered`), this is the
   * sentinel value `POOL_SENTINEL_PARTY_ID`.
   */
  partyId: string;

  metric: OrgRegMetric;

  /**
   * Signed delta in percentage points. Positive = gain, negative = loss.
   * Bounds: roughly -100..100 in practice, but no hard schema cap.
   */
  delta: number;

  /**
   * Resulting value after the delta. Useful so reconciliation can verify
   * `prev + delta = next` against the live document without a second query.
   */
  value: number;

  source: OrgRegLedgerSource;

  /**
   * Optional actor: the user / NPP whose action produced this ledger row.
   * Always set for `action`, `poach`, and `supportAction` sources; null for
   * passive / drift / decay / renormalize / partyCollapse / migration / seed.
   */
  actorId: ObjectId | null;

  /**
   * Optional free-form context. Examples:
   *  - action source: `"action:contest:dem"`
   *  - poach source: `"poach:from:gop"` to record the source-party
   *  - migration source: `"migration:phase1:registrationBackfill"`
   * Reserved for human-readable context in change history UI; not parsed by code.
   */
  note?: string;

  createdAt: Date;
}
