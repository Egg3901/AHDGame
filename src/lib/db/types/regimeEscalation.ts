/**
 * Per-country regime escalation state.
 *
 * Tracks the 4-stage escalation chain (Discontent → Crisis →
 * Internal challenge → Collapse) for one-party states. One document
 * per country (`_id === countryId`). Written only by the per-turn
 * escalation driver, the decision-event resolution path, and Phase 6's
 * convention / system-conversion writers.
 *
 * Reserves fields used by later phases (`convention`,
 * `conversionPendingAtTurn`, `stage4Delay`) — Phase 3 only writes
 * `currentStage`, `dwellCounters`, `activeDecision`, `decisionQueue`,
 * and `transitionHistory`. Phases 4 / 6 populate the rest.
 */
import type { ObjectId } from "mongodb";
import type { CountryId, GovernmentType } from "@/lib/constants/countries";

export type RegimeStage = "stable" | "discontent" | "crisis" | "internalChallenge" | "collapse";

/**
 * Decision-event identifier. Each stage has its own decision kind,
 * plus the convention-draft decision fired during Phase 6's
 * constitutional convention flow.
 */
export type DecisionKind =
  | "stage1.addressDiscontent"
  | "stage2.respondToUnrest"
  | "stage3.respondToFactionSplit"
  | "stage4.faceCollapse"
  | "convention.draft";

export interface LeaderDecision {
  /** Stable id for the decision; used to resolve via API. */
  id: ObjectId;
  kind: DecisionKind;
  /** Turn the decision was offered. */
  offeredAtTurn: number;
  /** Turn after which the default-action fires automatically. */
  expiresAtTurn: number;
  /** Character id of the leader the decision is directed at. */
  leaderCharacterId: ObjectId;
  /** Kind-specific payload (e.g. defectors list for stage3, draft params for convention). */
  payload: Record<string, unknown>;
}

export interface StageTransitionEvent {
  turn: number;
  from: RegimeStage;
  to: RegimeStage;
  reason: string;
  at: Date;
}

/**
 * Sliding-window dwell counters per stage. Each counts the turns the
 * country has spent meeting the stage's entry condition; transitions
 * fire only when the counter clears the stage's dwell threshold.
 *
 * stage3 keys off `partyConfidence` not popular (see design doc); the
 * other counters key off `popularLegitimacy`.
 */
export interface DwellCounters {
  stage1: number;
  stage2: { sustained: number; cumulativeIn168: number };
  stage3: number;
  stage4: number;
}

/**
 * Phase 6 convention state. Reserved here for type completeness; only
 * written once Phase 6 lands.
 */
export interface ConventionState {
  phase: "announced" | "draft" | "ratification";
  announcedAtTurn: number;
  draftDeadlineTurn: number;
  targetSystem?: GovernmentType;
  legacyReservation: number;
  electionDelayTurns: number;
  ratifiedAtTurn?: number;
}

export interface EscalationState {
  /** Primary key: countryId. One row per country. */
  _id: CountryId;
  countryId: CountryId;
  currentStage: RegimeStage;
  /** Turn the current stage was entered. */
  stageEnteredAtTurn: number;
  dwellCounters: DwellCounters;
  /**
   * Whether a constitutional convention is in progress (Phase 6).
   * Phase 3 only reads this flag to suppress Stage 4 dwell — never
   * writes it.
   */
  conventionInProgress: boolean;
  /** Single-slot active decision. Null when nothing pending. */
  activeDecision: LeaderDecision | null;
  /** Passive queue of upcoming decisions; head promotes on resolution. */
  decisionQueue: LeaderDecision[];
  /** Bounded history of stage transitions (newest first), max 50 entries. */
  transitionHistory: StageTransitionEvent[];

  // ── Phase-4 transient flags ──────────────────────────────────────────────
  /**
   * Per-turn popular-legitimacy decay rate modifier. Multiplies the
   * effective drift contribution until the supplied turn. Applied by
   * Stage 1's crack down (0.5×) / ignore (1.25×) and Stage 2's martial
   * law (0× freeze) / ignore (1.5×) decisions.
   */
  popularDecayModifier?: { multiplier: number; untilTurn: number };
  /**
   * Stage 2 "open dialogue" sets this to halve the Stage-2 dwell
   * counter's accumulation rate (effectively double the decay) for the
   * window — gives the regime a real shot at climbing back out.
   */
  stage2DwellDecayBoost?: { multiplier: number; untilTurn: number };
  /**
   * Stage 2 martial law blocks Stage 3 escalation until the supplied
   * turn — the regime buys time at high popular cost.
   */
  stage3Block?: { untilTurn: number };

  // ── Reserved for later phases ────────────────────────────────────────────
  convention?: ConventionState;
  /** Set by Phase-4 stage4 acceptPeacefully decision; consumed by Phase 6. */
  conversionPendingAtTurn?: number;
  /** Phase-4 stage4 "resist" delay marker; consumed by Phase 6. */
  stage4Delay?: {
    untilTurn: number;
    halveLegacyBonusIfStillBelow15: boolean;
  };

  createdAt: Date;
  updatedAt: Date;
}
