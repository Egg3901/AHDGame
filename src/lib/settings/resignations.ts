import { ObjectId, type Db } from "mongodb";
import {
  COUNTRY_CONFIGS,
  getCountryConfig,
  getExecutiveOfficeKey,
  type CountryId,
} from "@/lib/constants/countries";
import { getCabinetPositions } from "@/lib/constants/cabinetMechanics";
import { getGovernmentFormationsCollection } from "@/lib/db/collections/governmentFormation";
import { vacateCentralBankChairCharacter } from "@/lib/turn/centralBankChairSelection";
import { vacateFomcChairSeat } from "@/lib/centralBank/helpers";
import { unformGovernmentAndVacatePM } from "@/lib/turn/parliamentaryGovernment";
import { leadershipRoleLabel } from "@/lib/congress/leadership/electionRoleMap";
import { notifyGovernorOfSenateVacancy } from "@/lib/governors/senateVacancy";
import { resignExecutiveOffice } from "@/lib/elections/resignExecutiveOffice";
import { getOfficeLabel } from "@/lib/utils/politics";
import type {
  CabinetMember,
  Character,
  CentralBank,
  CongressLeader,
  ElectedOfficial,
  ElectionCandidate,
  ParliamentaryGovernment,
  PoliticalParty,
  StatePartyOrg,
} from "@/lib/db/types";

const PARTY_LEADERSHIP_FIELDS = ["chairId", "viceChairId", "treasurerId"] as const;
type PartyLeadershipField = (typeof PARTY_LEADERSHIP_FIELDS)[number];

const PARTY_LEADERSHIP_LABELS: Record<PartyLeadershipField, string> = {
  chairId: "Chair",
  viceChairId: "Vice-Chair",
  treasurerId: "Treasurer",
};

const CABINET_OFFICE_TYPES = new Set([
  "usCabinet",
  "ukCabinet",
  "parliamentaryCabinet",
  "deCabinet",
]);

export type ResignablePositionCategory =
  | "office"
  | "cabinet"
  | "national-party"
  | "state-party"
  | "legislative-leadership"
  | "central-bank";

export interface ResignablePosition {
  id: string;
  label: string;
  category: ResignablePositionCategory;
}

type PositionRecord = ResignablePosition &
  (
    | {
        kind: "official";
        official: ElectedOfficial;
      }
    | {
        kind: "prime-minister";
        countryId: CountryId;
      }
    | {
        kind: "cabinet";
        member: CabinetMember;
      }
    | {
        kind: "national-party";
        party: PoliticalParty;
        field: PartyLeadershipField;
      }
    | {
        kind: "state-party";
        organization: StatePartyOrg;
        field: PartyLeadershipField;
        partyName: string | null;
      }
    | {
        kind: "congress";
        leader: CongressLeader;
      }
    | {
        kind: "central-bank";
        bank: CentralBank;
      }
    | {
        kind: "current-office";
        office: Character["currentOffice"];
      }
  );

export type ResignPositionResult =
  { ok: true; label: string } | { ok: false; status: 400 | 404 | 409; error: string };

export interface ResignAllResult {
  message: string;
  resigned: string[];
}

function hasChanged(result: { matchedCount?: number; modifiedCount?: number }): boolean {
  return (result.matchedCount ?? 0) > 0 || (result.modifiedCount ?? 0) > 0;
}

function partyRoleId(partyId: ObjectId, field: PartyLeadershipField): string {
  return `national-party:${partyId.toString()}:${field}`;
}

function statePartyRoleId(orgId: string, field: PartyLeadershipField): string {
  return `state-party:${orgId}:${field}`;
}

function officialOffice(official: ElectedOfficial) {
  return {
    type: official.officeType,
    state: official.state,
    senateClass: official.senateClass,
    chamberClass: official.chamberClass,
    seatsHeld: official.seatsHeld,
    constituency: official.constituency,
    constituencyId: official.constituencyId,
  };
}

function currentOfficeMatchesOfficial(
  currentOffice: Character["currentOffice"],
  official: ElectedOfficial
): boolean {
  if (!currentOffice || currentOffice.type !== official.officeType) return false;

  const office = currentOffice as unknown as Record<string, unknown>;
  if (official.state && office.state && official.state !== office.state) return false;
  if (official.senateClass && office.senateClass && official.senateClass !== office.senateClass) {
    return false;
  }
  if (
    official.chamberClass &&
    office.chamberClass &&
    official.chamberClass !== office.chamberClass
  ) {
    return false;
  }
  if (
    official.constituencyId &&
    office.constituencyId &&
    official.constituencyId !== office.constituencyId
  ) {
    return false;
  }
  return true;
}

function currentOfficeMatchesCabinet(
  currentOffice: Character["currentOffice"],
  member: CabinetMember
): boolean {
  if (!currentOffice || !CABINET_OFFICE_TYPES.has(currentOffice.type)) return false;
  return "positionId" in currentOffice && currentOffice.positionId === member.positionId;
}

function currentOfficeMatchesExecutive(
  currentOffice: Character["currentOffice"],
  countryId: CountryId
): boolean {
  if (!currentOffice) return false;
  return currentOffice.type === getExecutiveOfficeKey(countryId);
}

async function clearCurrentOfficeForOffice(
  db: Db,
  characterId: ObjectId,
  office: Character["currentOffice"],
  now: Date
): Promise<void> {
  if (!office) return;

  const officeRecord = office as unknown as Record<string, unknown>;
  const filter: Record<string, unknown> = {
    _id: characterId,
    "currentOffice.type": office.type,
  };
  if (typeof officeRecord.state === "string") {
    filter["currentOffice.state"] = officeRecord.state;
  }
  if (typeof officeRecord.positionId === "string") {
    filter["currentOffice.positionId"] = officeRecord.positionId;
  }

  await db
    .collection<Character>("characters")
    .updateOne(filter, { $set: { currentOffice: null, updatedAt: now } });
}

async function discoverPositions(db: Db, character: Character): Promise<PositionRecord[]> {
  const characterId = character._id;
  const [
    officials,
    cabinetMembers,
    stateOrganizations,
    congressLeaders,
    governmentFormations,
    legacyGovernments,
    banks,
  ] = await Promise.all([
    db.collection<ElectedOfficial>("electedOfficials").find({ characterId }).toArray(),
    db.collection<CabinetMember>("cabinetMembers").find({ characterId }).toArray(),
    db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({
        $or: PARTY_LEADERSHIP_FIELDS.map((field) => ({ [field]: characterId })),
      })
      .toArray(),
    db.collection<CongressLeader>("congressLeaders").find({ characterId }).toArray(),
    getGovernmentFormationsCollection(db).find({ pmCharacterId: characterId }).toArray(),
    db
      .collection<ParliamentaryGovernment>("parliamentaryGovernments")
      .find({ pmCharacterId: characterId })
      .toArray(),
    db.collection<CentralBank>("centralBanks").find({ chairCharacterId: characterId }).toArray(),
  ]);

  const partyFilters: Record<string, unknown>[] = PARTY_LEADERSHIP_FIELDS.map((field) => ({
    [field]: characterId,
  }));
  for (const organization of stateOrganizations) {
    const sequentialId = Number(organization.partyId);
    if (Number.isInteger(sequentialId)) {
      partyFilters.push({ countryId: organization.countryId, sequentialId });
    }
  }
  const parties = await db
    .collection<PoliticalParty>("politicalParties")
    .find({ $or: partyFilters })
    .toArray();

  const positions: PositionRecord[] = [];

  for (const official of officials) {
    const countryId = official.countryId ?? character.countryId;
    positions.push({
      id: `official:${official._id.toString()}`,
      label: getOfficeLabel(officialOffice(official), countryId),
      category: "office",
      kind: "official",
      official,
    });
  }

  const pmCountryIds = new Set<CountryId>();
  for (const government of governmentFormations) {
    if (government._id in COUNTRY_CONFIGS) pmCountryIds.add(government._id as CountryId);
  }
  for (const government of legacyGovernments) {
    if (government._id in COUNTRY_CONFIGS) pmCountryIds.add(government._id as CountryId);
  }
  for (const countryId of pmCountryIds) {
    const country = getCountryConfig(countryId);
    positions.push({
      id: `prime-minister:${countryId}`,
      label: `${country.executiveTitle} of ${country.name}`,
      category: "office",
      kind: "prime-minister",
      countryId,
    });
  }

  for (const member of cabinetMembers) {
    const position = getCabinetPositions(member.countryId).find(
      (candidate) => candidate.id === member.positionId
    );
    positions.push({
      id: `cabinet:${member._id.toString()}`,
      label: `${position?.name ?? member.positionId} (${COUNTRY_CONFIGS[member.countryId]?.name ?? member.countryId} cabinet)`,
      category: "cabinet",
      kind: "cabinet",
      member,
    });
  }

  for (const party of parties) {
    for (const field of PARTY_LEADERSHIP_FIELDS) {
      if (party[field]?.toString() !== characterId.toString()) continue;
      positions.push({
        id: partyRoleId(party._id, field),
        label: `${party.name}: ${PARTY_LEADERSHIP_LABELS[field]}`,
        category: "national-party",
        kind: "national-party",
        party,
        field,
      });
    }
  }

  const partyNameByKey = new Map(
    parties.map((party) => [`${party.countryId}:${party.sequentialId}`, party.name])
  );
  for (const organization of stateOrganizations) {
    const partyName =
      partyNameByKey.get(`${organization.countryId}:${organization.partyId}`) ??
      `Party ${organization.partyId}`;
    for (const field of PARTY_LEADERSHIP_FIELDS) {
      if (organization[field]?.toString() !== characterId.toString()) continue;
      positions.push({
        id: statePartyRoleId(organization._id, field),
        label: `${partyName} ${organization.stateId}: ${PARTY_LEADERSHIP_LABELS[field]}`,
        category: "state-party",
        kind: "state-party",
        organization,
        field,
        partyName,
      });
    }
  }

  for (const leader of congressLeaders) {
    positions.push({
      id: `congress:${leader._id.toString()}`,
      label: leadershipRoleLabel(leader.role),
      category: "legislative-leadership",
      kind: "congress",
      leader,
    });
  }

  for (const bank of banks) {
    const country = COUNTRY_CONFIGS[bank.countryId];
    positions.push({
      id: `central-bank:${bank._id}`,
      label: `${country?.centralBank.chairTitle ?? "Central bank chair"} (${country?.centralBank.name ?? bank.countryId})`,
      category: "central-bank",
      kind: "central-bank",
      bank,
    });
  }

  const currentOffice = character.currentOffice;
  if (currentOffice) {
    const hasMatchingOfficial = officials.some((official) =>
      currentOfficeMatchesOfficial(currentOffice, official)
    );
    const hasMatchingCabinet = cabinetMembers.some((member) =>
      currentOfficeMatchesCabinet(currentOffice, member)
    );
    const hasMatchingPm =
      pmCountryIds.has(character.countryId) &&
      currentOfficeMatchesExecutive(currentOffice, character.countryId);
    const hasLegacyCentralBank = currentOffice.type === "centralBankChair" && banks.length > 0;

    if (!hasMatchingOfficial && !hasMatchingCabinet && !hasMatchingPm && !hasLegacyCentralBank) {
      positions.push({
        id: "current-office",
        label: getOfficeLabel(currentOffice, character.countryId),
        category: "office",
        kind: "current-office",
        office: currentOffice,
      });
    }
  }

  const categoryOrder: ResignablePositionCategory[] = [
    "office",
    "cabinet",
    "national-party",
    "state-party",
    "legislative-leadership",
    "central-bank",
  ];
  return positions.sort((a, b) => {
    const categoryDifference =
      categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
    return categoryDifference || a.label.localeCompare(b.label);
  });
}

export async function getResignablePositions(
  db: Db,
  character: Character
): Promise<ResignablePosition[]> {
  const positions = await discoverPositions(db, character);
  return positions.map(({ id, label, category }) => ({ id, label, category }));
}

async function resignOfficial(
  db: Db,
  character: Character,
  official: ElectedOfficial,
  now: Date,
  options?: { preserveSeatRecord?: boolean }
): Promise<boolean> {
  if (!official.characterId?.equals(character._id)) return false;

  if (official.officeType === "president" || official.officeType === "vicePresident") {
    await resignExecutiveOffice(db, official, character, now);
  } else {
    const officials = db.collection<ElectedOfficial>("electedOfficials");
    if (options?.preserveSeatRecord) {
      const result = await officials.updateOne(
        { _id: official._id, characterId: character._id },
        {
          $set: { characterId: null, updatedAt: now },
          $unset: { characterName: "", party: "", electedAt: "" },
        }
      );
      if (!hasChanged(result)) return false;
    } else {
      const result = await officials.deleteOne({ _id: official._id, characterId: character._id });
      if (result.deletedCount === 0) return false;
    }
    if (currentOfficeMatchesOfficial(character.currentOffice, official)) {
      await clearCurrentOfficeForOffice(db, character._id, character.currentOffice, now);
    }
  }

  if (official.officeType === "senate" && official.state) {
    await notifyGovernorOfSenateVacancy(db, official.state, official.senateClass);
  }
  return true;
}

async function resignPrimeMinister(
  db: Db,
  character: Character,
  countryId: CountryId,
  now: Date
): Promise<boolean> {
  const canonicalGovernment = await getGovernmentFormationsCollection(db).findOne({
    _id: countryId,
    pmCharacterId: character._id,
  });
  const legacyGovernment = await db
    .collection<ParliamentaryGovernment>("parliamentaryGovernments")
    .findOne({ _id: countryId, pmCharacterId: character._id });
  if (!canonicalGovernment && !legacyGovernment) {
    if (currentOfficeMatchesExecutive(character.currentOffice, countryId)) {
      await clearCurrentOfficeForOffice(db, character._id, character.currentOffice, now);
      return true;
    }
    return false;
  }

  if (canonicalGovernment) {
    await unformGovernmentAndVacatePM(db, countryId, now, { reason: "snap" });
  }
  if (legacyGovernment) {
    await db.collection<ParliamentaryGovernment>("parliamentaryGovernments").updateOne(
      { _id: countryId, pmCharacterId: character._id },
      {
        $set: {
          pmCharacterId: null,
          status: "pending",
          dissolutionReason: "resignation",
          updatedAt: now,
        },
        $unset: { pmName: "" },
      }
    );
  }
  if (!canonicalGovernment) {
    await clearCurrentOfficeForOffice(db, character._id, character.currentOffice, now);
  }
  return true;
}

async function resignCabinet(
  db: Db,
  character: Character,
  member: CabinetMember,
  now: Date
): Promise<boolean> {
  if (!member.characterId.equals(character._id)) return false;
  const result = await db
    .collection<CabinetMember>("cabinetMembers")
    .deleteOne({ _id: member._id, characterId: character._id });
  if (result.deletedCount === 0) return false;
  if (currentOfficeMatchesCabinet(character.currentOffice, member)) {
    await clearCurrentOfficeForOffice(db, character._id, character.currentOffice, now);
  }
  return true;
}

async function resignNationalPartyRole(
  db: Db,
  character: Character,
  party: PoliticalParty,
  field: PartyLeadershipField,
  now: Date
): Promise<boolean> {
  const result = await db
    .collection<PoliticalParty>("politicalParties")
    .updateOne(
      { _id: party._id, [field]: character._id },
      { $set: { [field]: null, updatedAt: now } }
    );
  if (!hasChanged(result)) return false;
  if (field === "chairId") {
    await db
      .collection("coalitions")
      .updateMany(
        { chairPartyId: party._id },
        { $set: { chairCharacterId: null, updatedAt: now } }
      );
  }
  return true;
}

async function resignStatePartyRole(
  db: Db,
  character: Character,
  organization: StatePartyOrg,
  field: PartyLeadershipField,
  now: Date
): Promise<boolean> {
  const result = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .updateOne(
      { _id: organization._id, [field]: character._id },
      { $set: { [field]: null, updatedAt: now } }
    );
  return hasChanged(result);
}

async function resignCongressLeadership(
  db: Db,
  character: Character,
  leader: CongressLeader,
  now: Date
): Promise<boolean> {
  const result = await db.collection<CongressLeader>("congressLeaders").updateOne(
    { _id: leader._id, characterId: character._id },
    {
      $set: { characterId: null, characterName: "Vacant", updatedAt: now },
      $unset: { party: "", nominatedBy: "", electedAt: "" },
    }
  );
  return hasChanged(result);
}

async function resignCentralBankChair(
  db: Db,
  character: Character,
  bank: CentralBank,
  now: Date
): Promise<boolean> {
  if (!bank.chairCharacterId?.equals(character._id)) return false;
  await vacateCentralBankChairCharacter(db, character._id);
  await vacateFomcChairSeat(db, bank._id);
  const result = await db.collection<CentralBank>("centralBanks").updateOne(
    { _id: bank._id, chairCharacterId: character._id },
    {
      $set: {
        chairCharacterId: null,
        chairCharacterName: null,
        chairAppointedAt: null,
        chairAppointedBy: null,
        chairTermExpiresAtTurn: null,
        vacancyAwaitingAutomaticSelection: true,
        updatedAt: now,
      },
    }
  );
  return hasChanged(result);
}

async function applyPosition(
  db: Db,
  character: Character,
  position: PositionRecord,
  now: Date,
  options?: { preserveOfficialRecords?: boolean }
): Promise<boolean> {
  switch (position.kind) {
    case "official":
      return resignOfficial(db, character, position.official, now, {
        preserveSeatRecord: options?.preserveOfficialRecords,
      });
    case "prime-minister":
      return resignPrimeMinister(db, character, position.countryId, now);
    case "cabinet":
      return resignCabinet(db, character, position.member, now);
    case "national-party":
      return resignNationalPartyRole(db, character, position.party, position.field, now);
    case "state-party":
      return resignStatePartyRole(db, character, position.organization, position.field, now);
    case "congress":
      return resignCongressLeadership(db, character, position.leader, now);
    case "central-bank":
      return resignCentralBankChair(db, character, position.bank, now);
    case "current-office":
      await clearCurrentOfficeForOffice(db, character._id, position.office, now);
      return true;
  }
}

export async function resignPosition(
  db: Db,
  character: Character,
  positionId: string
): Promise<ResignPositionResult> {
  const freshCharacter =
    (await db.collection<Character>("characters").findOne({ _id: character._id })) ?? character;
  const position = (await discoverPositions(db, freshCharacter)).find(
    (candidate) => candidate.id === positionId
  );
  if (!position) {
    return { ok: false, status: 404, error: "That position is no longer held." };
  }

  if (
    position.kind === "official" &&
    position.official.officeType !== "president" &&
    position.official.officeType !== "vicePresident"
  ) {
    const activeElection = await db.collection<ElectionCandidate>("electionCandidates").findOne({
      characterId: freshCharacter._id,
      electionId: { $exists: true },
      status: "active",
    });
    if (activeElection) {
      return {
        ok: false,
        status: 400,
        error: "Cannot resign while actively running in an election.",
      };
    }
  }

  const resigned = await applyPosition(db, freshCharacter, position, new Date());
  if (!resigned) {
    return { ok: false, status: 409, error: "That position changed. Refresh and try again." };
  }
  return { ok: true, label: position.label };
}

async function withdrawActiveCandidacies(db: Db, characterId: ObjectId, now: Date) {
  const [elections, stateParty] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .updateMany(
        { characterId, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      ),
    db
      .collection("statePartyCandidates")
      .updateMany(
        { characterId, status: "active" },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      ),
  ]);
  return { elections, stateParty };
}

export async function resignAllPositions(db: Db, character: Character): Promise<ResignAllResult> {
  const freshCharacter =
    (await db.collection<Character>("characters").findOne({ _id: character._id })) ?? character;
  const positions = await discoverPositions(db, freshCharacter);
  const now = new Date();
  const resigned: string[] = [];

  const orderedPositions = [...positions].sort((a, b) => {
    const priority = (position: PositionRecord) =>
      position.kind === "cabinet" ? 0 : position.kind === "prime-minister" ? 1 : 2;
    return priority(a) - priority(b);
  });
  for (const position of orderedPositions) {
    if (await applyPosition(db, freshCharacter, position, now, { preserveOfficialRecords: true })) {
      resigned.push(position.label);
    }
  }

  const [officialResult, partyResults, statePartyResult, congressResult, cabinetResult, bankRows] =
    await Promise.all([
      db.collection<ElectedOfficial>("electedOfficials").updateMany(
        { characterId: freshCharacter._id },
        {
          $set: { characterId: null, updatedAt: now },
          $unset: { characterName: "", party: "", electedAt: "" },
        }
      ),
      Promise.all(
        PARTY_LEADERSHIP_FIELDS.map((field) =>
          db
            .collection<PoliticalParty>("politicalParties")
            .updateMany(
              { [field]: freshCharacter._id },
              { $set: { [field]: null, updatedAt: now } }
            )
        )
      ),
      db.collection<StatePartyOrg>("statePartyOrg").updateMany(
        {
          $or: PARTY_LEADERSHIP_FIELDS.map((field) => ({ [field]: freshCharacter._id })),
        },
        {
          $set: {
            chairId: null,
            viceChairId: null,
            treasurerId: null,
            updatedAt: now,
          },
        }
      ),
      db.collection<CongressLeader>("congressLeaders").updateMany(
        { characterId: freshCharacter._id },
        {
          $set: { characterId: null, characterName: "Vacant", updatedAt: now },
          $unset: { party: "", nominatedBy: "", electedAt: "" },
        }
      ),
      db
        .collection<CabinetMember>("cabinetMembers")
        .deleteMany({ characterId: freshCharacter._id }),
      db
        .collection<CentralBank>("centralBanks")
        .find({ chairCharacterId: freshCharacter._id })
        .toArray(),
    ]);

  if (officialResult.modifiedCount > 0)
    resigned.push(`Elected office records: ${officialResult.modifiedCount}`);
  if (partyResults.some((result) => result.modifiedCount > 0))
    resigned.push("National party leadership");
  if (statePartyResult.modifiedCount > 0) resigned.push("State party leadership");
  if (congressResult.modifiedCount > 0) resigned.push("Legislative leadership");
  if (cabinetResult.deletedCount > 0) resigned.push("Cabinet position");

  for (const bank of bankRows) {
    await resignCentralBankChair(db, freshCharacter, bank, now);
  }
  if (bankRows.length > 0) resigned.push("Central bank chair");

  const candidacies = await withdrawActiveCandidacies(db, freshCharacter._id, now);
  if (candidacies.elections.modifiedCount > 0) {
    resigned.push(`Election candidacies withdrawn: ${candidacies.elections.modifiedCount}`);
  }
  if (candidacies.stateParty.modifiedCount > 0) {
    resigned.push(`State party candidacies withdrawn: ${candidacies.stateParty.modifiedCount}`);
  }

  await db
    .collection<Character>("characters")
    .updateOne({ _id: freshCharacter._id }, { $set: { currentOffice: null, updatedAt: now } });

  if (resigned.length === 0) {
    return {
      message: "You don't hold any positions to resign from.",
      resigned: [],
    };
  }

  console.log(`[Settings] ${freshCharacter.name} resigned all positions:`, resigned);
  return {
    message: `Successfully resigned from ${resigned.length} position(s).`,
    resigned,
  };
}
