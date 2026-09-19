/**
 * Two-person-approval lifecycle for Send-to-Member + Transfer-to-State.
 *
 * When a party's `transactionApprovalMode === "double"` (the default),
 * the immediate transfer routes hand off to `createPendingTransaction`,
 * which writes a `pendingTreasuryTransactions` row with the proposer's
 * approval slot pre-filled. The missing slot is filled by an explicit
 * Approve click from the eligible role-holder; on Approve, the
 * underlying transfer executes atomically. Proposer may cancel before
 * the second approval; rows past `PENDING_TXN_EXPIRY_TURNS` are
 * swept to `"expired"` (no execution).
 *
 * The two slots are NOT role-typed. Any officer — Chair, Vice-Chair or
 * Treasurer — may fill either one; the only rules are that the two
 * signatures come from two DIFFERENT characters, and that a Request
 * Funds row is never signed by its own requester. The slots were
 * originally Treasurer-then-Chair/VC, which meant a party whose
 * Treasurer seat was empty could not run two-person approval at all
 * even with a Chair and a Vice-Chair sitting ready to sign.
 *
 * The stored fields are still named `treasurerApproval` and
 * `leadershipApproval`. They are now simply slot 1 and slot 2; renaming
 * them would be a migration over live rows for no behavioural gain.
 *
 * See `docs/plans/archive/2026-05/2026-05-22-treasury-two-person-approval.md`.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PendingTreasuryTransaction, PoliticalParty } from "@/lib/db/types";
import { PENDING_TXN_EXPIRY_TURNS } from "./proposalConstants";

// ─── Slot model ──────────────────────────────────────────────────────────────

/**
 * The two approval slots on a pending row, in fill order. `first` is
 * stored in `PendingTreasuryTransaction.treasurerApproval` and `second`
 * in `leadershipApproval` — historical field names, kept to avoid a
 * migration. Neither slot is tied to a particular seat.
 */
export type ApproverSlot = "first" | "second";

/** Which stored field backs each slot. */
const SLOT_FIELD = {
  first: "treasurerApproval",
  second: "leadershipApproval",
} as const satisfies Record<
  ApproverSlot,
  keyof Pick<PendingTreasuryTransaction, "treasurerApproval" | "leadershipApproval">
>;

/** The document field a slot writes to. */
export function approvalFieldForSlot(
  slot: ApproverSlot
): "treasurerApproval" | "leadershipApproval" {
  return SLOT_FIELD[slot];
}

type OfficerSeats = Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">;

/** True when the character holds any of the three officer seats. */
export function isPartyOfficer(party: OfficerSeats, characterId: ObjectId): boolean {
  return (
    !!party.chairId?.equals(characterId) ||
    !!party.viceChairId?.equals(characterId) ||
    !!party.treasurerId?.equals(characterId)
  );
}

/**
 * How many DIFFERENT characters hold officer seats.
 *
 * Counted by identity, not by seat: one person holding both Chair and
 * Treasurer is one available signature, not two, and a rule that
 * counted seats would let them satisfy a two-person approval alone.
 *
 * `excluding` drops one character from the count, which is how Request
 * Funds asks "who could actually sign this?" - the requester never can.
 */
export function countSeatedOfficers(party: OfficerSeats, excluding?: ObjectId): number {
  const ids = new Set<string>();
  for (const id of [party.chairId, party.viceChairId, party.treasurerId]) {
    if (id && !(excluding && id.equals(excluding))) ids.add(id.toString());
  }
  return ids.size;
}

/**
 * The slot a proposer's own signature occupies on a brand-new row.
 * Always the first, since both slots are empty at that point. Returns
 * `null` for a non-officer. (Admins bypass the lifecycle entirely —
 * handled at the route layer, not here.)
 */
export function getProposerSlot(party: OfficerSeats, characterId: ObjectId): ApproverSlot | null {
  return isPartyOfficer(party, characterId) ? "first" : null;
}

/**
 * The slot that still needs an approval on the given row. Returns
 * `null` when both slots are already filled (caller should execute).
 */
export function getMissingSlot(
  row: Pick<PendingTreasuryTransaction, "treasurerApproval" | "leadershipApproval">
): ApproverSlot | null {
  if (!row.treasurerApproval) return "first";
  if (!row.leadershipApproval) return "second";
  return null;
}

/**
 * Validates the party has the seats required to run the two-person
 * workflow at all: two DIFFERENT officers, in any combination of the
 * three seats. Fewer than two and there is nobody to provide the
 * second signature, so the propose is rejected rather than silently
 * falling back to one approver.
 */
export function canProposePendingTransaction(
  party: OfficerSeats
): { ok: true } | { ok: false; reason: string } {
  if (countSeatedOfficers(party) < 2) {
    return {
      ok: false,
      reason:
        "Two-person approval needs two different officers seated. Fill another of Chair, Vice-Chair or Treasurer.",
    };
  }
  return { ok: true };
}

/**
 * Validates the party has the seats required to legitimately run a
 * Request Funds workflow: one eligible approver in single mode, two in
 * double. "Eligible" excludes the requester, who may never sign their
 * own request. Counting them used to let a party queue a request that
 * no combination of officers could ever complete, leaving it to sit
 * until the expiry sweep.
 *
 * Request Funds (per the 2026-05-23 spec) is open to any party member;
 * eligibility is about whether there's ANYONE who could approve, not
 * whether the proposer holds an officer seat.
 */
export function canRequestFunds(
  party: OfficerSeats,
  mode: "single" | "double",
  /**
   * The requester. Excluded from the count of who could approve, since
   * nobody may sign their own Request Funds. Omitted by legacy callers,
   * which then get the old "is anyone seated at all" answer.
   */
  requesterCharacterId?: ObjectId
): { ok: true } | { ok: false; reason: string } {
  const eligibleApprovers = countSeatedOfficers(party, requesterCharacterId);
  const needed = mode === "double" ? 2 : 1;
  if (eligibleApprovers < needed) {
    return {
      ok: false,
      reason:
        mode === "double"
          ? "This request needs two different officers to approve it, and this party does not have two who could. Ask an officer to send the funds directly, or wait until another seat is filled."
          : "Request Funds needs an officer other than you to approve it. None of the Treasurer, Chair or Vice-Chair seats is filled by someone else.",
    };
  }
  return { ok: true };
}

/**
 * Resolves the approval mode a party's treasury actions actually run
 * under right now. The configured mode is `transactionApprovalMode`
 * (default "double"), but two people can only sign while two different
 * officers are seated. Below that, double collapses to "single" so the
 * lone officer is not permanently locked out of the treasury.
 *
 * It used to collapse whenever the TREASURER seat specifically was
 * empty, which dropped a Chair-plus-Vice-Chair party to one signature
 * even though two people were sitting there able to give two.
 *
 * Single mode is returned unchanged.
 */
export function resolveTransactionApprovalMode(
  party: Pick<PoliticalParty, "transactionApprovalMode"> & OfficerSeats
): "single" | "double" {
  const configured = party.transactionApprovalMode ?? "double";
  if (configured === "double" && countSeatedOfficers(party) < 2) return "single";
  return configured;
}

/**
 * Returns whether the row has accumulated enough approvals to execute,
 * taking the row's recorded approval mode into account.
 *
 * - "send" / "transfer": always require both slots filled (only created
 *   in double mode).
 * - "request" + single mode: any one slot filled is enough.
 * - "request" + double mode: both slots filled.
 *
 * Pure read — no DB access. Callers re-fetch after a write to pass the
 * latest row in.
 */
export function isPendingTransactionComplete(
  row: Pick<
    PendingTreasuryTransaction,
    "type" | "approvalModeAtPropose" | "treasurerApproval" | "leadershipApproval"
  >
): boolean {
  const mode = row.approvalModeAtPropose ?? "double";
  if (row.type === "request" && mode === "single") {
    return !!(row.treasurerApproval || row.leadershipApproval);
  }
  return !!(row.treasurerApproval && row.leadershipApproval);
}

/**
 * Returns the slot the given character would fill if they clicked
 * Approve on the row: simply the next empty one. Returns null when:
 *   - they hold no Chair / Vice-Chair / Treasurer seat
 *   - they have already signed this row (one person, one signature)
 *   - the row is a Request Funds row AND they're the requester
 *     (self-approval forbidden per the 2026-05-23 spec)
 *   - both slots are already filled
 *
 * The approve route still does the atomic claim with
 * `[slotField]: { $exists: false }`, so a stale read here is harmless.
 */
export function getApproverSlotForRow(
  party: OfficerSeats,
  row: Pick<
    PendingTreasuryTransaction,
    "type" | "proposedBy" | "treasurerApproval" | "leadershipApproval"
  >,
  characterId: ObjectId
): ApproverSlot | null {
  if (row.type === "request" && row.proposedBy.equals(characterId)) {
    return null;
  }
  if (!isPartyOfficer(party, characterId)) return null;
  // Two signatures means two people. With the slots no longer tied to
  // separate seats, nothing else stops one officer signing both halves,
  // so it has to be said here.
  const alreadySigned =
    !!row.treasurerApproval?.characterId.equals(characterId) ||
    !!row.leadershipApproval?.characterId.equals(characterId);
  if (alreadySigned) return null;
  return getMissingSlot(row);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export interface CreatePendingTransactionInput {
  party: Pick<PoliticalParty, "_id" | "countryId" | "chairId" | "viceChairId" | "treasurerId">;
  proposerCharacterId: ObjectId;
  /**
   * "send" / "transfer" only ever flow through this helper in DOUBLE
   * mode (single mode executes immediately, never creates a pending
   * row). "request" flows through in BOTH modes — `mode` controls the
   * approval-completion check.
   */
  type: "send" | "transfer" | "request";
  /**
   * Party's `transactionApprovalMode` at the moment of propose. Stored
   * on the row so a mid-flight mode toggle doesn't change the rules
   * for already-pending rows. Defaults to "double" for legacy callers.
   */
  mode?: "single" | "double";
  amount: number;
  /** Required when type === "send" or "request" (request → proposer). */
  targetCharacterId?: ObjectId;
  /** Required when type === "transfer". Uppercased state ID. */
  targetStateId?: string;
  note?: string;
}

/**
 * Inserts a `pendingTreasuryTransactions` row with the proposer's slot
 * pre-filled. Returns the inserted row (with `_id` populated).
 *
 * Callers must validate balance + target existence BEFORE invoking
 * this — `createPendingTransaction` does no balance check; the actual
 * debit happens only at approve time.
 *
 * Throws if the party doesn't satisfy `canProposePendingTransaction`
 * or if the proposer doesn't hold an approver role.
 */
export async function createPendingTransaction(
  db: Db,
  input: CreatePendingTransactionInput,
  currentTurn: number
): Promise<PendingTreasuryTransaction> {
  const mode = input.mode ?? "double";
  const isRequest = input.type === "request";

  // Eligibility check differs by row type:
  //   - send/transfer (always double mode): need Treasurer + (Chair OR VC)
  //   - request: need ≥ 1 officer (single mode) or full set (double mode)
  const eligibility = isRequest
    ? canRequestFunds(input.party, mode, input.proposerCharacterId)
    : canProposePendingTransaction(input.party);
  if (!eligibility.ok) {
    throw new Error(eligibility.reason);
  }

  // Send/Transfer: proposer must hold an officer seat (auto-fills their
  // slot). Request: proposer is just a party member; no auto-fill.
  let treasurerApproval: PendingTreasuryTransaction["treasurerApproval"];
  let leadershipApproval: PendingTreasuryTransaction["leadershipApproval"];
  const now = new Date();
  if (!isRequest) {
    const slot = getProposerSlot(input.party, input.proposerCharacterId);
    if (slot == null) {
      throw new Error("Only the Treasurer, Chair, or Vice-Chair can propose treasury actions.");
    }
    const approval = { characterId: input.proposerCharacterId, approvedAt: now };
    treasurerApproval = slot === "first" ? approval : undefined;
    leadershipApproval = slot === "second" ? approval : undefined;
  }

  // Build the doc with conditional spreads for slot fields. Writing
  // `treasurerApproval: undefined` would land in Mongo as a literal
  // `null` (mongodb driver's BSON serializer defaults to
  // `ignoreUndefined: false`), which then breaks the approve route's
  // `{ $exists: false }` atomic claim. Omitting the key entirely lets
  // the guard match.
  const doc: Omit<PendingTreasuryTransaction, "_id"> = {
    partyId: input.party._id,
    countryId: input.party.countryId,
    type: input.type,
    amount: input.amount,
    ...(input.targetCharacterId !== undefined && {
      targetCharacterId: input.targetCharacterId,
    }),
    ...(input.targetStateId !== undefined && { targetStateId: input.targetStateId }),
    ...(input.note !== undefined && { note: input.note }),
    proposedBy: input.proposerCharacterId,
    proposedAtTurn: currentTurn,
    proposedAt: now,
    expiresAtTurn: currentTurn + PENDING_TXN_EXPIRY_TURNS,
    approvalModeAtPropose: mode,
    ...(treasurerApproval !== undefined && { treasurerApproval }),
    ...(leadershipApproval !== undefined && { leadershipApproval }),
    status: "open",
  };

  const result = await db
    .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
    .insertOne(doc as PendingTreasuryTransaction);

  return { ...(doc as PendingTreasuryTransaction), _id: result.insertedId };
}

/**
 * Cancels a pending row. Only the original proposer (`proposedBy`) may
 * cancel. Returns `true` if the row was cancelled, `false` if it was
 * already resolved (the atomic guard prevents double-cancel and lost-
 * race with approve).
 */
export async function cancelPendingTransaction(
  db: Db,
  txnId: ObjectId,
  cancellerCharacterId: ObjectId
): Promise<boolean> {
  const result = await db
    .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
    .updateOne(
      { _id: txnId, status: "open", proposedBy: cancellerCharacterId },
      { $set: { status: "cancelled", resolvedAt: new Date() } }
    );
  return result.matchedCount === 1;
}

/**
 * Sweeps open pending rows past their expiry turn. Marks them
 * `"expired"` (no execution, no balance change). Returns the number
 * marked. Idempotent — calling twice in the same turn is a no-op on
 * the second call.
 *
 * Intended to be invoked from the per-turn phase that already runs
 * `expireOpenProposals` for CommitteeProposal — they share the same
 * turn-window cadence.
 */
export async function expirePendingTransactions(db: Db, currentTurn: number): Promise<number> {
  const now = new Date();
  const result = await db
    .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
    .updateMany(
      { status: "open", expiresAtTurn: { $lte: currentTurn } },
      { $set: { status: "expired", resolvedAt: now, resolvedAtTurn: currentTurn } }
    );
  return result.modifiedCount;
}

// ─── Read helpers ────────────────────────────────────────────────────────────

/**
 * Returns the open pending rows for a party, newest first. Used by the
 * Treasury tab's "Pending Transactions" section.
 */
export async function listOpenPendingTransactions(
  db: Db,
  partyId: ObjectId,
  countryId: CountryId
): Promise<PendingTreasuryTransaction[]> {
  return db
    .collection<PendingTreasuryTransaction>("pendingTreasuryTransactions")
    .find({ partyId, countryId, status: "open" })
    .sort({ proposedAt: -1 })
    .toArray();
}
