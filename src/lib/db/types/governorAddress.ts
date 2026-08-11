import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

/** Collection: "governorAddresses" */
export interface GovernorAddress {
  _id?: ObjectId;
  countryId: CountryId;
  stateId: string;
  deliveredByCharacterId: ObjectId;
  deliveredByName: string;
  deliveredAtTurn: number;

  /** Optional player-written title for the address. v2+; legacy rows may lack it. */
  title?: string;
  /** Optional LARP body text (player-written speech). 0-2000 chars. */
  body?: string;

  /** Categories the address emphasizes (1-2). v2 — legacy rows used
   *  `emphasizedLegislationTypeIds` (now deprecated, kept for back-compat). */
  emphasizedCategories?: string[];
  /** @deprecated v1 used legislation-type IDs; v2+ uses `emphasizedCategories`. */
  emphasizedLegislationTypeIds?: string[];

  /** Optional demographic group the address targets (e.g. "suburban_moderates").
   *  Always interpreted against the `voterGroups` modifier category. */
  targetDemographicGroupId?: string;
  /** Approval bump applied to governor approval for the duration window. */
  approvalEffect: {
    amount: number;
    expiresAtTurn: number;
    expired?: boolean;
  };

  /** Agenda bonus — bills in the emphasized categories get a cross-pressure
   *  nudge toward "for" from co-partisan NPPs until expiry. Read at vote time;
   *  no write-side action needed on expiry. v2+. */
  agendaEffect?: {
    partyId: string;
    expiresAtTurn: number;
  };

  /** Demographic turnout boost applied at delivery — added to
   *  `stateDemographicTurnout.modifiers.voterGroups[groupId]`. At expiry the
   *  turn phase subtracts the snapshotted delta back out. State-scope
   *  addresses use the scalar `turnoutDelta`; national-scope addresses use
   *  `turnoutDeltasByState` (per-state actual-applied delta after headroom
   *  clamp) so each state is reverted precisely. */
  demographicEffect: {
    /** Snapshot of the boost amount actually applied (for accurate revert).
     *  National addresses leave this at 0 and use `turnoutDeltasByState`. */
    turnoutDelta?: number;
    /** National addresses only. Per-state actual-applied delta map. Absent
     *  on state-scope addresses. */
    turnoutDeltasByState?: Record<string, number>;
    /** @deprecated v1 partisan favorability; v2 boosts non-partisan turnout. */
    partyId?: string;
    /** @deprecated v1 favorability delta; v2 uses `turnoutDelta`. */
    favorabilityDelta?: number;
    expiresAtTurn: number;
    expired?: boolean;
  };

  /** True when delivered via admin override rather than by the sitting leader.
   *  Costs were waived; surfaced for audit purposes. */
  adminProposed?: boolean;

  newsEventId?: ObjectId;
  createdAt: Date;
}
