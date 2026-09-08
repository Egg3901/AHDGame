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
 * Approver 1 = Treasurer (required as one of the two).
 * Approver 2 = Chair OR Vice-Chair (the slot accepts both
 *             interchangeably — VC fills it whether seated as chair or
 *             acting in the chair's absence).
 *
 * See `docs/plans/archive/2026-05/2026-05-22-treasury-two-person-approval.md`.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PendingTreasuryTransaction, PoliticalParty } from "@/lib/db/types";
import { PENDING_TXN_EXPIRY_TURNS } from "./proposalConstants";

// ─── Slot model ──────────────────────────────────────────────────────────────

/**
 * The two approval slots on a pending row. `treasurer` corresponds to
 * `PendingTreasuryTransaction.treasurerApproval`; `leadership` is the
 * Chair-or-VC slot stored in `leadershipApproval`.
 */
export type ApproverSlot = "treasurer" | "leadership";

/**
 * Returns the slot the given character would fill on a propose. Returns
 * `null` if the character isn't a Treasurer, Chair, or Vice-Chair on
 * this party. (Admins bypass the lifecycle entirely — handled at the
 * route layer, not here.)
 *
 * Note: when a character holds BOTH Treasurer AND Chair/VC (data
 * anomaly), Treasurer wins — they fill the Treasurer slot, and the
 * Chair/VC slot remains open. This is intentional: a single character
 * cannot satisfy both halves of a two-person approval.
 */
export function getProposerSlot(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  characterId: ObjectId
): ApproverSlot | null {
  if (party.treasurerId?.equals(characterId)) return "treasurer";
  if (party.chairId?.equals(characterId)) return "leadership";
  if (party.viceChairId?.equals(characterId)) return "leadership";
  return null;
}

/**
 * The slot that still needs an approval on the given row. Returns
 * `null` when both slots are already filled (caller should execute).
 */
export function getMissingSlot(
  row: Pick<PendingTreasuryTransaction, "treasurerApproval" | "leadershipApproval">
): ApproverSlot | null {
  if (!row.treasurerApproval) return "treasurer";
  if (!row.leadershipApproval) return "leadership";
  return null;
}

/**
 * True when the given character is eligible to fill `slot` on this
 * party. `treasurer` slot accepts the seated Treasurer; when the
 * Treasurer seat is VACANT, the Chair or Vice-Chair may act as
 * Treasurer and fill it (mirrors the VC-acts-as-Chair precedent — a
 * vacant seat must not permanently lock treasury actions).
 * `leadership` slot accepts the seated Chair OR Vice-Chair — VC
 * qualifies whether or not the chair seat is currently vacant (slot
 * symmetry, not authority inheritance).
 */
export function canFillSlot(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  characterId: ObjectId,
  slot: ApproverSlot
): boolean {
  if (slot === "treasurer") {
    if (party.treasurerId != null) return party.treasurerId.equals(characterId);
    // Vacant Treasurer seat: Chair / VC act as Treasurer.
    return !!party.chairId?.equals(characterId) || !!party.viceChairId?.equals(characterId);
  }
  // leadership
  if (party.chairId?.equals(characterId)) return true;
  if (party.viceChairId?.equals(characterId)) return true;
  return false;
}

/**
 * Validates the party has the seats required to legitimately run the
 * two-person workflow at all. Per the scope doc, if EITHER the
 * Treasurer slot OR both Chair AND VC slots are vacant, the propose-
 * action is rejected — falling back to single-approver would break
 * the "two people must sign" guarantee.
 */
export function canProposePendingTransaction(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">
): { ok: true } | { ok: false; reason: string } {
  if (!party.treasurerId) {
    return { ok: false, reason: "Treasury actions require a seated Treasurer." };
  }
  if (!party.chairId && !party.viceChairId) {
    return {
      ok: false,
      reason: "Treasury actions require a seated Chair or Vice-Chair.",
    };
  }
  return { ok: true };
}

/**
 * Validates the party has the seats required to legitimately run a
 * Request Funds workflow. Single mode needs ≥ 1 officer seated (the
 * single approver). Double mode is stricter: Treasurer + (Chair OR VC),
 * same as send/transfer.
 *
 * Request Funds (per the 2026-05-23 spec) is open to any party member;
 * eligibility is about whether there's ANYONE who could approve, not
 * whether the proposer holds an officer seat.
 */
export function canRequestFunds(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  mode: "single" | "double"
): { ok: true } | { ok: false; reason: string } {
  if (mode === "double") {
    return canProposePendingTransaction(party);
  }
  // Single mode: any one officer seated is enough.
  if (!party.treasurerId && !party.chairId && !party.viceChairId) {
    return {
      ok: false,
      reason:
        "Request Funds requires at least one of Treasurer, Chair, or Vice-Chair to be seated.",
    };
  }
  return { ok: true };
}

/**
 * Resolves the approval mode a party's treasury actions actually run
 * under right now. The configured mode is `transactionApprovalMode`
 * (default "double"), but the two-person guarantee can only hold while a
 * Treasurer is seated — there must be a distinct Treasurer signature.
 * When the Treasurer seat is VACANT, double mode collapses to "single"
 * so the Chair / VC (acting Treasurer) can complete treasury actions
 * alone rather than being permanently locked out.
 *
 * Single mode is returned unchanged (it never required a Treasurer).
 */
export function resolveTransactionApprovalMode(
  party: Pick<PoliticalParty, "transactionApprovalMode" | "treasurerId">
): "single" | "double" {
  const configured = party.transactionApprovalMode ?? "double";
  if (configured === "double" && party.treasurerId == null) return "single";
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
 * Approve on the row — specifically the still-empty slot they are
 * eligible to fill, preferring their natural role slot. Returns null
 * when:
 *   - they hold no Treasurer/Chair/VC seat (or can't fill either empty slot)
 *   - the row is a Request Funds row AND they're the requester
 *     (self-approval forbidden per the 2026-05-23 spec)
 *
 * Picking the eligible *empty* slot (rather than the role's slot
 * unconditionally) lets a Chair / VC act as Treasurer to clear a row
 * left stuck after the Treasurer vacated — `canFillSlot` grants the
 * treasurer slot to Chair/VC only while the seat is empty.
 *
 * The approve route still does the atomic claim with
 * `[slotField]: { $exists: false }`, so a stale read here is harmless.
 */
export function getApproverSlotForRow(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  row: Pick<
    PendingTreasuryTransaction,
    "type" | "proposedBy" | "treasurerApproval" | "leadershipApproval"
  >,
  characterId: ObjectId
): ApproverSlot | null {
  if (row.type === "request" && row.proposedBy.equals(characterId)) {
    return null;
  }
  // Prefer the caller's natural role slot, then fall back to acting-Treasurer.
  const natural = getProposerSlot(party, characterId);
  const order: ApproverSlot[] =
    natural === "treasurer" ? ["treasurer", "leadership"] : ["leadership", "treasurer"];
  for (const slot of order) {
    const filled = slot === "treasurer" ? !!row.treasurerApproval : !!row.leadershipApproval;
    if (!filled && canFillSlot(party, characterId, slot)) return slot;
  }
  return null;
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
    ? canRequestFunds(input.party, mode)
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
    treasurerApproval = slot === "treasurer" ? approval : undefined;
    leadershipApproval = slot === "leadership" ? approval : undefined;
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
