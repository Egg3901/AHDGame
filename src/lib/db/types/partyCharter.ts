import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * Party Charter — the gating document required to create a new third party.
 *
 * Phase 6 introduces a 3-of-3 founder co-sign requirement before a party
 * row materializes in `politicalParties`. The charter doc lives independently
 * and goes through an explicit lifecycle (see `PartyCharterStatus`).
 *
 * Default parties (Dem / GOP / Lab / Con / etc.) bypass this entirely —
 * `isDefault: true` parties are seed-created and never go through the
 * charter flow.
 *
 * See plan §"Phase 6 — Decisions Recorded During Execution" D1-D7.
 */

/**
 * Lifecycle states. Transitions are enforced by the lifecycle command
 * helpers in `src/lib/charters/`.
 *
 * Forward path:
 *   draft → pending-signatures → ratified
 * Side paths:
 *   pending-signatures → rejected (any founder rejects)
 *   pending-signatures → founder-replacement (a founder is voided / banned)
 *   founder-replacement → pending-signatures (replacement found)
 *   founder-replacement → expired (replacement deadline missed)
 *   draft / pending-signatures → expired (initial expiresAt missed)
 *
 * Migration-only:
 *   migrated — synthesized ratified charter for an existing 3+-human party
 *   migrated-incomplete — fewer than 3 humans available; party retains
 *     cleanup immunity. The remaining founder slots can be filled later
 *     via the charter detail page to transition to a fully ratified state.
 */
export type PartyCharterStatus =
  | "draft"
  | "pending-signatures"
  | "ratified"
  | "founder-replacement"
  | "rejected"
  | "expired"
  | "migrated"
  | "migrated-incomplete";

export interface PartyCharterPlatform {
  /** Economic axis: -60 (left) to +60 (right). */
  economic: number;
  /** Social axis: -60 (progressive) to +60 (conservative). */
  social: number;
}

/**
 * One of two player-picked entries in `PartyCharter.foundingCohort`.
 * Each pick spawns one founding NPP at the chosen state/region with the
 * chosen positions. A third (implicit) NPP is always spawned in the
 * chair's home state with the charter's platform positions — see F4
 * redesign in `docs/plans/archive/2026-05/2026-05-22-f4-founding-cohort-redesign.md`.
 */
export interface FoundingCohortPick {
  /**
   * State/region ID for the spawned NPP. Must equal the chair's home
   * state OR be in `adjacentStates(country, chairHomeState)`. The picker
   * permits picking the chair's home state again (concentrates two NPPs
   * there) and permits both picks pointing at the same adjacent state
   * (concentrates two NPPs there).
   */
  stateId: string;
  /** Economic position on the party-grid (-5..+5). Defaults at draft time to `axisToPartyPosition(charter.platform.economic)`. */
  economicPosition: number;
  /** Social position on the party-grid (-5..+5). Defaults at draft time to `axisToPartyPosition(charter.platform.social)`. */
  socialPosition: number;
}

export interface PartyCharterSignature {
  /**
   * Founder's characterId. Identifies a specific in-game persona, not the
   * underlying account — so a single user with multiple characters can
   * occupy multiple slots (the Phase 6 D3 "humans only" rule still holds:
   * each `Character` row is owned by a real `userId`, NPPs live in a
   * separate collection).
   */
  characterId: ObjectId;
  /** Set when the founder explicitly signs. Mutually exclusive with rejectedAt. */
  signedAt?: Date;
  /** Set when the founder explicitly rejects. */
  rejectedAt?: Date;
  /** Free-form rejection note, if any. */
  rejectionReason?: string;
}

export interface PartyCharter {
  _id: ObjectId;
  countryId: CountryId;
  /**
   * `null` until ratification spawns the actual party row, then set to
   * the new party's `sequentialId` cast to string. Pre-ratification
   * drafts use null; migration retrofit sets this to the existing
   * party's sequentialId immediately.
   */
  partyId: string | null;
  proposedName: string;
  proposedAbbr: string;
  /**
   * Founder characterIds — exactly 3 entries except in `migrated-incomplete`
   * where there may be 1 or 2 with `pendingFounderSlots > 0`. A single
   * underlying `userId` may appear behind multiple character entries in
   * this list (multi-character accounts) — the unique-founder rule is
   * enforced at the character level, not the user level, so multi-char
   * testing and legitimate multi-persona play both work.
   */
  foundersCharacterIds: ObjectId[];
  /** Number of founder slots still empty in `migrated-incomplete` state. 0 otherwise. */
  pendingFounderSlots: number;
  platform: PartyCharterPlatform;
  signatures: PartyCharterSignature[];
  status: PartyCharterStatus;
  createdAt: Date;
  /**
   * Per Phase 6 D4: `max(createdAt + 14 turns, createdAt + 72 IRL hours)`.
   * Recomputed on each turn pass to honor cadence changes mid-draft.
   * Null for `migrated` / `ratified` charters (no expiry).
   */
  expiresAt: Date | null;
  /**
   * Turn-based mirror of `expiresAt`. Server expiry resolves against this so a
   * paused game freezes the countdown (no drift vs the wall clock). Optional
   * during the transition; new drafts set both. Null when `expiresAt` is null
   * (migrated / ratified). See [[project-turn-based-deadline-migration]].
   */
  expiresOnTurn?: number | null;
  ratifiedAt?: Date;
  /**
   * Set when entering `founder-replacement`. Same MIN(turns, IRL) rule
   * as `expiresAt`. If founder slot stays empty past this, the charter
   * transitions to `expired`.
   */
  founderReplacementDeadline?: Date | null;
  /** Turn-based mirror of `founderReplacementDeadline` (see `expiresOnTurn`). */
  founderReplacementDeadlineTurn?: number | null;
  /**
   * Founding-cohort spawn plan set by the chair during charter drafting.
   * Always exactly two picks (the third founding NPP is implicit — spawned
   * in the chair's home state with the charter's platform positions).
   *
   * Absent on legacy / migrated drafts: ratification falls back to the
   * pre-redesign behavior (5 NPPs all in chair's home state at charter
   * platform positions). See F4 redesign scope doc for rationale.
   */
  foundingCohort?: [FoundingCohortPick, FoundingCohortPick];
  updatedAt: Date;
}

// PartyCharterAmendment retired in the 2026-05-22 amendments-via-
// CommitteeProposal redesign. Post-ratification platform changes flow
// through `CommitteeProposal.positionShift` (±1 per proposal, per-axis
// 336-turn cooldown). Non-platform amendments (rename, electionMethod,
// electionDuration, merge) flow through their respective CommitteeProposal
// types. See
// `docs/plans/archive/2026-05/2026-05-22-amendments-via-committee-proposals.md`.
