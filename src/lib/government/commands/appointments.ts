import { badRequest, notFound, unauthorized } from "@/lib/api/errors";
import { isSameCountry } from "@/lib/api/sameCountry";
import { createAdminLog } from "@/lib/adminLog";
import { createNotification } from "@/lib/notifications";
import { getOfficeLabel } from "@/lib/utils/politics";
import { getExecutiveOfficeKey, type CountryId } from "@/lib/constants/countries";
import { PM_VACANCY_DEADLINE_TURNS } from "@/lib/constants/turnTime";
import { getGameState } from "@/lib/gameState";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { isFilledOfficial } from "@/lib/governors/senateVacancy";
import { US_SENATE_2020 } from "@/lib/constants/historicalSeats";
import { ObjectId, type Db } from "mongodb";
import type { Character, CareerEvent, ElectedOfficial, NPP, OfficeType } from "@/lib/db/types";
import type { CountryConfig } from "@/lib/constants/countries";
import type { EligibleSenateAppointeeView } from "@/lib/government/dto/governmentView";

export async function adminAppointPrimeMinister(
  db: Db,
  adminUsername: string,
  countryId: CountryId,
  countryConfig: CountryConfig,
  characterId: string | null
): Promise<{ success: true; message: string }> {
  const now = new Date();

  let character: Character | null = null;
  if (characterId) {
    if (!ObjectId.isValid(characterId)) {
      throw badRequest("Invalid characterId");
    }
    character = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(characterId) });
    if (!character) {
      throw notFound("Character not found");
    }
    if (!isSameCountry(character, { countryId })) {
      throw badRequest(
        `Only ${countryConfig.name} characters can be appointed ${countryConfig.executiveTitle}`
      );
    }
  }

  const execKey = getExecutiveOfficeKey(countryId);
  await db
    .collection<Character>("characters")
    .updateMany(
      { "currentOffice.type": execKey, countryId },
      { $set: { currentOffice: null, updatedAt: now } }
    );

  if (character) {
    const prev = character.currentOffice;
    const pmOffice: OfficeType = {
      type: execKey,
      ...(prev && "state" in prev && typeof prev.state === "string"
        ? {
            state: prev.state,
            ...("constituency" in prev && prev.constituency != null
              ? { constituency: prev.constituency as string }
              : {}),
            ...("constituencyId" in prev && prev.constituencyId != null
              ? { constituencyId: prev.constituencyId as string }
              : {}),
          }
        : {}),
    };
    const pmCareer: CareerEvent = {
      type: "appointed",
      office: pmOffice,
      officeLabel: getOfficeLabel(pmOffice, countryId),
      date: now,
      ...(character.party ? { party: character.party, partyCountryId: countryId } : {}),
    };
    await db
      .collection<Character>("characters")
      .updateOne(
        { _id: character._id },
        { $set: { currentOffice: pmOffice, updatedAt: now }, $push: { careerHistory: pmCareer } }
      );
  }

  const govCol = getGovernmentFormationsCollection(db);
  const lowerChamberKey = countryConfig.legislature.lowerChamber.key;
  if (character) {
    const partySeqId = character.party?.toString();
    let partySeats = 0;
    if (partySeqId) {
      const officials = await db
        .collection<ElectedOfficial>("electedOfficials")
        .find({
          officeType: lowerChamberKey,
          countryId,
          party: partySeqId,
        })
        .toArray();
      partySeats = officials.reduce((sum, official) => sum + (official.seatsHeld ?? 1), 0);
    }

    await govCol.updateOne(
      { _id: countryId },
      {
        $set: {
          status: "formed",
          formationType: "admin",
          pmCharacterId: character._id,
          pmName: character.name,
          governingPartyId: partySeqId ?? null,
          totalSeatsSupporting: partySeats,
          lostMajority: false,
          activeVoteId: null,
          formedAt: now,
          snapElectionsUsed: 0,
          lastSnapElectionTurn: null,
          pmVacancyDeadlineTurn: null,
          updatedAt: now,
        },
      },
      { upsert: true }
    );
  } else {
    const currentTurn = (await getGameState(db))?.currentTurn ?? 0;
    await govCol.updateOne(
      { _id: countryId },
      {
        $set: {
          status: "pending",
          formationType: null,
          pmCharacterId: null,
          pmName: null,
          lostMajority: false,
          activeVoteId: null,
          formedAt: null,
          pmVacancyDeadlineTurn: currentTurn + PM_VACANCY_DEADLINE_TURNS,
          updatedAt: now,
        },
      }
    );
    await Promise.all([
      db.collection("cabinetMembers").deleteMany({ countryId }),
      db.collection("ukCabinetCooldowns").deleteMany({ countryId }),
    ]);
  }

  await createAdminLog({
    category: "election",
    action: character ? "official_appointed" : "official_removed",
    username: adminUsername,
    characterName: character?.name ?? "—",
    adminUsername,
    details: character
      ? `Appointed ${character.name} as ${countryConfig.name} ${countryConfig.executiveTitle}`
      : `Vacated ${countryConfig.name} ${countryConfig.executiveTitle} position`,
  });

  if (character) {
    await createNotification({
      userId: character.userId,
      type: "system",
      title: `Appointed ${countryConfig.executiveTitle}`,
      message: `You have been appointed ${countryConfig.executiveTitle} of ${countryConfig.name} by an admin.`,
      metadata: { officeType: execKey, type: "executive_appointed" },
    });
  }

  return {
    success: true,
    message: character
      ? `${character.name} appointed as ${countryConfig.executiveTitle}`
      : `${countryConfig.executiveTitle} position vacated`,
  };
}

export async function appointSenator(
  db: Db,
  governorUserId: string,
  input: {
    appointeeId?: string;
    characterId?: string;
    appointeeType: "character" | "npp";
    senateClass: 1 | 2 | 3;
  }
): Promise<{
  success: true;
  appointee: EligibleSenateAppointeeView;
  termEnd: string;
}> {
  const appointeeIdRaw = input.appointeeId ?? input.characterId;
  if (!appointeeIdRaw || !ObjectId.isValid(appointeeIdRaw)) {
    throw badRequest("appointeeId is required");
  }
  const appointeeId = new ObjectId(appointeeIdRaw);

  const officialsCollection = db.collection<ElectedOfficial>("electedOfficials");
  const charactersCollection = db.collection<Character>("characters");
  const nppsCollection = db.collection<NPP>("npps");

  const governorCharacter = await charactersCollection.findOne({
    userId: new ObjectId(governorUserId),
  });
  if (!governorCharacter) {
    throw unauthorized("You must be a governor to appoint senators");
  }

  const governorOfficial = await officialsCollection.findOne({
    characterId: governorCharacter._id,
    countryId: "US",
    officeType: "governor",
  });
  if (!governorOfficial || !governorOfficial.state || !governorOfficial.characterId) {
    throw unauthorized("You must be a governor to appoint senators");
  }

  const validSeat = US_SENATE_2020.some(
    (seat) => seat.state === governorOfficial.state && seat.senateClass === input.senateClass
  );
  if (!validSeat) {
    throw badRequest("No Senate seat exists for this state and class");
  }

  const senateSeat = await officialsCollection.findOne({
    officeType: "senate",
    state: governorOfficial.state,
    senateClass: input.senateClass,
  });
  if (isFilledOfficial(senateSeat)) {
    throw badRequest("No vacancy exists for this Senate seat");
  }

  const officeType: OfficeType = {
    type: "senate",
    state: governorOfficial.state,
    senateClass: input.senateClass,
  };

  const now = new Date();
  let appointeeName: string;
  let appointeeParty: string;
  let appointeeUserId: ObjectId | undefined;

  if (input.appointeeType === "npp") {
    const npp = await nppsCollection.findOne({ _id: appointeeId });
    if (!npp) {
      throw notFound("NPP not found");
    }
    if (npp.retiredAt) {
      throw badRequest("Cannot appoint a retired NPP");
    }
    if (npp.homeState !== governorOfficial.state) {
      throw badRequest("Appointee must be from your state");
    }
    const existingOffice = await officialsCollection.findOne({ nppId: appointeeId });
    if (existingOffice || npp.currentOffice) {
      throw badRequest("Appointee already holds an elected office");
    }
    appointeeName = npp.name;
    appointeeParty = npp.party;
  } else {
    const appointee = await charactersCollection.findOne({ _id: appointeeId });
    if (!appointee) {
      throw notFound("Character not found");
    }
    if (!appointee.userId) {
      throw badRequest("Character must belong to a player");
    }
    if (appointee.homeState !== governorOfficial.state) {
      throw badRequest("Appointee must be from your state");
    }
    const existingOffice = await officialsCollection.findOne({ characterId: appointeeId });
    if (existingOffice || appointee.currentOffice) {
      throw badRequest("Appointee already holds an elected office");
    }
    appointeeName = appointee.name;
    appointeeParty = appointee.party;
    appointeeUserId = appointee.userId;
  }

  const nextClassElection = await db.collection("elections").findOne(
    {
      electionType: "senate",
      state: governorOfficial.state,
      senateClass: input.senateClass,
      status: { $in: ["upcoming", "active"] },
    },
    { sort: { startTime: 1 } }
  );
  const termEnd =
    nextClassElection?.endTime instanceof Date
      ? nextClassElection.endTime
      : new Date(Date.now() + 6 * 365 * 24 * 60 * 60 * 1000);

  const officialFields: Partial<ElectedOfficial> = {
    officeType: "senate",
    state: governorOfficial.state,
    senateClass: input.senateClass,
    characterId: input.appointeeType === "character" ? appointeeId : null,
    characterName: appointeeName,
    party: appointeeParty,
    isNPP: input.appointeeType === "npp",
    isAppointment: true,
    appointedBy: governorOfficial.characterId,
    electedAt: now,
    termEnds: termEnd,
    updatedAt: now,
  };
  if (input.appointeeType === "npp") {
    officialFields.nppId = appointeeId;
  }

  if (senateSeat) {
    await officialsCollection.updateOne(
      { _id: senateSeat._id },
      {
        $set: officialFields,
        $unset: input.appointeeType === "character" ? { nppId: "" } : {},
      }
    );
  } else {
    await officialsCollection.insertOne({
      _id: new ObjectId(),
      createdAt: now,
      ...officialFields,
    } as ElectedOfficial);
  }

  if (input.appointeeType === "npp") {
    await nppsCollection.updateOne(
      { _id: appointeeId },
      { $set: { currentOffice: officeType, party: appointeeParty, updatedAt: now } }
    );
  } else {
    await charactersCollection.updateOne(
      { _id: appointeeId },
      { $set: { currentOffice: officeType, updatedAt: now } }
    );
  }

  if (appointeeUserId) {
    await createNotification({
      userId: appointeeUserId,
      title: "Appointed to US Senate",
      message: `You have been appointed as US Senator for ${governorOfficial.state} (Class ${input.senateClass}) until ${termEnd.toLocaleDateString()}.`,
      type: "system",
    });
  }
  if (governorCharacter.userId) {
    await createNotification({
      userId: governorCharacter.userId,
      title: "Senator Appointed",
      message: `You have appointed ${appointeeName} as US Senator for ${governorOfficial.state}.`,
      type: "system",
    });
  }

  return {
    success: true,
    appointee: {
      appointeeId: appointeeId.toString(),
      appointeeType: input.appointeeType,
      characterId: appointeeId.toString(),
      name: appointeeName,
      party: appointeeParty,
      homeState: governorOfficial.state,
    },
    termEnd: termEnd.toISOString(),
  };
}
