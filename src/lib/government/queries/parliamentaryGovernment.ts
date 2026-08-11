import { badRequest, forbidden, notFound, unauthorized } from "@/lib/api/errors";
import {
  getNoConfidenceVotesCollection,
  getPMAppointmentVotesCollection,
  getGovernmentFormationsCollection,
} from "@/lib/db/collections/governmentFormation";
import { checkAppointmentEligibility, tallySeatsByParty } from "@/lib/turn/parliamentaryGovernment";
import { getParliamentaryCountryConfig } from "@/lib/government/parliamentaryCountry";
import {
  getLowerChamberOfficeType,
  getJointSittingOfficeTypes,
} from "@/lib/legislature/chamberOfficeType";
import { getCountryConfig } from "@/lib/constants/countries";
import { ObjectId, type Db } from "mongodb";
import type { Character, ElectedOfficial, NPP, PoliticalParty } from "@/lib/db/types";
import type {
  EligibleSenateAppointeeView,
  NoConfidenceVoteView,
  PmAppointmentCandidateView,
  PmAppointmentVoteView,
  VacancyView,
} from "@/lib/government/dto/governmentView";
import { isFilledOfficial } from "@/lib/governors/senateVacancy";
import { US_SENATE_2020 } from "@/lib/constants/historicalSeats";
import type { CountryId } from "@/lib/constants/countries";

export async function getPmAppointmentCandidates(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId
): Promise<{ candidates: PmAppointmentCandidateView[]; callerHasActiveVote: boolean }> {
  // Validates the country has a parliamentary config (throws otherwise).
  getParliamentaryCountryConfig(countryId);
  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!govFormation) {
    throw badRequest("PM appointment is only available when government formation is pending");
  }
  if (govFormation.status !== "pending") {
    const activeVonc = await getNoConfidenceVotesCollection(db).findOne({
      countryId,
      status: "active",
    });
    if (!activeVonc) {
      throw badRequest(
        "PM appointment is only available when government formation is pending or a vote of no confidence is active"
      );
    }
  }

  const eligibility = await checkAppointmentEligibility(
    db,
    countryId,
    characterId,
    govFormation.majorityThreshold
  );
  // Seat counts per candidate party for the response display. Computed live from
  // electedOfficials — same source `checkAppointmentEligibility` uses internally —
  // rather than trusting `govFormation.seatsByParty`, which is a write-triggered
  // cache (only refreshed on specific turn-processor events: NC-vote resolution,
  // cycle rollover, PM appointment) and can drift arbitrarily far from the real
  // chamber between those events. Measured in the field: BR/NG summed to 0
  // against real totals of 513/360, DE showed 630 against a real 487.
  const seatsByParty = await tallySeatsByParty(db, countryId);
  if (!eligibility.eligible) {
    throw forbidden("You are not eligible to nominate a PM candidate");
  }

  // PM votes only — head-of-state votes share the collection (office:
  // "headOfState") and have their own candidates query below.
  const existingVote = await getPMAppointmentVotesCollection(db).findOne(
    eligibility.coalitionId != null
      ? {
          countryId,
          status: "active" as const,
          office: { $exists: false },
          coalitionId: eligibility.coalitionId,
        }
      : {
          countryId,
          status: "active" as const,
          office: { $exists: false },
          coalitionId: null,
          nomineePartyId: String(eligibility.qualifyingPartyIds[0]),
        }
  );

  const lowerChamberKey = getLowerChamberOfficeType(countryId);
  const qualifyingPartyIdStrings = eligibility.qualifyingPartyIds.map(String);
  const lowerChamberMPs = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId,
      officeType: lowerChamberKey,
      isNPP: { $ne: true },
      party: { $in: qualifyingPartyIdStrings },
    })
    .toArray();

  const charIds = lowerChamberMPs
    .map((mp) => mp.characterId)
    .filter((id): id is ObjectId => id != null);
  const characters = await db
    .collection<{ _id: ObjectId; name: string; party?: string; userId?: ObjectId }>("characters")
    .find({ _id: { $in: charIds }, userId: { $exists: true } })
    .toArray();
  const charMap = new Map(characters.map((char) => [char._id.toString(), char]));

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, sequentialId: { $in: eligibility.qualifyingPartyIds } })
    .toArray();
  const partyNameMap = new Map(parties.map((party) => [party.sequentialId.toString(), party.name]));

  return {
    candidates: lowerChamberMPs
      .filter((mp) => mp.characterId && charMap.has(mp.characterId.toString()))
      .map((mp) => {
        const char = charMap.get(mp.characterId!.toString())!;
        return {
          _id: char._id.toString(),
          name: char.name,
          party: mp.party ?? char.party ?? null,
          partyName: partyNameMap.get(mp.party ?? char.party ?? "") ?? null,
          seatsHeld: mp.seatsHeld ?? 1,
          seatsByParty: seatsByParty[mp.party ?? char.party ?? ""] ?? 0,
        };
      }),
    callerHasActiveVote: existingVote != null,
  };
}

/**
 * Candidates for a legislature-appointed head of state (RU Chairman of the
 * Presidium — spec §2.3). Mirrors getPmAppointmentCandidates with the 4b
 * differences: gated on headOfStateSelection, requires the office VACANT,
 * and candidates may sit in EITHER chamber (joint sitting).
 */
export async function getHosAppointmentCandidates(
  db: Db,
  countryId: CountryId,
  characterId: ObjectId
): Promise<{ candidates: PmAppointmentCandidateView[]; callerHasActiveVote: boolean }> {
  getParliamentaryCountryConfig(countryId);
  const config = getCountryConfig(countryId);
  if (config.headOfStateSelection !== "legislatureAppointment") {
    throw badRequest("This country's head of state is not appointed by the legislature");
  }
  const govFormation = await getGovernmentFormationsCollection(db).findOne({ _id: countryId });
  if (!govFormation) {
    throw badRequest("Government formation record not found");
  }
  if (govFormation.hosCharacterId != null || govFormation.hosNppId != null) {
    throw badRequest(`The office of ${config.headOfStateTitle} is currently filled`);
  }

  const eligibility = await checkAppointmentEligibility(
    db,
    countryId,
    characterId,
    govFormation.majorityThreshold
  );
  if (!eligibility.eligible) {
    throw forbidden(`You are not eligible to nominate a ${config.headOfStateTitle} candidate`);
  }

  const existingVote = await getPMAppointmentVotesCollection(db).findOne(
    eligibility.coalitionId != null
      ? {
          countryId,
          status: "active" as const,
          office: "headOfState" as const,
          coalitionId: eligibility.coalitionId,
        }
      : {
          countryId,
          status: "active" as const,
          office: "headOfState" as const,
          coalitionId: null,
          nomineePartyId: String(eligibility.qualifyingPartyIds[0]),
        }
  );

  const qualifyingPartyIdStrings = eligibility.qualifyingPartyIds.map(String);
  const deputies = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({
      countryId,
      officeType: { $in: getJointSittingOfficeTypes(countryId) },
      isNPP: { $ne: true },
      party: { $in: qualifyingPartyIdStrings },
    })
    .toArray();

  // Seat counts per qualifying party for the response display, tallied live from
  // the joint-sitting `deputies` just fetched (both chambers when the country has
  // one) rather than the stale `governmentFormations.seatsByParty` cache — which
  // is only refreshed on specific turn-processor events and can drift arbitrarily
  // far from the real chamber between them (measured: BR/NG summed to 0 against
  // real totals of 513/360, DE showed 630 against a real 487). `tallySeatsByParty`
  // isn't reused here because it only scopes the lower chamber; a legislature-
  // appointed head of state's electorate spans every joint-sitting chamber.
  const seatsByParty: Record<string, number> = {};
  for (const mp of deputies) {
    if (!mp.party) continue;
    seatsByParty[mp.party] = (seatsByParty[mp.party] ?? 0) + (mp.seatsHeld ?? 1);
  }

  const charIds = deputies.map((mp) => mp.characterId).filter((id): id is ObjectId => id != null);
  const characters = await db
    .collection<{ _id: ObjectId; name: string; party?: string; userId?: ObjectId }>("characters")
    .find({ _id: { $in: charIds }, userId: { $exists: true } })
    .toArray();
  const charMap = new Map(characters.map((char) => [char._id.toString(), char]));

  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ countryId, sequentialId: { $in: eligibility.qualifyingPartyIds } })
    .toArray();
  const partyNameMap = new Map(parties.map((party) => [party.sequentialId.toString(), party.name]));

  return {
    candidates: deputies
      .filter((mp) => mp.characterId && charMap.has(mp.characterId.toString()))
      .map((mp) => {
        const char = charMap.get(mp.characterId!.toString())!;
        return {
          _id: char._id.toString(),
          name: char.name,
          party: mp.party ?? char.party ?? null,
          partyName: partyNameMap.get(mp.party ?? char.party ?? "") ?? null,
          seatsHeld: mp.seatsHeld ?? 1,
          seatsByParty: seatsByParty[mp.party ?? char.party ?? ""] ?? 0,
        };
      }),
    callerHasActiveVote: existingVote != null,
  };
}

export async function getPmAppointmentVoteView(
  db: Db,
  countryId: CountryId,
  voteId: string,
  viewerUserId: string | null
): Promise<PmAppointmentVoteView> {
  if (!ObjectId.isValid(voteId)) {
    throw badRequest("Invalid vote ID format");
  }

  const voteDoc = await getPMAppointmentVotesCollection(db).findOne({
    _id: new ObjectId(voteId),
    countryId,
  });
  if (!voteDoc) {
    throw notFound("PM appointment vote not found");
  }

  const { viewerVote, myWhippedFrom } = await getViewerVoteContext(
    db,
    viewerUserId,
    voteDoc.votes,
    voteDoc.whippedFromVote
  );

  return {
    _id: voteDoc._id.toString(),
    countryId: voteDoc.countryId,
    nomineeCharacterId: voteDoc.nomineeCharacterId.toString(),
    nomineeName: voteDoc.nomineeName,
    nomineePartyId: voteDoc.nomineePartyId,
    nominatedByCharacterId: voteDoc.nominatedByCharacterId.toString(),
    formationType: voteDoc.formationType,
    coalitionId: voteDoc.coalitionId,
    coalitionPartyIds: voteDoc.coalitionPartyIds,
    votesFor: voteDoc.votesFor,
    votesAgainst: voteDoc.votesAgainst,
    status: voteDoc.status,
    openedAt: voteDoc.openedAt.toISOString(),
    closesAt: voteDoc.closesAt.toISOString(),
    closesOnTurn: voteDoc.closesOnTurn ?? null,
    closedAt: voteDoc.closedAt?.toISOString() ?? null,
    viewerVote,
    myWhippedFrom,
  };
}

export async function getNoConfidenceVoteView(
  db: Db,
  countryId: CountryId,
  voteId: string,
  viewerUserId: string | null
): Promise<NoConfidenceVoteView> {
  if (!ObjectId.isValid(voteId)) {
    throw badRequest("Invalid vote ID format");
  }

  const voteDoc = await getNoConfidenceVotesCollection(db).findOne({
    _id: new ObjectId(voteId),
    countryId,
  });
  if (!voteDoc) {
    throw notFound("No-confidence vote not found");
  }

  const { viewerVote, myWhippedFrom } = await getViewerVoteContext(
    db,
    viewerUserId,
    voteDoc.votes,
    voteDoc.whippedFromVote
  );

  return {
    _id: voteDoc._id.toString(),
    countryId: voteDoc.countryId,
    proposedByCharacterId: voteDoc.proposedByCharacterId?.toString() ?? null,
    proposedByName: voteDoc.proposedByName,
    targetPmCharacterId: voteDoc.targetPmCharacterId.toString(),
    targetPmName: voteDoc.targetPmName,
    votesFor: voteDoc.votesFor,
    votesAgainst: voteDoc.votesAgainst,
    status: voteDoc.status,
    openedAt: voteDoc.openedAt.toISOString(),
    closesAt: voteDoc.closesAt.toISOString(),
    closesOnTurn: voteDoc.closesOnTurn ?? null,
    closedAt: voteDoc.closedAt?.toISOString() ?? null,
    turnProposed: voteDoc.turnProposed,
    viewerVote,
    myWhippedFrom,
  };
}

export async function getEligibleSenateAppointees(
  db: Db,
  governorUserId: string,
  senateClass: 1 | 2 | 3
): Promise<{ candidates: EligibleSenateAppointeeView[] }> {
  const officialsCollection = db.collection<ElectedOfficial>("electedOfficials");
  const charactersCollection = db.collection<Character>("characters");
  const nppsCollection = db.collection<NPP>("npps");

  const governorCharacter = await charactersCollection.findOne({
    userId: new ObjectId(governorUserId),
  });
  if (!governorCharacter) {
    throw unauthorized("You must be a governor to view eligible appointees");
  }

  const governorOfficial = await officialsCollection.findOne({
    characterId: governorCharacter._id,
    countryId: "US",
    officeType: "governor",
  });
  if (!governorOfficial || !governorOfficial.state) {
    throw unauthorized("You must be a governor to view eligible appointees");
  }

  const validSeat = US_SENATE_2020.some(
    (seat) => seat.state === governorOfficial.state && seat.senateClass === senateClass
  );
  if (!validSeat) {
    throw badRequest("No Senate seat exists for this state and class");
  }

  const senateSeat = await officialsCollection.findOne({
    officeType: "senate",
    state: governorOfficial.state,
    senateClass,
  });
  if (isFilledOfficial(senateSeat)) {
    throw badRequest("No vacancy exists for this Senate seat");
  }

  const [eligibleChars, eligibleNpps, occupiedOfficials] = await Promise.all([
    charactersCollection
      .find({ homeState: governorOfficial.state, userId: { $exists: true } })
      .toArray(),
    nppsCollection.find({ homeState: governorOfficial.state, retiredAt: null }).toArray(),
    officialsCollection
      .find({ $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true } }] })
      .toArray(),
  ]);

  const officialCharIds = new Set(
    occupiedOfficials
      .filter((official) => official.characterId)
      .map((official) => official.characterId!.toString())
  );
  const officialNppIds = new Set(
    occupiedOfficials
      .filter((official) => official.nppId)
      .map((official) => official.nppId!.toString())
  );

  const playerCandidates: EligibleSenateAppointeeView[] = eligibleChars
    .filter((char) => !char.currentOffice && !officialCharIds.has(char._id.toString()))
    .map((char) => ({
      appointeeId: char._id.toString(),
      appointeeType: "character",
      characterId: char._id.toString(),
      name: char.name,
      party: char.party,
      homeState: char.homeState,
    }));

  const nppCandidates: EligibleSenateAppointeeView[] = eligibleNpps
    .filter((npp) => !npp.currentOffice && !officialNppIds.has(npp._id.toString()))
    .map((npp) => ({
      appointeeId: npp._id.toString(),
      appointeeType: "npp",
      characterId: npp._id.toString(),
      name: npp.name,
      party: npp.party,
      homeState: npp.homeState,
    }));

  return { candidates: [...playerCandidates, ...nppCandidates] };
}

export async function getPublicVacancies(
  db: Db
): Promise<{ vacancies: Record<string, VacancyView[]> }> {
  const officialsCollection = db.collection<ElectedOfficial>("electedOfficials");
  const senateOfficials = await officialsCollection.find({ officeType: "senate" }).toArray();

  const filledSeats = new Set<string>();
  for (const official of senateOfficials) {
    if (official.state && official.senateClass && isFilledOfficial(official)) {
      filledSeats.add(`${official.state}-${official.senateClass}`);
    }
  }

  const senateVacancies: VacancyView[] = [];
  for (const seat of US_SENATE_2020) {
    if (seat.senateClass && !filledSeats.has(`${seat.state}-${seat.senateClass}`)) {
      senateVacancies.push({
        officeType: "senate",
        state: seat.state,
        senateClass: seat.senateClass,
      });
    }
  }

  // A real mid-term vacancy is an EXISTING official row left unheld — a
  // `characterId: null` (and no NPP) tombstone from resign/retire/removal.
  // States that never seated an official have no row and are filled by the
  // regular cycle, so they are NOT vacancies (matches byElectionWatcher).
  //
  // Fixes #3275: the prior governor logic did the inverse — it treated any
  // governor row (including tombstones) as "filled" and reported never-seated
  // states as vacant. House/stateSenate were also hard-coded empty.
  const collectRowVacancies = (
    rows: ElectedOfficial[],
    officeType: VacancyView["officeType"]
  ): VacancyView[] =>
    rows
      .filter((o) => o.state && !isFilledOfficial(o))
      .map((o) => ({ officeType, state: o.state as string }));

  const [governorOfficials, houseOfficials, stateSenateOfficials] = await Promise.all([
    officialsCollection.find({ officeType: "governor" }).toArray(),
    officialsCollection.find({ officeType: "house" }).toArray(),
    officialsCollection.find({ officeType: "stateSenate" }).toArray(),
  ]);

  return {
    vacancies: {
      senate: senateVacancies,
      house: collectRowVacancies(houseOfficials, "house"),
      governor: collectRowVacancies(governorOfficials, "governor"),
      stateSenate: collectRowVacancies(stateSenateOfficials, "stateSenate"),
      commons: [],
    },
  };
}

async function getViewerVoteContext(
  db: Db,
  viewerUserId: string | null,
  votes: Record<string, "aye" | "nay">,
  whippedFromVote?: Record<string, string>
): Promise<{ viewerVote: "aye" | "nay" | null; myWhippedFrom: string | null }> {
  if (!viewerUserId) {
    return { viewerVote: null, myWhippedFrom: null };
  }

  const viewerChar = await db
    .collection<Character>("characters")
    .findOne({ userId: new ObjectId(viewerUserId) }, { projection: { _id: 1 } });
  if (!viewerChar) {
    return { viewerVote: null, myWhippedFrom: null };
  }

  const key = viewerChar._id.toString();
  return {
    viewerVote: votes[key] ?? null,
    myWhippedFrom: whippedFromVote?.[key] ?? null,
  };
}
