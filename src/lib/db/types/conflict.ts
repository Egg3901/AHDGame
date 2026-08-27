import type { CountryId } from "@/lib/constants/countries";
import type { RegionCode } from "@/lib/military/types";
import type { WarGoal } from "@/lib/military/warGoals";
import type { WorldEntityId } from "@/lib/world/worldEntityManifest";
import type { PeaceTerm } from "@/lib/military/peaceTerm";

/**
 * A conflict — a dynamic, first-class battleground that generalizes the retired
 * static theaters. Created at runtime (player declaration or event); the world starts
 * with none. The whole W1–W10 military system runs on conflicts exactly as it ran on
 * the 4 hardcoded theaters: units deploy to one (`unit.theaterId` = a conflict id),
 * generals command it, battles resolve at it, supply/commitment track per it.
 *
 * Spec: docs/superpowers/specs/2026-07-23-conflict-model-sub-a-design.md
 */

export type ConflictType =
  | "interstate"
  | "intervention"
  | "civil_war"
  | "independence"
  /** A proxy war fought on third-party soil; the sides are internal factions. */
  | "cold_war";
/**
 * `terms_pending` is a WON war that has not ended yet: the front has reached a pole,
 * every belligerent has stood down, and the victor holds a window in which to impose
 * one term. It is deliberately NOT "resolved", so every reader that treats a live war
 * as `status !== "resolved"` keeps counting it, and no second war can be declared
 * between the same pair while terms are outstanding.
 */
export type ConflictStatus =
  "active" | "escalating" | "winding_down" | "terms_pending" | "resolved";
export type SideKind = "state" | "coalition" | "generated";
export type ConflictBloc = "west" | "east" | "internal" | "contested";

export interface ConflictSide {
  /** Display label, e.g. "Insurgent Bloc" / "Government" / "United States". */
  label: string;
  /** Real belligerents whose units fight on this side; `[]` = a generated force. */
  countries: CountryId[];
  kind: SideKind;
  /** Cold War patron, if any. */
  backer?: "west" | "east";
  /**
   * Faction sides only: the world entity this faction represents.
   *
   * This is the DECLARABLE TARGET — `belligerentSideOf` and `sideOf` match it, so a
   * player declares on "North Vietnam" rather than needing a side-addressed mode. It
   * must never collide with a real CountryId: the admin creation route enforces that,
   * and the fog resolver's safety depends on it.
   */
  factionEntity?: WorldEntityId;
  /**
   * Faction sides only: the weight of the token force it brings. Small by design.
   * Decremented by its casualties and floored at zero; at zero the side is a walkover.
   */
  tokenStrength?: number;
}

/**
 * One country pulled into a war by a mutual-defence treaty, and who it came for.
 *
 * `defending` is the load-bearing field: it is what the separate-peace bar reads to
 * decide whether this country may still buy its way out, and what release reads to
 * decide who leaves when that country settles. Without it an auto-joined ally is
 * indistinguishable from one that declared war itself.
 */
export interface TreatyEntry {
  countryId: CountryId;
  /** The alliance that bound it, e.g. "NATO" / "WARSAW_PACT". */
  organizationId: string;
  /** The member this country was pulled in to defend. */
  defending: CountryId;
  joinedTurn: number;
}

export interface ConflictDoc {
  /** Dynamic conflict id (a unit's `theaterId` holds this, or "reserve"). */
  _id: string;
  /**
   * Sequential public number, 1-based per iteration — the conflict's address at
   * /world/conflicts/<conflictId>. Distinct from `_id`, which is the internal
   * theater key that units, declarations, reports and assignments all reference
   * and therefore cannot be renumbered.
   */
  conflictId: number;
  name: string;
  /**
   * Where it's fought — the map anchor. May not be a belligerent.
   *
   * WorldEntityId, not CountryId: a proxy war is hosted in a third-party state the game
   * does not implement as playable (NVN, SVN, KR). Same widening `OrgMemberId` already
   * made for org membership. `WorldEntityId` is `string`, so there is no compile-time
   * check left — validation lives at the admin creation route, the only writer.
   */
  hostCountry: WorldEntityId;
  /** Derived from the host country (map / regionThreat). */
  region: RegionCode;
  type: ConflictType;
  sideA: ConflictSide;
  sideB: ConflictSide;
  /** Cold War alignment of the conflict as a whole. */
  bloc: ConflictBloc;
  /**
   * Countries pulled in by a mutual-defence treaty. Optional, so every conflict
   * created before this feature reads as `undefined` and needs no migration.
   */
  treatyEntries?: TreatyEntry[];

  // Generated at birth (was hardcoded across BOTH old static datasets — the Theater
  // situation flavor AND the combat.ts Front battle-math data):
  terrain: string;
  /**
   * Whether this front reaches the sea. Absent means derive it from the host's
   * geography (`deriveSeaAccess`); set it only to override that, which is the case of a
   * war fought inland in a country that does have a coast.
   */
  seaAccess?: boolean;
  severity: "HIGH" | "MEDIUM" | "LOW";
  /** The generated side's weight (= old Theater.enemyBase). */
  baseStrength: number;
  /** Per-side supply, 0–100 (was Theater wSup/eSup). */
  supplyA: number;
  supplyB: number;
  /** Terrain combat factor — the defender/enemy strength multiplier (was Front.terr). */
  terr: number;
  /** Supply throughput baseline, 0–100 (was Front.infra). */
  infra: number;
  /** Enemy-unit composition for buildEnemy when a side is generated (was ENEMY_MIX). */
  enemyMix: string[];

  // Live state (seeded here; evolved by sub-project C):
  intensity: number;
  /**
   * First consecutive turn below the hot-war threshold used by Cold War
   * tension. Cleared while the war is hot, then restarted when it cools, so
   * hot turns never count toward public acclimation.
   */
  limitedWarSinceTurn?: number;
  /**
   * Share of the HOST country's territory held by side B: 0 = side A holds all of
   * it, 100 = side B holds all of it. Moved by battles; reaching a pole ends the war.
   * See src/lib/military/occupation.ts.
   */
  control: number;
  /** `control` at creation — the front's starting line. Supply is derived from the
   *  displacement from here, so it must not be recomputed from the (growing) rosters. */
  controlStart?: number;
  /** Seeded supply values, preserved so live supply can be derived, not accumulated. */
  supplyBaseA?: number;
  supplyBaseB?: number;
  /**
   * Trailing `control` reading, for the war-effort momentum term.
   *
   * Refreshed by `applyOccupation` once it is older than the momentum window.
   * Absent means "no history yet", which scores momentum at zero rather than
   * undefined — the provider derives a default and never requires this field.
   */
  controlSample?: { turn: number; control: number };
  /**
   * When each belligerent entered, and where the front stood at the time.
   *
   * Written by `joinSide`, so BOTH the treaty path and the declare-into-an-
   * existing-war path record one; `treatyEntries` covers only the former and is
   * not a complete entry ledger. Founding belligerents are absent and fall back
   * to `startTurn` / `controlStart`.
   *
   * `control` is what keeps a late joiner from inheriting the war record its
   * side built before it arrived: war effort is scored from the front as it
   * stood when THIS country entered, not from the conflict's opening line.
   */
  joinTurns?: Array<{ countryId: CountryId; turn: number; control: number }>;
  status: ConflictStatus;
  /**
   * Every third-party country in the theatre — the roster that changes bloc when the
   * war resolves. `hostCountry` stays the single map anchor. Read through
   * `hostEntitiesOf`, never directly: absent must mean "just the anchor".
   */
  hostEntities?: WorldEntityId[];
  /**
   * `cold_war`: which side currently holds 100% of the host territory.
   *
   * Nullable, not merely optional: a front pushed back off the pole is explicitly
   * CLEARED to null, and "the hold was broken" is a state worth storing rather than
   * an absence worth inferring.
   */
  poleSide?: "A" | "B" | null;
  /** `cold_war`: the turn that side reached the pole. Cleared if it comes off. */
  poleSinceTurn?: number | null;
  /** What this war was declared for. Absent on conflicts predating declarations. */
  warGoal?: WarGoal;
  /** The bill that declared it, for the record page. */
  declaredByBillId?: string;
  /**
   * Set when the front reaches a pole and the victor may impose one term.
   *
   * Cleared implicitly by the war resolving: a resolved conflict's window is spent
   * whether it was used or it lapsed.
   */
  termsWindow?: {
    victor: "A" | "B";
    /** Founding belligerent of the winning side. The ONLY country that may impose. */
    imposer: CountryId;
    /** Founding belligerent of the losing side. The country the term lands on. */
    target: CountryId;
    /** Lapses ON this turn, the same boundary convention as an offer and a truce. */
    closesTurn: number;
  };
  /**
   * The term a settlement took, once one is reached. Read by the news wire, which
   * builds its copy from this rather than parsing the outcome prose.
   *
   * Absent on a war that ended with no terms, which includes every war resolved
   * before this feature and every lapsed window.
   */
  settlement?: {
    term: PeaceTerm;
    /** "dictated" via a war won outright, "negotiated" via an accepted offer. */
    path: "dictated" | "negotiated";
    imposedBy: CountryId;
    target: CountryId;
    turn: number;
  };
  /**
   * Wire dispatches already filed for this conflict, so each posts exactly once.
   *
   * The STAMP, not the state, is what makes a one-off post one-off: a settled war
   * stays settled for ever, and a sweeper keyed on the state alone would repost it
   * every tick.
   */
  postedWireEvents?: string[];
  createdBy: "player" | "event" | "seed";
  startTurn: number;
  endTurn?: number;
  outcome?: { winner: "A" | "B" | "stalemate"; note: string };
}
