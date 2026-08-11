import type { Db, ObjectId } from "mongodb";
import type { Character, PartyCharter, PartyCharterSignature } from "@/lib/db/types";
import { adjacentStates } from "@/lib/constants/stateAdjacency";

/**
 * Phase 6 — replace a voided / rejected / banned founder. Requires the
 * caller to identify the outgoing founder slot by characterId and provide
 * the replacement characterId. Charter returns to `pending-signatures`
 * with the new founder slot reset to unsigned + un-rejected.
 *
 * The replacement character must exist, be human-owned (have a `userId`),
 * and live in the same country as the charter.
 *
 * Authorization is the API route's job — this helper trusts that the
 * caller has gated on chair / admin / current-founder permission.
 *
 * Edge cases:
 *  - Outgoing characterId not on the charter → returns `outgoing-not-founder`.
 *  - Replacement characterId already a founder → returns `replacement-already-founder`.
 *  - Replacement character missing / NPP / wrong-country → returns the
 *    matching `replacement-*` reason.
 *  - Charter not in `founder-replacement` → returns `not-replaceable`.
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
  if (charter.status !== "founder-replacement") {
    return { ok: false, reason: "not-replaceable" };
  }
  const outgoingIndex = charter.foundersCharacterIds.findIndex((c) =>
    c.equals(outgoingCharacterId)
  );
  if (outgoingIndex < 0) return { ok: false, reason: "outgoing-not-founder" };
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

  // Phase 6 closeout fix F6 — guard the status transition with the
  // current `founder-replacement` state so a concurrent `expireCharters`
  // sweep that flipped the charter to `expired` cannot be silently
  // overwritten back to `pending-signatures`.
  const result = await db.collection<PartyCharter>("partyCharters").updateOne(
    { _id: charterId, status: "founder-replacement" },
    {
      $set: {
        foundersCharacterIds: newFounders,
        signatures: newSignatures,
        status: "pending-signatures",
        founderReplacementDeadline: null,
        founderReplacementDeadlineTurn: null,
        updatedAt: now,
      },
    }
  );
  if (result.matchedCount === 0) {
    // Lost the race against expiration (or another caller already
    // replaced the slot and moved status forward).
    return { ok: false, reason: "not-replaceable" };
  }
  return { ok: true, status: "pending-signatures" };
}
