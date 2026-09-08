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
 * Either approver may be the Chair, Vice-Chair or Treasurer. The slots
 * are not role-typed: what makes the approval two-person is that one
 * character cannot occupy both, and that the recipient of a payment can
 * never approve it.
 *
 * The exception is a party with a single player member. It has nobody to
 * countersign, so it runs in single mode and may self-fund rather than
 * being locked out of its own treasury. See `soloPlayerParty.ts`.
 *
 * See `docs/plans/archive/2026-05/2026-05-22-treasury-two-person-approval.md`.
 */

import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PendingTreasuryTransaction, PoliticalParty } from "@/lib/db/types";
import { PENDING_TXN_EXPIRY_TURNS } from "./proposalConstants";

// ─── Slot model ──────────────────────────────────────────────────────────────

/**
 * The two approval slots on a pending row.
 *
 * The names are historical and match the stored field names
 * (`treasurerApproval` / `leadershipApproval`) so no migration is
 * needed, but the slots are NOT role-typed any more: either slot
 * accepts any of the Chair, Vice-Chair or Treasurer. Read them as
 * "approver 1" and "approver 2".
 *
 * What makes the approval two-person is that the same character can
 * never occupy both slots, not that the slots demand different offices.
 */
export type ApproverSlot = "treasurer" | "leadership";

/** True when the character holds any of the three officer seats. */
export function isPartyOfficer(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  characterId: ObjectId
): boolean {
  return (
    !!party.treasurerId?.equals(characterId) ||
    !!party.chairId?.equals(characterId) ||
    !!party.viceChairId?.equals(characterId)
  );
}

/** The distinct characters holding an officer seat, as hex ids. */
export function seatedOfficerIds(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">
): Set<string> {
  return new Set(
    [party.chairId, party.viceChairId, party.treasurerId]
      .filter((id): id is ObjectId => id != null)
      .map((id) => id.toString())
  );
}

/**
 * Returns the slot the given character fills on a propose. Both slots
 * are empty at that point, so any officer takes the first one; the
 * second is left for someone else. Returns `null` if the character
 * holds no officer seat. (Admins bypass the lifecycle entirely —
 * handled at the route layer, not here.)
 */
export function getProposerSlot(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  characterId: ObjectId
): ApproverSlot | null {
  return isPartyOfficer(party, characterId) ? "treasurer" : null;
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
 * True when the given character may fill `slot` on this party.
 *
 * Either slot accepts any officer, so this is simply "holds a seat".
 * The slot argument is kept for call-site readability. Preventing one
 * character from taking both slots is the caller's job — see
 * `getApproverSlotForRow`, which refuses a character already recorded
 * in the other slot.
 */
export function canFillSlot(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  characterId: ObjectId,
  _slot: ApproverSlot
): boolean {
  return isPartyOfficer(party, characterId);
}

/**
 * Validates the party can run the two-person workflow at all.
 *
 * Needs two DISTINCT seated officers, in any combination: Chair plus
 * Vice-Chair is as valid as Treasurer plus Chair. One person holding
 * two seats still counts once, because they cannot sign twice.
 *
 * A party with fewer than two officers but more than one player member
 * is expected to appoint someone; a party with only one player member
 * never reaches here, because it resolves to single mode.
 */
export function canProposePendingTransaction(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">
): { ok: true } | { ok: false; reason: string } {
  const officers = seatedOfficerIds(party);
  if (officers.size === 0) {
    return {
      ok: false,
      reason: "Treasury actions require a seated Chair, Vice-Chair or Treasurer.",
    };
  }
  if (officers.size < 2) {
    return {
      ok: false,
      reason:
        "Treasury actions need two different officers to sign. Appoint a second Chair, Vice-Chair or Treasurer.",
    };
  }
  return { ok: true };
}

/**
 * Validates the party has the seats required to legitimately run a
 * Request Funds workflow. Single mode needs >= 1 officer seated (the
 * single approver). Double mode is stricter: two distinct officers,
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
  if (seatedOfficerIds(party).size === 0) {
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
 * (default "double").
 *
 * The one override is a party with a single player member. Two-person
 * approval needs two people, and NPP members cannot approve anything,
 * so a solo player would otherwise be permanently unable to move their
 * own party's money. Such a party runs in single mode and may self-fund.
 *
 * A vacant Treasurer seat is NOT an override: either slot accepts any
 * officer, so a Chair plus Vice-Chair can sign without a Treasurer. A
 * party with several players but only one officer is expected to
 * appoint a second one.
 *
 * Single mode configured deliberately is returned unchanged.
 */
export function resolveTransactionApprovalMode(
  party: Pick<PoliticalParty, "transactionApprovalMode">,
  options: {
    /**
     * True when the party has at most one PLAYER member (NPP members do
     * not count — they cannot click Approve). Two-person approval is
     * impossible for such a party, so it falls back to single mode
     * rather than being permanently unable to spend.
     */
    soloPlayerParty?: boolean;
  } = {}
): "single" | "double" {
  const configured = party.transactionApprovalMode ?? "double";
  if (configured === "double" && options.soloPlayerParty) return "single";
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
 * Approve on the row — the first still-empty slot, since either slot
 * accepts any officer. Returns null when:
 *   - they hold no Chair/Vice-Chair/Treasurer seat
 *   - they ALREADY occupy the other slot (this is what makes the
 *     approval two-person now that the slots are not role-typed)
 *   - they are the RECIPIENT of the row (nobody signs off on a payment
 *     to themselves)
 *   - the row is a Request Funds row AND they're the requester
 *     (self-approval forbidden per the 2026-05-23 spec)
 *
 * The approve route still does the atomic claim with
 * `[slotField]: { $exists: false }`, so a stale read here is harmless.
 */
export function getApproverSlotForRow(
  party: Pick<PoliticalParty, "chairId" | "viceChairId" | "treasurerId">,
  row: Pick<
    PendingTreasuryTransaction,
    "type" | "proposedBy" | "targetCharacterId" | "treasurerApproval" | "leadershipApproval"
  >,
  characterId: ObjectId
): ApproverSlot | null {
  // Nobody approves a payment to themselves, whoever proposed it.
  if (row.targetCharacterId?.equals(characterId)) {
    return null;
  }
  // Legacy request rows may predate `targetCharacterId`; the requester
  // is the recipient by definition, so exclude them by proposer too.
  if (row.type === "request" && row.proposedBy.equals(characterId)) {
    return null;
  }
  if (!isPartyOfficer(party, characterId)) {
    return null;
  }
  // One person cannot sign both halves. With role-typed slots this fell
  // out of the roles; now it has to be checked directly.
  if (
    row.treasurerApproval?.characterId.equals(characterId) ||
    row.leadershipApproval?.characterId.equals(characterId)
  ) {
    return null;
  }
  if (!row.treasurerApproval) return "treasurer";
  if (!row.leadershipApproval) return "leadership";
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
