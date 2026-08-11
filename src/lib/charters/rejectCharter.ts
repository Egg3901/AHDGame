import type { Db, ObjectId } from "mongodb";
import type { Character, PartyCharter } from "@/lib/db/types";
import { computeCharterDeadline, computeCharterDeadlineTurn } from "./charterDeadlines";

/**
 * Phase 6 — record a founder's rejection on a charter. Transitions the
 * charter to `founder-replacement` so a new founder can be invited
 * within the deadline (Phase 6 D3 + D4).
 *
 * Founder identity is `characterId`; auth runs against the session's
 * `userId` so the caller passes both.
 *
 * Edge cases:
 *  - Charter not in `pending-signatures` → returns `not-rejectable`.
 *  - Character isn't a founder → returns `not-a-founder`.
 *  - Caller doesn't own the character → returns `not-character-owner`.
 *  - Character already signed → returns `already-signed` (must withdraw
 *    via a separate endpoint; not in Phase 6 MVP scope).
 *
 * See plan §"Phase 6 — Tasks" 6.2 + D3.
 */
export type RejectCharterResult =
  | { ok: true; status: "founder-replacement" }
  | {
      ok: false;
      reason:
        | "charter-not-found"
        | "not-rejectable"
        | "not-a-founder"
        | "not-character-owner"
        | "already-signed";
    };

export async function rejectCharter(
  charterId: ObjectId,
  rejecterCharacterId: ObjectId,
  rejecterUserId: ObjectId,
  reason: string | undefined,
  db: Db,
  now: Date = new Date()
): Promise<RejectCharterResult> {
  const charter = await db.collection<PartyCharter>("partyCharters").findOne({ _id: charterId });
  if (!charter) return { ok: false, reason: "charter-not-found" };
  if (charter.status !== "pending-signatures") {
    return { ok: false, reason: "not-rejectable" };
  }
  const sigIndex = charter.signatures.findIndex((s) => s.characterId.equals(rejecterCharacterId));
  if (sigIndex < 0) return { ok: false, reason: "not-a-founder" };
  if (charter.signatures[sigIndex].signedAt) {
    return { ok: false, reason: "already-signed" };
  }

  // Auth: the session userId must own the character that's rejecting.
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: rejecterCharacterId }, { projection: { userId: 1 } });
  if (!character?.userId || !character.userId.equals(rejecterUserId)) {
    return { ok: false, reason: "not-character-owner" };
  }

  // Per D3 + D4: enter founder-replacement with a fresh deadline. Turn-based
  // mirror freezes the countdown on pause; null when gameState is unavailable.
  const replacementDeadline = computeCharterDeadline(now);
  const currentTurn =
    (
      await db
        .collection<{ _id: string; currentTurn?: number }>("gameState")
        .findOne({ _id: "current" })
    )?.currentTurn ?? null;
  const replacementDeadlineTurn =
    currentTurn != null ? computeCharterDeadlineTurn(currentTurn) : null;

  // Atomic per-element update via positional `$.[matched]` to avoid clobbering
  // sibling signatures that may have been written concurrently (e.g. one
  // founder rejecting while another races to sign).
  const setOps: Record<string, unknown> = {
    "signatures.$.rejectedAt": now,
    status: "founder-replacement",
    founderReplacementDeadline: replacementDeadline,
    founderReplacementDeadlineTurn: replacementDeadlineTurn,
    updatedAt: now,
  };
  if (reason !== undefined) {
    setOps["signatures.$.rejectionReason"] = reason;
  }
  // Phase 6 closeout fix F6 — guard `status: "pending-signatures"` so a
  // concurrent `expireCharters` sweep that flipped the charter to
  // `expired` cannot be silently un-expired by writing
  // status=founder-replacement here.
  const result = await db.collection<PartyCharter>("partyCharters").updateOne(
    {
      _id: charterId,
      status: "pending-signatures",
      "signatures.characterId": rejecterCharacterId,
    },
    { $set: setOps }
  );
  if (result.matchedCount === 0) {
    return { ok: false, reason: "not-rejectable" };
  }

  // Notify the remaining founders that a slot has opened up so they can
  // run the replacement flow within the deadline window. Non-fatal.
  try {
    const remaining = charter.foundersCharacterIds.filter(
      (cid) => !cid.equals(rejecterCharacterId)
    );
    if (remaining.length > 0) {
      const remainingCharacters = await db
        .collection<Character>("characters")
        .find({ _id: { $in: remaining } })
        .project<{ _id: ObjectId; userId: ObjectId | null | undefined }>({
          _id: 1,
          userId: 1,
        })
        .toArray();
      const { createNotification } = await import("@/lib/notifications");
      for (const c of remainingCharacters) {
        if (!c.userId) continue;
        await createNotification({
          userId: c.userId,
          type: "charter_replacement_needed",
          title: `A founder rejected the ${charter.proposedAbbr} charter`,
          message: `Open the charter to nominate a replacement founder. The party can't be ratified until the slot is filled.`,
          metadata: {
            charterId: charter._id.toString(),
            countryId: charter.countryId,
            href: `/charters/${charter._id.toString()}`,
            replacementDeadline: replacementDeadline.toISOString(),
          },
        });
      }
    }
  } catch {
    /* non-fatal */
  }

  return { ok: true, status: "founder-replacement" };
}
