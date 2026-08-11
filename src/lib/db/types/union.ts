import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * v3 Phase 8 (`labourSystemMode >= "full"`) — a player-run union.
 *
 * One Union per (countryId, sectorType) pair — a union organizes an entire
 * industry within a country (e.g. "US Manufacturing Workers"), not a
 * hand-picked list of sectors. Its scope (which `CorporateSector`s it
 * affects) is computed by querying for matching countryId+sectorType at
 * read/action time, not stored as a join table — this maps directly onto
 * the existing per-sector `unionization` stat with no new plumbing.
 *
 * Deliberately NOT a membership-roster social system: "membership" is the
 * abstract `unionization`/`membershipPressure` stat (an NPC worker
 * population), not a roster of player Characters who joined. Player leaders
 * are elected: organizers fund drives until `membershipPressure` crosses a
 * threshold, then organizers vote for a president who must accept the offer.
 *
 * `ownerId` is the source of truth for who leads this union — see the
 * denormalized `Character.unionLeaderOf` cache in `src/lib/db/types/character.ts`.
 */
export interface Union {
  _id: ObjectId;
  countryId: CountryId;
  sectorType: CorporationType;
  /** Era-appropriate seeded display name (historical where possible, generic fallback). */
  name: string;
  /**
   * Whoever leads this union, or null (unmanned — Phase 5's drift model runs
   * unchanged). Read `ownerType` before resolving the id: it points at
   * `characters` for a player and `npps` for an NPP leader.
   */
  ownerId: ObjectId | null;
  /**
   * Which collection `ownerId` refers to. Absent means `"character"`, so every
   * pre-existing union document keeps its original meaning. Mirrors the
   * `Corporation.ceoId`/`ceoType` pairing.
   */
  ownerType?: "character" | "npp";
  /** Top vote-getter awaiting acceptance — mirrors `Corporation.pendingCeoCharacterId`. */
  pendingLeaderCharacterId?: ObjectId | null;
  /** Spendable balance (home-country currency-equivalent, ₳-anchor) — funds recruit/strike actions. Trickles up per turn proportional to `membershipPressure` (the "dues" analog). */
  treasury: number;
  /**
   * 0-100, player-adjustable bias feeding `unionizationDriftTarget()` (see
   * `src/lib/labour/unionization.ts`) for sectors matching this union's
   * (countryId, sectorType), ON TOP OF the existing NPC drift — only applied
   * while `ownerId != null` (unowned unions leave Phase 5's drift untouched).
   * Decays toward a baseline absent active recruitment.
   */
  membershipPressure: number;
  /** Turn a strike was last force-called via this union's `/strike` action — a union-level rate limit, separate from each sector's own `strikeCooldownUntilTurn`. */
  lastCalledStrikeTurn: number | null;
  /** Visible target wageLevel this union is demanding from CEOs in its scope, or null if none set. */
  demandedWageLevel: number | null;
  /**
   * Union ban (player suggestion #93): true while this union's country has
   * `FederalBudget.unionsBanned` set by an enacted ban. Suspended unions are
   * frozen — `processUnionsTurn` skips dues/decay/inactivity-vacancy for them
   * and player actions 403 — but the document (leadership, treasury,
   * membershipPressure) is deliberately NEVER deleted, so a repeal restores
   * the union exactly as it was. Set/cleared by `applyUnionLawProvision`
   * (`src/lib/labour/unionLaws.ts`).
   */
  suspended?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * v3 Phase 8: a union's recorded stance on a bill — visibility-only this
 * phase (no mechanical vote-swing effect yet), same "observe first, wire
 * consequences later" precedent Phase 5 set for the unionization metric
 * itself.
 */
export interface UnionEndorsement {
  _id: ObjectId;
  unionId: ObjectId;
  billId: ObjectId;
  stance: "endorse" | "oppose";
  createdAt: Date;
}

/** A character who spent personal funds organizing an unowned union — grants a leadership vote. */
export interface UnionOrganizer {
  _id: ObjectId;
  unionId: ObjectId;
  characterId: ObjectId;
  organizeCount: number;
  /** Anchor-equivalent ₳ spent across all organize actions. */
  totalSpent: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One organizer's vote for union president (one vote per organizer per union). */
export interface UnionLeaderVote {
  _id: ObjectId;
  unionId: ObjectId;
  voterCharacterId: ObjectId;
  candidateCharacterId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
