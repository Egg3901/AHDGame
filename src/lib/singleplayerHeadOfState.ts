import { ObjectId, type Db } from "mongodb";
import type { Character, ElectedOfficial, NPP, OfficeType } from "@/lib/db/types";
import type { GovernmentFormation } from "@/lib/db/types/governmentFormation";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  isParliamentarySystem,
  type CountryId,
} from "@/lib/constants/countries";
import { getExecutiveOfficialFilter } from "@/lib/elections/executiveOfficeFilters";
import {
  appointPrimeMinister,
  ensureParliamentaryGovernmentFormation,
  tallySeatsByParty,
} from "@/lib/turn/parliamentaryGovernment";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import {
  getLiveLowerChamberSeats,
  lowerChamberMajorityThreshold,
} from "@/lib/turn/lowerChamberSeats";
import { getGameState } from "@/lib/gameState";
import { SINGLEPLAYER_USER_ID, isSingleplayer } from "@/lib/singleplayer";

export function mayRuleByDecree(
  character: Pick<Character, "countryId" | "singleplayerHeadOfState">,
  countryId: CountryId,
  localSingleplayer = isSingleplayer()
): boolean {
  return (
    localSingleplayer &&
    character.countryId === countryId &&
    character.singleplayerHeadOfState === true
  );
}

/** Countries where the authored executive path is a directly seated office. */
export function getSingleplayerHeadOfStateOfficeType(
  countryId: CountryId,
  preset?: string
): string | null {
  const config = getCountryConfig(countryId, preset);
  // Seat the governing executive in HoS mode: presidents for presidential
  // systems, and the authored executive office (PM/chancellor/premier) for
  // parliamentary and one-party systems. This avoids assigning a ceremonial
  // president where the playable office is the head of government.
  if (config.governmentType === "presidential") return "president";
  return config.officeTypes.find((office) => office.isExecutive)?.key ?? null;
}

function isDirectSingleplayerGovernment(countryId: CountryId, preset?: string): boolean {
  const config = getCountryConfig(countryId, preset);
  return config.governmentType !== "presidential" && isParliamentarySystem(config);
}

function supportingSeats(
  government: Pick<GovernmentFormation, "governingPartyId" | "coalitionPartyIds" | "seatsByParty">
): number {
  const partyIds = new Set([
    ...(government.governingPartyId ? [government.governingPartyId] : []),
    ...(government.coalitionPartyIds ?? []),
  ]);
  return [...partyIds].reduce(
    (total, partyId) => total + (government.seatsByParty?.[partyId] ?? 0),
    0
  );
}

function sameSeatSnapshot(
  current: Record<string, number> | null | undefined,
  next: Record<string, number>
): boolean {
  const keys = new Set([...Object.keys(current ?? {}), ...Object.keys(next)]);
  return [...keys].every((key) => (current?.[key] ?? 0) === (next[key] ?? 0));
}

/**
 * Write the canonical government formation after directly seating the local
 * player. The character office is useful for profile and legislature views,
 * but governmentFormations is the source used by executive powers, budgets,
 * confidence and turn processing.
 */
async function formSingleplayerGovernment(
  db: Db,
  args: { countryId: CountryId; character: Character; now: Date; preset?: string }
): Promise<void> {
  const government = await getGovernmentFormationsCollection(db).findOne({ _id: args.countryId });
  if (!government) return;

  const gameState = await getGameState(db);
  const liveSeatsByParty = await tallySeatsByParty(db, args.countryId, args.preset);
  const seatsByParty =
    Object.keys(liveSeatsByParty).length > 0 ? liveSeatsByParty : (government.seatsByParty ?? {});
  const totalSeats = government.totalSeats || (await getLiveLowerChamberSeats(db, args.countryId));
  const majorityThreshold =
    government.majorityThreshold || lowerChamberMajorityThreshold(totalSeats);
  const governingPartyId =
    government.governingPartyId ??
    (args.character.party && args.character.party !== "independent"
      ? args.character.party
      : (getCountryConfig(args.countryId, args.preset).rulingPartyId?.toString() ?? null));
  const formationType =
    government.formationType ??
    (governingPartyId && (seatsByParty[governingPartyId] ?? 0) >= majorityThreshold
      ? "majority"
      : governingPartyId
        ? "minority"
        : "admin");
  const formedAt = government.formedAt ?? args.now;
  const formedTurn = government.formedTurn ?? gameState?.currentTurn ?? null;
  const totalSeatsSupporting = supportingSeats({
    governingPartyId,
    coalitionPartyIds: government.coalitionPartyIds,
    seatsByParty,
  });

  if (
    government.status === "formed" &&
    government.formationType === formationType &&
    government.pmCharacterId?.toString() === args.character._id.toString() &&
    government.pmName === args.character.name &&
    government.pmNppId == null &&
    government.governingPartyId === governingPartyId &&
    sameSeatSnapshot(government.seatsByParty, seatsByParty) &&
    government.totalSeats === totalSeats &&
    government.majorityThreshold === majorityThreshold &&
    government.totalSeatsSupporting === totalSeatsSupporting &&
    government.activeVoteId == null &&
    government.pmVacancyDeadlineTurn == null &&
    government.lostMajority === false &&
    government.collapsedAt == null
  ) {
    return;
  }

  await getGovernmentFormationsCollection(db).updateOne(
    { _id: args.countryId },
    {
      $set: {
        status: "formed",
        formationType,
        lostMajority: false,
        pmCharacterId: args.character._id,
        pmNppId: null,
        pmName: args.character.name,
        governingPartyId,
        seatsByParty,
        totalSeats,
        majorityThreshold,
        totalSeatsSupporting,
        activeVoteId: null,
        formedAt,
        formedTurn,
        collapsedAt: null,
        pmVacancyDeadlineTurn: null,
        updatedAt: args.now,
      },
      $unset: {
        pmAppointmentNominationLockId: "",
        pmAppointmentNominationLockExpiresAt: "",
      },
    }
  );
}

/**
 * Seat the local character through the same electedOfficials/currentOffice
 * records consumed by the game. This is intentionally local-only: callers
 * must prove the singleplayer config before invoking it.
 */
export async function seatSingleplayerHeadOfState(
  db: Db,
  args: { characterId: ObjectId; countryId: CountryId; now: Date; preset?: string }
): Promise<boolean> {
  const officeType = getSingleplayerHeadOfStateOfficeType(args.countryId, args.preset);
  if (!officeType) return false;
  const character = await db.collection<Character>("characters").findOne({ _id: args.characterId });
  if (!character || character.countryId !== args.countryId) return false;

  if (isDirectSingleplayerGovernment(args.countryId, args.preset)) {
    await ensureParliamentaryGovernmentFormation(db, args.countryId, args.preset);
    const government = await getGovernmentFormationsCollection(db).findOne({ _id: args.countryId });
    const alreadyHoldsOffice = character.currentOffice?.type === officeType;
    const isCanonicalHolder =
      government?.status === "formed" &&
      government.pmCharacterId?.toString() === character._id.toString();
    const hasConflictingGovernmentHolder =
      government?.pmCharacterId != null || government?.pmNppId != null;
    if (!alreadyHoldsOffice || (hasConflictingGovernmentHolder && !isCanonicalHolder)) {
      await appointPrimeMinister(
        db,
        args.countryId,
        args.characterId,
        null,
        character.name,
        args.now,
        args.preset
      );
    }
    await formSingleplayerGovernment(db, { ...args, character });
    return true;
  }

  const office: OfficeType =
    officeType === "president" ? { type: "president" } : ({ type: officeType } as OfficeType);
  const filter: Record<string, unknown> =
    officeType === "president"
      ? getExecutiveOfficialFilter(args.countryId, "president")
      : { countryId: args.countryId, officeType };

  await db.collection<ElectedOfficial>("electedOfficials").updateMany(
    { countryId: args.countryId, officeType, characterId: { $ne: args.characterId } },
    {
      $set: {
        characterId: null,
        isNPP: false,
        updatedAt: args.now,
      },
      $unset: { nppId: "", characterName: "", party: "" },
    }
  );
  await db
    .collection<NPP>("npps")
    .updateMany(
      { countryId: args.countryId, "currentOffice.type": officeType },
      { $set: { currentOffice: null, updatedAt: args.now } }
    );
  await db.collection<Character>("characters").updateMany(
    {
      countryId: args.countryId,
      "currentOffice.type": officeType,
      _id: { $ne: args.characterId },
    },
    { $set: { currentOffice: null, updatedAt: args.now } }
  );
  await db.collection<ElectedOfficial>("electedOfficials").updateOne(
    filter,
    {
      $set: {
        countryId: args.countryId,
        officeType,
        characterId: args.characterId,
        characterName: character.name,
        party: character.party,
        isNPP: false,
        electedAt: args.now,
        updatedAt: args.now,
      },
      $unset: { nppId: "" },
      $setOnInsert: { createdAt: args.now },
    },
    { upsert: true }
  );
  await db
    .collection<Character>("characters")
    .updateOne({ _id: args.characterId }, { $set: { currentOffice: office, updatedAt: args.now } });
  return true;
}

/**
 * Repair an existing local HOS world. Version 1.8.3 only ran the seating path
 * during character creation, leaving old worlds with a character office but no
 * canonical government formation. This pass is local-only and idempotent.
 */
export async function reconcileSingleplayerHeadOfState(
  db: Db,
  args: { now?: Date; preset?: string } = {}
): Promise<boolean> {
  if (!isSingleplayer()) return false;

  const gameState = await getGameState(db);
  if (gameState?.singleplayerConfig?.mode !== "head-of-state") return false;

  const character = await db.collection<Character>("characters").findOne({
    userId: new ObjectId(SINGLEPLAYER_USER_ID),
    retiredAt: { $exists: false },
  });
  if (!character) return false;

  const countryId = character.countryId;
  const preset = args.preset ?? gameState.preset;
  if (!getSingleplayerHeadOfStateOfficeType(countryId, preset)) return false;

  if (character.singleplayerHeadOfState !== true) {
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: character._id },
        { $set: { singleplayerHeadOfState: true, updatedAt: args.now ?? new Date() } }
      );
  }

  return seatSingleplayerHeadOfState(db, {
    characterId: character._id,
    countryId,
    now: args.now ?? new Date(),
    preset,
  });
}

export async function pinnedSingleplayerHeadOfState(
  db: Db,
  countryId: CountryId
): Promise<Character | null> {
  if (!isSingleplayer()) return null;
  return db.collection<Character>("characters").findOne({
    countryId,
    singleplayerHeadOfState: true,
    retiredAt: { $exists: false },
  });
}

export const SINGLEPLAYER_HEAD_OF_STATE_COUNTRIES = Object.values(COUNTRY_CONFIGS)
  .filter((config) => Boolean(getSingleplayerHeadOfStateOfficeType(config.id)))
  .map((config) => config.id);
