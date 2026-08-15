import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/** Axes a position shift can be proposed on. Both are read by the engines. */
export type PositionShiftAxis = "economic" | "social";

/**
 * Axes retired in ticket #1032. They were written by seeds, charters and
 * the shift UI but never read by any gameplay mechanic, so players could
 * spend a committee vote and a 336-turn cooldown for no effect. Retained
 * only so historical proposals stay describable and renderable.
 */
export type RetiredPositionShiftAxis = "foreignPolicy" | "culture";

export interface CommitteeProposalVote {
  voterId: ObjectId;
  vote: "yes" | "no";
  votedAt: Date;
}

export interface CommitteeProposal {
  _id: ObjectId;
  type:
    | "rename"
    | "positionShift"
    | "merge"
    | "electionMethod"
    | "electionDuration"
    | "removeOfficeHolder"
    | "transactionApprovalMode"
    | "campaignerAppointment";
  status: "open" | "passed" | "rejected" | "expired";
  /** Always the proposing party's ObjectId */
  partyId: ObjectId;
  countryId: CountryId;
  /** characterId of the member who created the proposal */
  proposedBy: ObjectId;
  createdAtTurn: number;
  /** createdAtTurn + 24 */
  expiresAtTurn: number;
  resolvedAtTurn?: number;
  createdAt: Date;
  updatedAt: Date;

  /** Populated for type === "rename" */
  rename?: { newName: string; newAbbreviation: string };
  /**
   * Populated for type === "positionShift".
   *
   * Only `economic | social` can be proposed — those are the axes the
   * engines actually read. A 2026-05-22 redesign also offered
   * `foreignPolicy` and `culture`, but nothing ever consumed them, so
   * they were retired (ticket #1032). Rows created before that retirement
   * still carry the old values, so the stored type stays wide enough to
   * describe them honestly; creation is narrowed by the zod schema and
   * `applyPositionShiftEffect` refuses them. Each axis has its own
   * 336-turn cooldown via `PoliticalParty.positionShiftCooldowns`.
   */
  positionShift?: {
    axis: PositionShiftAxis | RetiredPositionShiftAxis;
    direction: 1 | -1;
  };
  /** Populated for type === "merge" */
  merge?: { targetPartyId: ObjectId };
  /** Populated for type === "electionMethod" */
  electionMethod?: { method: "party" | "committee" | "influence" };
  /** Populated for type === "electionDuration" */
  electionDuration?: { durationTurns: number };
  /**
   * Populated for type === "removeOfficeHolder".
   *
   * Vacates a specific elected seat on the party. The chair-appointed
   * `treasurer` slot is also removable here (tickets #1100, #285): a
   * treasurer who wins their seat unopposed cannot otherwise be
   * dislodged, so the committee can vacate it and force a re-appointment
   * or fresh election.
   *
   * `campaigner` pulls the target from `campaignerIds`. Campaigners are
   * chair-nominated but committee-confirmed, so the committee can strip
   * the seat back out without the chair's consent. The chair can also
   * fire a campaigner instantly via the campaigners route.
   *
   * The target character is excluded from the voter set for this
   * proposal (procedural fairness — you can't vote on your own
   * removal). The effect handler clears `chairId` / `viceChairId` to
   * null, or pulls the target from `committeeIds`. No auto-promotion
   * follows; the VC inherits chair authority via the acting-chair
   * helper when chair is vacated.
   */
  removeOfficeHolder?: {
    role: "chair" | "viceChair" | "treasurer" | "committeeMember" | "campaigner";
    targetCharacterId: ObjectId;
  };
  /**
   * Populated for type === "campaignerAppointment".
   *
   * Chair nominates a party member for a Campaigner seat; the National
   * Committee confirms. On pass the target is added to
   * `PoliticalParty.campaignerIds` (membership and the
   * `MAX_NATIONAL_CAMPAIGNERS` cap are re-checked at resolution, so a
   * nomination that passes late can still no-op).
   *
   * The nominee is excluded from the voter set — you don't confirm
   * yourself. Unlike every other proposal type, several may be open at
   * once (one per nominee) and no cooldown is set on pass; the chair
   * has to be able to fill vacated slots immediately.
   */
  campaignerAppointment?: { targetCharacterId: ObjectId };
  /**
   * Populated for type === "transactionApprovalMode".
   *
   * Toggles `PoliticalParty.transactionApprovalMode` between "single"
   * (auto-approve on propose, immediate execute) and "double"
   * (Treasurer + Chair/VC approval workflow via
   * `pendingTreasuryTransactions`). The currently-active mode is
   * disallowed in the proposal modal — only the opposite mode is
   * selectable.
   */
  transactionApprovalMode?: { mode: "single" | "double" };

  /** Proposing committee votes — used by all proposal types */
  proposingVotes: CommitteeProposalVote[];
  /** Target committee votes — merge proposals only */
  targetVotes?: CommitteeProposalVote[];
}
