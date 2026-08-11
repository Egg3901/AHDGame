import type { ObjectId } from "mongodb";
import type { CountryId } from "../../constants/countries";

/**
 * Pending row for a treasury action that requires two-person approval.
 *
 * Written by `POST /api/country/[code]/parties/[id]/send` and
 * `.../transfer` when the party's `transactionApprovalMode === "double"`.
 * Held open until the missing approval slot is filled (Approve flow) or
 * the proposer cancels / the row expires.
 *
 * Approver 1 (`treasurerApproval`) must be the Treasurer. Approver 2
 * (`leadershipApproval`) must be the Chair OR Vice-Chair (the latter via
 * the acting-chair helper). The proposer auto-fills whichever slot
 * matches their role.
 *
 * See `docs/plans/archive/2026-05/2026-05-22-treasury-two-person-approval.md`.
 */
export interface PendingTreasuryTransaction {
  _id: ObjectId;
  partyId: ObjectId;
  countryId: CountryId;
  /**
   * - "send" — Send to Member (officer-initiated, party treasury → member)
   * - "transfer" — Transfer to State Party (officer-initiated)
   * - "request" — Request Funds (member-initiated, party treasury → requester)
   */
  type: "send" | "transfer" | "request";
  amount: number;
  /**
   * For type === "send": target character _id (the recipient).
   * For type === "request": the requester (= proposedBy) — recipient is
   *   the proposer themselves. Stored explicitly so the executor and
   *   audit log don't have to special-case the recipient lookup.
   */
  targetCharacterId?: ObjectId;
  /** For type === "transfer": target state ID (uppercased). */
  targetStateId?: string;
  /** Optional note from the proposer. */
  note?: string;
  proposedBy: ObjectId;
  proposedAtTurn: number;
  proposedAt: Date;
  /** proposedAtTurn + PENDING_TXN_EXPIRY_TURNS */
  expiresAtTurn: number;
  /**
   * Party's `transactionApprovalMode` AT THE TIME OF PROPOSE. Pending
   * rows finish in their original mode even if the party toggles mid-
   * flight. Only meaningful for type === "request" (send/transfer only
   * create rows in "double" mode); for those, this field is also
   * "double" for consistency.
   *
   * Absent value on legacy rows is treated as "double".
   */
  approvalModeAtPropose?: "single" | "double";
  /**
   * Treasurer slot. Filled when proposer is treasurer OR when treasurer
   * clicks Approve. For type === "request" the requester NEVER fills
   * this slot, even if they hold the Treasurer seat (user-confirmed
   * 2026-05-23: no auto-approvals for Request Funds).
   */
  treasurerApproval?: { characterId: ObjectId; approvedAt: Date };
  /**
   * Chair/VC slot. Filled when proposer is chair/VC OR when chair/VC
   * clicks Approve. VC fills this slot whether acting-as-chair or not —
   * the slot accepts both seats interchangeably. Same self-exclusion
   * for type === "request" as the treasurer slot.
   */
  leadershipApproval?: { characterId: ObjectId; approvedAt: Date };
  status: "open" | "approved" | "cancelled" | "expired";
  resolvedAt?: Date;
  resolvedAtTurn?: number;
}
