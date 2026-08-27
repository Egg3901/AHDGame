import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { NewsCategory } from "@/lib/db/types/newsPost";

export type EventDefinitionStatus = "draft" | "approved" | "retired";

export type EventEligibility =
  "all" | "politician" | "ceo" | "inElection" | "ceoConcentrated" | "ceoVeryConcentrated";

export type EventInstanceStatus = "pending" | "resolved" | "expired";

export type EventScope = "character" | "country";

/**
 * World Events v1 Phase 1 scheduler. Country-scope definitions opt into one
 * of two deterministic firing modes — no Date.now()/Math.random anywhere in
 * this path (plan §7, sim-reproducible):
 *  - "recurring": fires whenever `(turn - offsetTurns) % everyTurns === 0`
 *    (Olympics-class; a fixed cadence known in advance).
 *  - "window": fires after a hash-derived gap in `[minGapTurns, maxGapTurns]`
 *    since the definition's `lastFiredTurn` for that country — see
 *    `windowGapTurns` in `worldEvents/scheduler.ts`.
 */
export type EventSchedule =
  | { kind: "recurring"; everyTurns: number; offsetTurns: number }
  | { kind: "window"; minGapTurns: number; maxGapTurns: number };

export type EventEffect =
  | { type: "favorability"; delta: number }
  | { type: "infamy"; delta: number }
  | { type: "politicalInfluence"; delta: number }
  | { type: "personalWealth"; deltaAnchor: number }
  | { type: "campaignFunds"; deltaLocal: number }
  | { type: "campaignSupport"; delta: number }
  | { type: "corpSentiment"; corpId?: "own"; delta: number }
  | { type: "custom"; handlerKey: string; payload: Record<string, unknown> }
  // ── Country-scope effects (World Events v1 Phase 0) ──────────────────────
  /** Federal budget +/- (anchor ₳). Always written through financialTxLog. */
  | { type: "treasuryDelta"; deltaAnchor: number }
  /** Executive approval rating (governmentApprovals.approvalRating). */
  | { type: "approvalDelta"; delta: number }
  /** Temporary demand modifier consumed by the commodity engine; expires by turn. */
  | { type: "sectorDemandModifier"; sectorType: string; pct: number; durationTurns: number }
  /** Pure news — no mechanical effect. */
  | { type: "wireOnly" };

/**
 * Optional National Wire Service post emitted when this outcome tier resolves.
 * Reserved for the genuinely notable tiers (record fines, scandals, viral
 * moments) so the public feed isn't spammed by routine event resolutions.
 * Templates interpolate `{name}` (character), `{corp}` (their corporation),
 * and `{country}` at resolve time.
 */
export interface OutcomeNewsWire {
  category: NewsCategory;
  title: string;
  template: string;
}

export interface OutcomeTier {
  minRoll: number;
  maxRoll: number;
  label: string;
  effects: EventEffect[];
  newsWire?: OutcomeNewsWire;
}

export interface EventDefinitionOption {
  id: string;
  label: string;
  description: string;
  isDefault?: boolean;
  /** Code-first handlers own outcome tables; optional on DB catalog rows. */
  outcomeTable?: OutcomeTier[];
}

export interface EventDefinition {
  _id: ObjectId;
  kind: string;
  status: EventDefinitionStatus;
  version: number;
  title: string;
  headline: string;
  body: string;
  image?: string;
  eligibility: EventEligibility[];
  /** Roles that disqualify a character from this event even when
   *  `eligibility` would otherwise match. Used to keep grounded role fit, e.g.
   *  a sitting officeholder is not summoned for ordinary jury duty. */
  excludeEligibility?: EventEligibility[];
  baseWeight: number;
  cooldownTurnsMin: number;
  cooldownTurnsMax: number;
  options: EventDefinitionOption[];
  defaultOptionId: string;
  requiresCountryIds?: CountryId[];
  /**
   * Era gating: earliest in-game year this event may fire (inclusive).
   * Absent = no lower bound. Keeps anachronistic events (e.g. "you went
   * viral") out of early-era presets and lets decade-scoped events
   * (minYear 1950 / maxYear 1959) exist. Evaluated in the PREE weighting
   * filter and the world-events scheduler; admin manual triggers bypass it.
   */
  minYear?: number;
  /** Era gating: latest in-game year this event may fire (inclusive). Absent = no upper bound. */
  maxYear?: number;
  /**
   * Cold-war tension gating: lowest global tension reading (0-100, see
   * lib/coldwar/tension.ts) at which this event may fire (inclusive). Lets
   * war-scare society events (panic buying, bank runs, shelter fever) exist
   * only while the world is actually frightened. Evaluated in the
   * world-events scheduler; admin manual triggers bypass it, same as era
   * bounds. Absent = no lower bound.
   */
  minTension?: number;
  /** Tension gating: highest tension reading at which this event may fire (inclusive). Absent = no upper bound. */
  maxTension?: number;
  /**
   * Broadcast events: shared historic moments (the moon landing, the Wall
   * coming down) offered to EVERY eligible character at once when the in-game
   * year enters the event's window — "country" = every character in
   * `requiresCountryIds`, "global" = every character in the world. Fires at
   * most once per world (tracked in the cooldown ledger under a synthetic
   * broadcast scope). Broadcast definitions never enter the normal weighted
   * per-character pool; `baseWeight` is unused for them.
   */
  broadcast?: "country" | "global";
  /**
   * Country-scope definitions only. Marks the resolve route to authorize the
   * character currently holding the country's national executive office
   * rather than the offer's `scopeId` (which is the countryId for scope
   * "country"). No other decider roles exist in v1.
   */
  deciderRole?: "executive";
  /** Country-scope only. Absent = admin-trigger-only (Phase 0 behavior), unchanged. */
  schedule?: EventSchedule;
  approvedBy?: ObjectId;
  approvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventInstance {
  _id: ObjectId;
  kind: string;
  scope: EventScope;
  scopeId: ObjectId;
  definitionVersion: number;
  status: EventInstanceStatus;
  roll: number;
  payload: Record<string, unknown>;
  offeredAtTurn: number;
  offeredAt: Date;
  expiresAtRealtimeMs: number;
  resolvedAt?: Date;
  resolvedOptionId?: string;
  resolvedTierLabel?: string;
  resolveReason?: "player" | "timeout";
  createdAt: Date;
  updatedAt: Date;
}

export interface EventCooldownLedger {
  _id: ObjectId;
  scope: EventScope;
  /** For scope "country", scopeId encodes the countryId (see cooldown.ts). */
  scopeId: ObjectId;
  lastExpiredAtTurn: number;
  nextEligibleTurn: number;
  perKindCooldowns: Record<string, number>;
  /**
   * Country-scope scheduler only (World Events v1 Phase 1): the turn each
   * scheduled definition kind last fired for this country, keyed by
   * `EventDefinition.kind`. Distinct from `perKindCooldowns`, which stores a
   * character-PREE "eligible-at" turn with different semantics — this field
   * is the raw last-fire timestamp the window scheduler hashes against.
   */
  lastFiredTurnByKind?: Record<string, number>;
  updatedAt: Date;
}

/**
 * Temporary country-scope sector demand modifier (World Events v1 Phase 0).
 * Written by `sectorDemandModifier` effects; consumed via
 * `getActiveSectorDemandModifierPct` and expires by turn number rather than
 * a sweep deletion (lazily filtered — see countryModifiers.ts).
 */
export interface CountryModifier {
  _id: ObjectId;
  countryId: string;
  kind: "sectorDemandModifier";
  sectorType: string;
  pct: number;
  appliedAtTurn: number;
  expiresAtTurn: number;
  sourceInstanceId?: ObjectId;
  createdAt: Date;
}
