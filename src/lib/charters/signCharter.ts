import type { Db, ObjectId } from "mongodb";
import type { Character, PartyCharter } from "@/lib/db/types";
import { ratifyCharter } from "./ratifyCharter";

/**
 * Phase 6 — record a founder's signature on a charter. Transitions the
 * charter to `ratified` (and spawns the `politicalParties` row) once all
 * 3 founders have signed.
 *
 * Founder identity is `characterId` — but auth runs against the session's
 * `userId`, so the caller passes both: `signerCharacterId` (which slot to
 * sign) and `signerUserId` (the authenticated session user, used to verify
 * the character is owned by the caller).
 *
 * Edge cases:
 *  - Character isn't a founder → returns `not-a-founder`.
 *  - Caller doesn't own the character → returns `not-character-owner`.
 *  - Charter not in `pending-signatures` → returns `not-signable`.
 *  - Character already signed → no-op (idempotent), returns the current
 *    signature count.
 *  - Character already rejected → returns `already-rejected`; they must
 *    invalidate via `replaceFounder` first.
 *
 * See plan §"Phase 6 — Tasks" 6.2.
 */
export type SignCharterResult =
  | {
      ok: true;
      ratified: boolean;
      signedCount: number;
      requiredCount: number;
      ratifiedPartyId?: string;
      /**
       * True when the new party was created in a one-party state and is
       * therefore born banned. Only set when `ratified: true`. UI uses
       * this to render the "banned at creation" explanation.
       */
      bannedAtCreation?: boolean;
    }
  | {
      ok: false;
      reason:
        | "charter-not-found"
        | "not-signable"
        | "not-a-founder"
        | "not-character-owner"
        | "already-rejected";
    };

export async function signCharter(
  charterId: ObjectId,
  signerCharacterId: ObjectId,
  signerUserId: ObjectId,
  db: Db,
  now: Date = new Date()
): Promise<SignCharterResult> {
  const charter = await db.collection<PartyCharter>("partyCharters").findOne({ _id: charterId });
  if (!charter) return { ok: false, reason: "charter-not-found" };
  if (charter.status !== "pending-signatures") {
    return { ok: false, reason: "not-signable" };
  }
  const sigIndex = charter.signatures.findIndex((s) => s.characterId.equals(signerCharacterId));
  if (sigIndex < 0) return { ok: false, reason: "not-a-founder" };
  if (charter.signatures[sigIndex].rejectedAt) {
    return { ok: false, reason: "already-rejected" };
  }

  // Auth: the session userId must own the character that's signing. Without
  // this check, any logged-in user could sign for any other founder slot.
  const character = await db
    .collection<Character>("characters")
    .findOne({ _id: signerCharacterId }, { projection: { userId: 1 } });
  if (!character?.userId || !character.userId.equals(signerUserId)) {
    return { ok: false, reason: "not-character-owner" };
  }

  // Atomic per-element update via positional `$.[matched]` to avoid the
  // lost-update race two parallel signers would hit if we wrote the whole
  // `signatures` array. Only the matched element is touched; siblings stay
  // intact even under concurrent updates.
  //
  // Phase 6 closeout fix F6 — also guard `status: "pending-signatures"` so
  // a concurrent `expireCharters` sweep that flipped the charter to
  // `expired` (or a concurrent rejection that flipped to
  // `founder-replacement`) cannot get a "phantom" signature applied
  // afterward. If the guard fails the user sees `not-signable` at the
  // re-read.
  if (!charter.signatures[sigIndex].signedAt) {
    await db.collection<PartyCharter>("partyCharters").updateOne(
      {
        _id: charterId,
        status: "pending-signatures",
        "signatures.characterId": signerCharacterId,
      },
      {
        $set: {
          "signatures.$.signedAt": now,
          updatedAt: now,
        },
      }
    );
  }

  // Re-read so the count reflects all concurrent updates that may have
  // landed since we read the charter for validation.
  const fresh = await db.collection<PartyCharter>("partyCharters").findOne({ _id: charterId });
  // If the charter is no longer signable (race with expire / reject),
  // surface that to the caller rather than silently reporting a stale
  // count from the pre-race read.
  if (fresh && fresh.status !== "pending-signatures" && fresh.status !== "ratified") {
    return { ok: false, reason: "not-signable" };
  }
  const signedCount = fresh?.signatures.filter((s) => s.signedAt).length ?? 0;
  const requiredCount = (fresh ?? charter).foundersCharacterIds.length;
  if (signedCount < requiredCount) {
    return { ok: true, ratified: false, signedCount, requiredCount };
  }
  // Threshold hit — ratify (idempotent on already-ratified, so concurrent
  // 3rd-signers don't double-spawn the party row).
  const result = await ratifyCharter(charterId, db, now);
  return {
    ok: true,
    ratified: true,
    signedCount,
    requiredCount,
    ratifiedPartyId: result.partyId,
    bannedAtCreation: result.bannedAtCreation,
  };
}
