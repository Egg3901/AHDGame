import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * A caucus (a.k.a. faction) is an opt-in sub-grouping within a single national party.
 * Caucuses are a national-only concept — state and regional party chapters do not own them.
 *
 * The chair sets policy positions, a campaign-fund tax (0–5%), and a default whip mode.
 * Caucus chair elections ride the same turn cadence as the party leadership election.
 */
export type CaucusWhipMode = "free" | "soft" | "hard";

export interface Caucus {
  _id: ObjectId;
  /**
   * URL slug, unique among ACTIVE caucuses within a (countryId, partyId) pair.
   * Editable by the chair via rename. On rename, the current slug is pushed onto
   * `previousSlugs`; lookups against any previous slug 308-redirect to the
   * current slug.
   */
  slug: string;
  /**
   * Slugs this caucus used to hold but renamed away from. Used to redirect old
   * links to the current slug. **Reclaimable:** if another caucus in the same
   * party later founds with (or renames to) one of these slugs, that slug must
   * be removed from this caucus's `previousSlugs` so the new caucus owns the
   * URL going forward. The reclaim sweep runs in any write path that creates
   * or activates a slug claim (found, rename, restore-from-disbanded).
   */
  previousSlugs: string[];
  countryId: CountryId;
  /** PoliticalParty.sequentialId as a string — matches the same encoding used elsewhere. */
  partyId: string;

  name: string;
  description: string;
  /** Hex color (e.g. "#d04848") used for the caucus badge / charts. */
  color: string;

  /** Caucus chair: a player Character's _id. Null while the seat is vacant. */
  chairId: ObjectId | null;
  /** Caucus vice-chair: a player Character's _id. Null while vacant. */
  viceChairId: ObjectId | null;

  /** Default whip posture applied to caucus whips unless a per-bill override is set. */
  whipMode: CaucusWhipMode;

  /**
   * Caucus treasury (currency-units, same as PoliticalParty.treasury).
   * Funded primarily by the chair-set tax against member campaign funds.
   */
  treasury: number;

  /**
   * Per-turn campaign-fund levy on each member, 0–5 (percent). Set by the chair.
   * Rates above 4% incur a small per-turn loyalty hit on members.
   */
  taxRate: number;

  /**
   * Caucus chair elections ride the party-leadership cycle. The turn processor
   * checks `nextElectionTurn` and re-elects the chair on the same tick that the
   * parent party holds its leadership election.
   */
  lastElectedTurn: number | null;
  nextElectionTurn: number | null;

  /** Number of caucus chair terms served. Useful for term-limit history surfaces. */
  termsServed: number;

  /** Cosmetic — set by chair, surfaced in caucus header / list. */
  motto?: string;
  /** Public-facing Discord invite set by the chair for the caucus header. */
  discordInviteUrl?: string | null;

  /** Soft delete flag for disbanded caucuses (kept for historical references). */
  disbandedAt: Date | null;

  createdBy: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Per-member record for a caucus. One row per (caucusId, memberId) pair.
 * `memberType` distinguishes player Characters from NPPs since the two collections
 * live separately and player members are advisory targets for caucus whips.
 */
export type CaucusMemberType = "character" | "npp";
export type CaucusMemberRole = "chair" | "vice-chair" | "whip" | "member";
export type CaucusMembershipStatus = "invited" | "active" | "left" | "removed";

export interface CaucusMembership {
  _id: ObjectId;
  caucusId: ObjectId;
  /** Denormalized for fast filtering — same value as caucus.countryId / partyId. */
  countryId: CountryId;
  partyId: string;

  memberType: CaucusMemberType;
  /** Character._id when memberType="character"; NPP._id when memberType="npp". */
  memberId: ObjectId;

  role: CaucusMemberRole;
  status: CaucusMembershipStatus;

  /** When the invitation was sent (or null for self-join paths). */
  invitedAt: Date | null;
  /** When the member accepted / joined. Null until status="active". */
  joinedAt: Date | null;
  /**
   * Turn-based mirror of `joinedAt` (set on recruit). The NPP-recruit cooldown
   * resolves against this so it freezes on pause and doesn't drift with the
   * game clock; the Date is kept for display + legacy fallback.
   */
  joinedAtTurn?: number | null;
  /** When the member left or was removed. Null while status="active". */
  leftAt: Date | null;

  /**
   * Rolling compliance score 0–100 — share of recent caucus whips this member
   * complied with. Updated by the turn processor / vote resolver. -1 sentinel
   * means "no whips on record yet."
   */
  complianceScore: number;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * A caucus's stated policy position on a topic. Chair-edited only.
 *
 * `weight: "core"` positions act as recruitment magnets and earn a per-bill
 * compliance bonus when whips align with them. `weight: "secondary"` positions
 * are advisory — they appear on the caucus page but do not modify whip math.
 */
export type CaucusPositionWeight = "core" | "secondary";

export interface CaucusPolicyPosition {
  _id: ObjectId;
  caucusId: ObjectId;
  /** Free-form topic label (e.g. "Federal spending", "Tax policy"). Chair-authored. */
  topic: string;
  /** Free-form stance label (e.g. "Hard cut", "Single-payer"). Chair-authored. */
  stance: string;
  /** Optional one-line elaboration shown beneath the stance. */
  note: string;
  weight: CaucusPositionWeight;
  /** Display order — lower sorts first. Chair can drag-reorder in Phase 2 UI. */
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
