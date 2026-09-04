import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Character, ElectedOfficial } from "@/lib/db/types";
import type { Impeachment, ImpeachmentStage } from "@/lib/db/types/impeachment";
import {
  COUNTRY_CONFIGS,
  getSubNationalLegislatureKey,
  type CountryId,
} from "@/lib/constants/countries";
import { getLowerChamberOfficeType } from "@/lib/legislature/chamberOfficeType";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import { governorOfficialFilter } from "@/lib/db/electedOfficialScope";
import { getGameState } from "@/lib/gameState";
import { badRequest, forbidden } from "@/lib/api/errors";
import {
  IMPEACHMENT_COOLDOWN_TURNS,
  IMPEACHMENT_HOUSE_VOTING_TURNS,
  IMPEACHMENT_SENATE_VOTING_TURNS,
} from "@/lib/constants/impeachment";

export interface FileImpeachmentOpts {
  /** "president" = national two-chamber; "governor" = single state-legislature vote. */
  office: "president" | "governor";
  /** Required for "governor": the state whose legislature tries the case. */
  state?: string;
  /** Required for "president"; optional cross-check for "governor" (resolved from state). */
  targetCharacterId?: ObjectId;
}

/**
 * File articles of impeachment. Presidential systems only.
 * - President: filer must be a sitting lower-chamber member; two-chamber flow
 *   (House impeach -> Senate convict). Starts at stage "house".
 * - Governor: filer must be a sitting member of that state's legislature; the
 *   state legislature is single-chamber, so the case is a single conviction vote
 *   (2/3). Starts directly at stage "senate" (the conviction stage). The target
 *   is resolved from the sitting governor of the state.
 * Guards against a duplicate active case and a per-target cooldown either way.
 */
export async function fileArticlesOfImpeachment(
  db: Db,
  countryId: CountryId,
  filer: Pick<Character, "_id" | "name">,
  isAdmin: boolean,
  opts: FileImpeachmentOpts
): Promise<{ impeachmentId: string }> {
  const config = COUNTRY_CONFIGS[countryId];
  if (!config) throw badRequest("Unknown country");
  if (config.governmentType !== "presidential") {
    throw badRequest(
      "Impeachment applies to presidential systems. Parliamentary governments use a vote of no confidence."
    );
  }

  const currentTurn = (await getGameState(db))?.currentTurn ?? 0;
  const officials = db.collection<ElectedOfficial>("electedOfficials");

  let targetCharacterId: ObjectId;
  let initialStage: ImpeachmentStage;
  let state: string | undefined;

  if (opts.office === "governor") {
    state = opts.state;
    if (!state) throw badRequest("A state is required to impeach a governor.");

    // Filer must be a sitting member of that state's legislature (admins bypass).
    if (!isAdmin) {
      const stateChamber = getSubNationalLegislatureKey(countryId);
      const filerOfficial = await officials.findOne({
        characterId: filer._id,
        officeType: stateChamber,
        state,
      });
      if (!filerOfficial) {
        throw forbidden(
          `You must be a sitting member of the ${state} state legislature to file articles of impeachment.`
        );
      }
    }

    const governor = await officials.findOne(governorOfficialFilter(countryId, state));
    if (!governor || !governor.characterId) {
      throw badRequest(`There is no sitting governor of ${state} to impeach.`);
    }
    targetCharacterId = governor.characterId;
    if (
      opts.targetCharacterId &&
      opts.targetCharacterId.toString() !== targetCharacterId.toString()
    ) {
      throw badRequest("That character is not the sitting governor of this state.");
    }
    initialStage = "senate"; // single-chamber conviction vote
  } else {
    if (!opts.targetCharacterId) throw badRequest("A target is required.");

    const president = await officials.findOne(getExecutiveOfficialFilter(countryId, "president"));
    if (!president || !president.characterId) {
      throw badRequest("There is no sitting president to impeach.");
    }
    if (president.characterId.toString() !== opts.targetCharacterId.toString()) {
      throw badRequest("That character is not the sitting president.");
    }

    if (!isAdmin) {
      const lowerOffice = getLowerChamberOfficeType(countryId);
      const filerOfficial = await officials.findOne({
        characterId: filer._id,
        officeType: lowerOffice,
      });
      if (!filerOfficial) {
        throw forbidden(
          `You must be a sitting ${config.legislature.lowerChamber.shortName} member to file articles of impeachment.`
        );
      }
    }
    targetCharacterId = president.characterId;
    initialStage = "house";
  }

  const targetChar = await db
    .collection<Character>("characters")
    .findOne({ _id: targetCharacterId }, { projection: { _id: 1, name: 1 } });
  if (!targetChar) throw badRequest("Target character not found.");

  // One active impeachment per target.
  const active = await db
    .collection<Impeachment>("impeachments")
    .findOne({ countryId, targetCharacterId, stage: { $in: ["house", "senate"] } });
  if (active) {
    throw badRequest("An impeachment against this official is already in progress.");
  }

  // Per-target cooldown against re-filing.
  const lastAttempt = await db
    .collection<Impeachment>("impeachments")
    .find({ countryId, targetCharacterId })
    .sort({ turnFiled: -1 })
    .limit(1)
    .toArray();
  if (lastAttempt.length > 0) {
    const elapsed = currentTurn - lastAttempt[0].turnFiled;
    if (elapsed < IMPEACHMENT_COOLDOWN_TURNS) {
      const remaining = IMPEACHMENT_COOLDOWN_TURNS - elapsed;
      throw badRequest(
        `Cannot file another impeachment against this official for ${remaining} more turn${
          remaining === 1 ? "" : "s"
        }.`
      );
    }
  }

  const now = new Date();
  const isGovernor = opts.office === "governor";
  const doc: Impeachment = {
    _id: new ObjectId(),
    countryId,
    targetCharacterId,
    targetName: targetChar.name ?? "Unknown",
    targetOffice: opts.office,
    ...(state ? { state } : {}),
    filedByCharacterId: filer._id,
    filedByName: filer.name,
    stage: initialStage,
    houseVotesFor: 0,
    houseVotesAgainst: 0,
    houseVotesAbstain: 0,
    houseVotes: {},
    // Governor cases have no House stage; the placeholder deadline is unused.
    houseVotingEndsOnTurn: isGovernor ? currentTurn : currentTurn + IMPEACHMENT_HOUSE_VOTING_TURNS,
    senateVotesFor: 0,
    senateVotesAgainst: 0,
    senateVotesAbstain: 0,
    senateVotes: {},
    senateVotingEndsOnTurn: isGovernor ? currentTurn + IMPEACHMENT_SENATE_VOTING_TURNS : null,
    turnFiled: currentTurn,
    resolvedOnTurn: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<Impeachment>("impeachments").insertOne(doc);

  return { impeachmentId: doc._id.toString() };
}
