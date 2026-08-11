/**
 * Mid-game party ban / unban side effects.
 *
 * In a one-party state, banning a party makes it inert: officials lose
 * their seats (existing resign pattern), characters' currentOffice is
 * cleared, autoRunForReelection is cleared, and the party doc is
 * flipped to regimeStatus: "banned" with audit fields.
 *
 * AHD has no by-election infrastructure (see docs/design/vacancy-handling.md).
 * Vacated seats stay empty until the next regular election cycle for that
 * office type — same model as US House, UK Commons, etc.
 *
 * Phase 2 ships this handler as a callable function; Phase 4 wires it to
 * an admin endpoint and UI.
 */
import type { Db, ObjectId } from "mongodb";
import type { ElectedOfficial } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";

export interface BanPartyInput {
  countryId: CountryId;
  partyId: ObjectId;
  /** sequentialId of the party — matches `ElectedOfficial.party` (string). */
  partySeqId: number;
  reason: string;
  currentTurn: number;
}

export interface BanPartyResult {
  officialsVacated: number;
  seatsVacated: number;
}

export async function processBanPartyEffects(
  db: Db,
  input: BanPartyInput
): Promise<BanPartyResult> {
  const { countryId, partyId, partySeqId, reason, currentTurn } = input;
  const now = new Date();

  const officials = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ countryId, party: String(partySeqId) })
    .toArray();

  let seatsVacated = 0;

  for (const official of officials) {
    seatsVacated += official.seatsHeld ?? 1;

    // Mirror the existing resign pattern (docs/design/vacancy-handling.md):
    // delete the ElectedOfficial doc; clear currentOffice on the holder.
    await db.collection("electedOfficials").deleteOne({ _id: official._id });

    if (official.characterId) {
      await db.collection("characters").updateOne(
        { _id: official.characterId },
        {
          $set: {
            currentOffice: null,
            // Clear the auto-re-entry flag so autoReelectionEntry doesn't
            // silently re-file the banned-party character next turn.
            autoRunForReelection: false,
            updatedAt: now,
          },
        }
      );
    }
    if (official.nppId) {
      await db
        .collection("npps")
        .updateOne({ _id: official.nppId }, { $set: { currentOffice: null, updatedAt: now } });
    }
  }

  // Flip the party doc with audit fields.
  await db.collection("politicalParties").updateOne(
    { _id: partyId },
    {
      $set: {
        regimeStatus: "banned",
        bannedAt: now,
        bannedReason: reason,
        bannedAtTurn: currentTurn,
        updatedAt: now,
      },
    }
  );

  return {
    officialsVacated: officials.length,
    seatsVacated,
  };
}

export interface UnbanPartyInput {
  partyId: ObjectId;
  reason: string;
}

export async function processUnbanPartyEffects(db: Db, input: UnbanPartyInput): Promise<void> {
  const { partyId, reason } = input;
  const now = new Date();

  await db.collection("politicalParties").updateOne(
    { _id: partyId },
    {
      $set: {
        regimeStatus: "approved",
        unbannedAt: now,
        unbannedReason: reason,
        updatedAt: now,
      },
      $unset: { bannedAt: "", bannedReason: "", bannedAtTurn: "" },
    }
  );
  // No automatic seat restoration. Vacated seats fill at next election cycle.
}
