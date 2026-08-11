import { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  OfficeType,
  PolicyPositions,
  CharacterDemographics,
  CareerEvent,
} from "@/lib/db/types/character";
import type { GameIteration } from "@/lib/db/types/gameState";
import type { CharacterRecap } from "@/lib/recap/types";

export interface RetiredCharacterSnapshot {
  name: string;
  countryId: CountryId;
  homeState: string;
  party: string;
  partyName: string;
  currentOffice: OfficeType | null;
  policies: PolicyPositions;
  demographics?: CharacterDemographics;
  stats: {
    politicalInfluence: number;
    nationalInfluence?: number;
    partyInfluence?: number;
    favorability: number;
    infamy: number;
    funds: number;
    cashOnHand?: number;
    /** Savings balance in the character's home currency — used with cashOnHand for net worth. */
    savingsOnHand?: number;
    /**
     * Total value of held corporation shares, bonds, and index-fund
     * positions, each pre-converted to internal anchor units (₳) — captured
     * right before `retireCharacter` releases those holdings back to their
     * respective floats, since the release is irreversible and this is the
     * only chance to record what they were worth. Absent/0 on snapshots
     * taken before this field existed (net worth undercounts for those —
     * the value was already released with no record by the time this field
     * was added, unrecoverable).
     */
    shareValueAnchor?: number;
    bondValueAnchor?: number;
    indexFundValueAnchor?: number;
  };
  avatarUrl?: string;
  profileHeaderImageUrl?: string;
  bio?: string;
  careerHistory?: CareerEvent[];
  /**
   * Label only — computed by `deriveHighestOffice` at retirement time and
   * frozen from then on. Don't trust this for scoring/ranking: a past bug in
   * that function (ticket #991) credited losing candidates with offices they
   * only ran for, and snapshots taken before the fix still carry the stale
   * wrong label forever. Re-derive live from `careerHistory`/`currentOffice`
   * (both present on this same snapshot) wherever correctness matters.
   */
  highestOffice?: string;
  achievementCount: number;
  createdAt: Date;
}

export interface RetiredCharacter {
  _id: ObjectId;
  userId: ObjectId;
  characterId: ObjectId;
  retiredAt: Date;
  reason: "player_deleted" | "game_reset" | "admin_action";
  snapshot: RetiredCharacterSnapshot;
  /** Season this life belonged to (outgoing iteration at retirement). */
  iteration?: GameIteration;
  /** Frozen Season Recap ("Wrapped") payload — present when seasonRecapEnabled. */
  recap?: CharacterRecap;
  /**
   * One-time "seen" stamp for the post-reset recap gate. Absent = unviewed
   * (the gate surfaces it on next login); set once the player finishes/dismisses.
   */
  recapViewedAt?: Date;
}
