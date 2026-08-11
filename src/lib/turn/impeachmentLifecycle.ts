import type { Db } from "@/lib/mongodb";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { Impeachment, ImpeachmentStage } from "@/lib/db/types/impeachment";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
} from "@/lib/legislature/chamberOfficeType";
import { getSubNationalLegislatureKey, COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import {
  tallyImpeachmentChamber,
  passesHouseImpeachment,
  passesSenateConviction,
} from "@/lib/impeachment/impeachmentTally";
import {
  removeImpeachedExecutive,
  removeImpeachedGovernor,
} from "@/lib/impeachment/removeImpeachedExecutive";
import { IMPEACHMENT_SENATE_VOTING_TURNS } from "@/lib/constants/impeachment";
import { createNotification } from "@/lib/notifications";

/** Country-scoped governor filter (US governor rows predate the explicit countryId). */
function governorFilter(
  countryId: Impeachment["countryId"],
  state: string
): Record<string, unknown> {
  if (countryId === COUNTRY_CONFIGS.US.id) {
    return {
      officeType: "governor",
      state,
      $or: [{ countryId }, { countryId: { $exists: false } }],
    };
  }
  return { officeType: "governor", countryId, state };
}

/**
 * Advance every open impeachment whose current-stage voting window has closed.
 * House stage → simple majority impeaches (advance to Senate), else dismissed.
 * Senate stage → seat-weighted 2/3 convicts (vacate the executive; the later
 * `presidentialSuccession` phase then promotes the VP), else acquitted.
 * Auto-cancels a case whose target is no longer the sitting president.
 *
 * Must be sequenced BEFORE `presidentialSuccession` so a conviction-induced
 * vacancy is filled the same turn.
 */
export async function processImpeachmentLifecycle(
  db: Db,
  currentTurn: number,
  now: Date
): Promise<{ resolved: number }> {
  const open = await db
    .collection<Impeachment>("impeachments")
    .find({ stage: { $in: ["house", "senate"] } })
    .toArray();

  let resolved = 0;

  const claim = async (imp: Impeachment, stage: ImpeachmentStage): Promise<boolean> => {
    const res = await db
      .collection<Impeachment>("impeachments")
      .updateOne(
        { _id: imp._id, stage: imp.stage },
        { $set: { stage, resolvedOnTurn: currentTurn, updatedAt: now } }
      );
    return res.modifiedCount > 0;
  };

  for (const imp of open) {
    const isGovernor = imp.targetOffice === "governor";

    // Auto-cancel if the target is no longer the sitting office-holder (resigned,
    // lost office, already succeeded/removed).
    const holderFilter =
      isGovernor && imp.state
        ? governorFilter(imp.countryId, imp.state)
        : getExecutiveOfficialFilter(imp.countryId, "president");
    const holder = await db.collection<ElectedOfficial>("electedOfficials").findOne(holderFilter);
    const stillHolds =
      holder?.characterId != null &&
      holder.characterId.toString() === imp.targetCharacterId.toString();
    if (!stillHolds) {
      if (await claim(imp, "cancelled")) resolved++;
      continue;
    }

    // Governor: single-chamber state-legislature conviction vote (filed at
    // stage "senate"). 2/3 removes; the merged byElectionWatcher then spawns a
    // governor by-election to refill the seat.
    if (isGovernor) {
      if (imp.senateVotingEndsOnTurn == null || currentTurn < imp.senateVotingEndsOnTurn) continue;
      const stateChamber = getSubNationalLegislatureKey(imp.countryId);
      const tally = await tallyImpeachmentChamber(
        db,
        imp.countryId,
        stateChamber,
        imp.senateVotes,
        imp.state
      );
      if (passesSenateConviction(tally)) {
        if (await claim(imp, "convicted")) {
          await removeImpeachedGovernor(db, imp.countryId, imp.state!, imp.targetCharacterId, now);
          const targetChar = await db
            .collection<Character>("characters")
            .findOne({ _id: imp.targetCharacterId }, { projection: { userId: 1, name: 1 } });
          if (targetChar?.userId) {
            await createNotification({
              userId: targetChar.userId,
              type: "impeachment_convicted",
              title: "Removed from Office",
              message: `${imp.targetName} has been convicted by the ${imp.state} state legislature and removed as Governor.`,
              metadata: {
                impeachmentId: imp._id.toString(),
                countryId: imp.countryId,
                state: imp.state,
              },
            });
          }
          resolved++;
        }
      } else if (await claim(imp, "acquitted")) {
        resolved++;
      }
      continue;
    }

    if (imp.stage === "house") {
      if (currentTurn < imp.houseVotingEndsOnTurn) continue; // window still open
      const tally = await tallyImpeachmentChamber(
        db,
        imp.countryId,
        getLowerChamberOfficeType(imp.countryId),
        imp.houseVotes
      );
      if (passesHouseImpeachment(tally)) {
        const advanced = await db.collection<Impeachment>("impeachments").updateOne(
          { _id: imp._id, stage: "house" },
          {
            $set: {
              stage: "senate",
              senateVotingEndsOnTurn: currentTurn + IMPEACHMENT_SENATE_VOTING_TURNS,
              updatedAt: now,
            },
          }
        );
        if (advanced.modifiedCount > 0) resolved++;
      } else if (await claim(imp, "dismissed")) {
        resolved++;
      }
      continue;
    }

    // Senate stage
    if (imp.senateVotingEndsOnTurn == null || currentTurn < imp.senateVotingEndsOnTurn) continue;
    const upperOffice = getUpperChamberOfficeType(imp.countryId);
    const tally = upperOffice
      ? await tallyImpeachmentChamber(db, imp.countryId, upperOffice, imp.senateVotes)
      : { for: 0, against: 0, seats: 0 };

    if (upperOffice && passesSenateConviction(tally)) {
      if (await claim(imp, "convicted")) {
        await removeImpeachedExecutive(db, imp.countryId, "president", imp.targetCharacterId, now);
        const targetChar = await db
          .collection<Character>("characters")
          .findOne({ _id: imp.targetCharacterId }, { projection: { userId: 1, name: 1 } });
        if (targetChar?.userId) {
          await createNotification({
            userId: targetChar.userId,
            type: "impeachment_convicted",
            title: "Removed from Office",
            message: `${imp.targetName} has been convicted by the ${imp.countryId} Senate and removed from the presidency.`,
            metadata: { impeachmentId: imp._id.toString(), countryId: imp.countryId },
          });
        }
        resolved++;
      }
    } else if (await claim(imp, "acquitted")) {
      resolved++;
    }
  }

  return { resolved };
}
