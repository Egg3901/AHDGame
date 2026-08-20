import type { Db, ObjectId } from "mongodb";
import type { Character, PartyCharter, PartyCharterSignature } from "@/lib/db/types";
import { adjacentStates } from "@/lib/constants/stateAdjacency";

/**
 * Phase 6 — replace a founder slot. Two entry states are accepted:
 *
 *  - `founder-replacement`: the involuntary path — a founder was voided,
 *    rejected, or banned and the slot must be refilled to proceed.
 *  - `pending-signatures`: the voluntary path (suggestion #287) — the
 *    proposer / a founder swaps out an inactive founder who cannot come
 *    online before the charter expires. Only an UNSIGNED slot may be swapped
 *    this way: a founder who has already signed has committed, so their slot
 *    is not eligible for a voluntary swap.
 *
 * In both cases the charter ends in `pending-signatures` with the new
 * founder slot reset to unsigned + un-rejected.
 *
 * The replacement character must exist, be human-owned (have a `userId`),
 * and live in the same country as the charter.
 *
 * Authorization is the API route's job — this helper trusts that the
 * caller has gated on chair / admin / current-founder permission.
 *
 * Edge cases:
 *  - Outgoing characterId not on the charter → returns `outgoing-not-founder`.
 *  - Outgoing slot already signed (voluntary path) → `outgoing-already-signed`.
 *  - Replacement characterId already a founder → returns `replacement-already-founder`.
 *  - Replacement character missing / NPP / wrong-country → returns the
 *    matching `replacement-*` reason.
 *  - Charter not in a replaceable state → returns `not-replaceable`.
 *
 * See plan §"Phase 6 — Tasks" 6.2 + D3.
 */
export type ReplaceFounderResult =
  | { ok: true; status: "pending-signatures" }
  | {
      ok: false;
      reason:
        | "charter-not-found"
        | "not-replaceable"
        | "outgoing-not-founder"
        | "outgoing-already-signed"
        | "replacement-already-founder"
        | "replacement-not-found"
        | "replacement-not-human"
        | "replacement-wrong-country"
        | "replacement-not-adjacent";
    };

export async function replaceFounder(
  charterId: ObjectId,
  outgoingCharacterId: ObjectId,
  replacementCharacterId: ObjectId,
  db: Db,
  now: Date = new Date()
): Promise<ReplaceFounderResult> {
  const charter = await db.collection<PartyCharter>("partyCharters").findOne({ _id: charterId });
  if (!charter) return { ok: false, reason: "charter-not-found" };
  const isVoluntary = charter.status === "pending-signatures";
  if (charter.status !== "founder-replacement" && !isVoluntary) {
    return { ok: false, reason: "not-replaceable" };
  }
  const outgoingIndex = charter.foundersCharacterIds.findIndex((c) =>
    c.equals(outgoingCharacterId)
  );
  if (outgoingIndex < 0) return { ok: false, reason: "outgoing-not-founder" };
  // Voluntary swap (#287) may only remove a founder who has NOT signed. A
  // signed founder has committed; their slot is off-limits to a swap.
  if (isVoluntary) {
    const outgoingSig = charter.signatures.find((s) => s.characterId.equals(outgoingCharacterId));
    if (outgoingSig?.signedAt) {
      return { ok: false, reason: "outgoing-already-signed" };
    }
  }
  if (charter.foundersCharacterIds.some((c) => c.equals(replacementCharacterId))) {
    return { ok: false, reason: "replacement-already-founder" };
  }

  // Validate the replacement character: exists, human-owned, same country.
  const replacement = await db
    .collection<Character>("characters")
    .findOne(
      { _id: replacementCharacterId },
      { projection: { _id: 1, userId: 1, countryId: 1, homeState: 1 } }
    );
  if (!replacement) return { ok: false, reason: "replacement-not-found" };
  if (!replacement.userId) return { ok: false, reason: "replacement-not-human" };
  if (replacement.countryId !== charter.countryId) {
    return { ok: false, reason: "replacement-wrong-country" };
  }

  // Founder adjacency (2026-07-22): the replacement must live in or
  // adjacent to the anchor founder's (slot 0) home state — the same rule
  // `draftCharter` enforces on the original trio. When the anchor itself
  // is the outgoing slot, the outgoing anchor's home state still anchors
  // the check (the party's founding geography doesn't move). Skipped when
  // the anchor has no homeState (legacy seed data).
  const anchorCharacterId = charter.foundersCharacterIds[0];
  const anchor = anchorCharacterId
    ? await db
        .collection<Character>("characters")
        .findOne({ _id: anchorCharacterId }, { projection: { _id: 1, homeState: 1 } })
    : null;
  const anchorHomeState = anchor?.homeState || null;
  if (anchorHomeState) {
    const allowedStates = new Set<string>([
      anchorHomeState,
      ...adjacentStates(charter.countryId, anchorHomeState),
    ]);
    if (!replacement.homeState || !allowedStates.has(replacement.homeState)) {
      return { ok: false, reason: "replacement-not-adjacent" };
    }
  }

  const newFounders = [...charter.foundersCharacterIds];
  newFounders[outgoingIndex] = replacementCharacterId;

  // Replacement starts unsigned (un-rejected). Other founders' existing
  // signature state is preserved — they don't need to re-sign.
  const newSignatures: PartyCharterSignature[] = charter.signatures.map((s) =>
    s.characterId.equals(outgoingCharacterId) ? { characterId: replacementCharacterId } : s
  );

  // Phase 6 closeout fix F6 — guard the status transition with the exact
  // state we read (founder-replacement OR pending-signatures) so a concurrent
  // `expireCharters` sweep that flipped the charter to `expired`, or a racing
  // signer/ratifier, cannot be silently overwritten. For the voluntary path we
  // also re-assert the outgoing slot is still unsigned at write time.
  const guard: Record<string, unknown> = { _id: charterId, status: charter.status };
  if (isVoluntary) {
    guard["signatures"] = {
      $not: { $elemMatch: { characterId: outgoingCharacterId, signedAt: { $ne: null } } },
    };
  }
  const result = await db.collection<PartyCharter>("partyCharters").updateOne(guard, {
    $set: {
      foundersCharacterIds: newFounders,
      signatures: newSignatures,
      status: "pending-signatures",
      founderReplacementDeadline: null,
      founderReplacementDeadlineTurn: null,
      updatedAt: now,
    },
  });
  if (result.matchedCount === 0) {
    // Lost the race against expiration (or another caller already
    // replaced the slot and moved status forward).
    return { ok: false, reason: "not-replaceable" };
  }
  return { ok: true, status: "pending-signatures" };
}
