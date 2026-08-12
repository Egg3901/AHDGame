import { ObjectId, type Db } from "mongodb";
import type {
  Bill,
  BillWhip,
  CabinetNomination,
  CaucusMembership,
  Character,
  ElectedOfficial,
  HouseLeadershipNomination,
  NPP,
  SenateLeadershipNomination,
  SpeakerNomination,
  WhipAudience,
  WhipDirection,
  WhipIssuer,
  WhipIssuerRole,
  WhipTargetType,
} from "@/lib/db/types";
import {
  getNoConfidenceVotesCollection,
  getPMAppointmentVotesCollection,
} from "@/lib/db/collections/governmentFormation";
import type { CountryId } from "@/lib/constants/countries";
import { getOfficeTypeForChamber } from "@/lib/legislature/chamberOfficeType";

export interface WhipDefianceScope {
  countryId: CountryId;
  partyId: string;
  issuedBy: WhipIssuer;
  stateId?: string;
  caucusId?: ObjectId;
}

export interface WhipDefianceItem {
  whipId: string;
  audience: WhipAudience;
  mode: "soft" | "hard";
  issuerRole?: WhipIssuerRole;
  targetType: WhipTargetType;
  targetLabel: string;
  chamber: string;
  whipDirection: WhipDirection;
  currentVoteLabel: string;
  voterType: "character" | "npp";
  voterId: string;
  voterName: string;
  voterState: string | null;
  voterOffice: string | null;
  voterHref: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhipDefianceSnapshot {
  activeCount: number;
  playerCount: number;
  nppCount: number;
  players: WhipDefianceItem[];
  npps: WhipDefianceItem[];
}

interface VoterMeta {
  voterType: "character" | "npp";
  voterId: string;
  voterName: string;
  partyId: string | null;
  stateId: string | null;
  office: string | null;
  caucusIds: Set<string>;
}

interface TargetVoteRecord {
  voterKey: string;
  comparableVote: string | null;
  displayVote: string;
}

interface TargetContext {
  label: string;
  votes: TargetVoteRecord[];
}

function getModeLabel(whip: BillWhip): "soft" | "hard" {
  return whip.mode ?? "hard";
}

function buildVoterHref(voterType: "character" | "npp", voterId: string): string {
  return voterType === "character" ? `/character/${voterId}` : `/politicians/npp/${voterId}`;
}

function chamberToOffice(chamber: string): string {
  return chamber === "stateSenate" ? "State Legislature" : chamber;
}

function toComparableGovernmentVote(value: string | undefined): string | null {
  if (value === "aye") return "for";
  if (value === "nay") return "against";
  return null;
}

function toDisplayGovernmentVote(value: string | undefined): string {
  if (value === "aye") return "AYE";
  if (value === "nay") return "NAY";
  return "Unknown";
}

function toComparableStandardVote(value: string | undefined): string | null {
  if (value === "for" || value === "against" || value === "abstain") return value;
  return null;
}

function toDisplayStandardVote(value: string | undefined): string {
  if (value === "for") return "FOR";
  if (value === "against") return "AGAINST";
  if (value === "abstain") return "ABSTAIN";
  return "Unknown";
}

function parseVoterKeys(
  votes: Record<string, string> | undefined,
  audience: WhipAudience
): string[] {
  const entries = Object.keys(votes ?? {});
  return audience === "character"
    ? entries.filter((key) => !key.startsWith("npp_"))
    : entries.filter((key) => key.startsWith("npp_")).map((key) => key.slice(4));
}

async function loadCharacterMeta(
  db: Db,
  ids: string[],
  officeType: string,
  caucusId?: ObjectId
): Promise<Map<string, VoterMeta>> {
  if (ids.length === 0) return new Map();
  const objectIds = ids.map((id) => new ObjectId(id));
  const [characters, officials, memberships] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({ _id: { $in: objectIds } })
      .project<Pick<Character, "_id" | "name" | "party">>({ _id: 1, name: 1, party: 1 })
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ characterId: { $in: objectIds }, officeType })
      .project<Pick<ElectedOfficial, "characterId" | "state" | "officeType">>({
        characterId: 1,
        state: 1,
        officeType: 1,
      })
      .toArray(),
    caucusId
      ? db
          .collection<CaucusMembership>("caucusMemberships")
          .find({
            caucusId,
            memberType: "character",
            memberId: { $in: objectIds },
            status: "active",
          })
          .toArray()
      : Promise.resolve([] as CaucusMembership[]),
  ]);

  const officialByCharacterId = new Map(
    officials
      .filter((official) => official.characterId)
      .map((official) => [official.characterId!.toString(), official])
  );
  const caucusIdsByCharacter = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const key = membership.memberId.toString();
    if (!caucusIdsByCharacter.has(key)) caucusIdsByCharacter.set(key, new Set());
    caucusIdsByCharacter.get(key)!.add(membership.caucusId.toString());
  }

  return new Map(
    characters.map((character) => {
      const official = officialByCharacterId.get(character._id.toString());
      return [
        character._id.toString(),
        {
          voterType: "character" as const,
          voterId: character._id.toString(),
          voterName: character.name,
          partyId: character.party ?? null,
          stateId: official?.state ?? null,
          office: official?.officeType ?? null,
          caucusIds: caucusIdsByCharacter.get(character._id.toString()) ?? new Set(),
        } satisfies VoterMeta,
      ];
    })
  );
}

async function loadNppMeta(
  db: Db,
  ids: string[],
  officeType: string,
  caucusId?: ObjectId
): Promise<Map<string, VoterMeta>> {
  if (ids.length === 0) return new Map();
  const objectIds = ids.map((id) => new ObjectId(id));
  const [npps, officials, memberships] = await Promise.all([
    db
      .collection<NPP>("npps")
      .find({ _id: { $in: objectIds } })
      .project<Pick<NPP, "_id" | "name" | "party">>({ _id: 1, name: 1, party: 1 })
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ nppId: { $in: objectIds }, officeType })
      .project<Pick<ElectedOfficial, "nppId" | "state" | "officeType">>({
        nppId: 1,
        state: 1,
        officeType: 1,
      })
      .toArray(),
    caucusId
      ? db
          .collection<CaucusMembership>("caucusMemberships")
          .find({
            caucusId,
            memberType: "npp",
            memberId: { $in: objectIds },
            status: "active",
          })
          .toArray()
      : Promise.resolve([] as CaucusMembership[]),
  ]);

  const officialByNppId = new Map(
    officials
      .filter((official) => official.nppId)
      .map((official) => [official.nppId!.toString(), official])
  );
  const caucusIdsByNpp = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const key = membership.memberId.toString();
    if (!caucusIdsByNpp.has(key)) caucusIdsByNpp.set(key, new Set());
    caucusIdsByNpp.get(key)!.add(membership.caucusId.toString());
  }

  return new Map(
    npps.map((npp) => {
      const official = officialByNppId.get(npp._id.toString());
      return [
        npp._id.toString(),
        {
          voterType: "npp" as const,
          voterId: npp._id.toString(),
          voterName: npp.name,
          partyId: npp.party ?? null,
          stateId: official?.state ?? null,
          office: official?.officeType ?? null,
          caucusIds: caucusIdsByNpp.get(npp._id.toString()) ?? new Set(),
        } satisfies VoterMeta,
      ];
    })
  );
}

function voterMatchesScope(voter: VoterMeta, scope: WhipDefianceScope): boolean {
  if (voter.partyId !== scope.partyId) return false;
  if (scope.issuedBy === "stateParty" && voter.stateId !== scope.stateId) return false;
  if (scope.issuedBy === "caucus" && !voter.caucusIds.has(scope.caucusId!.toString())) return false;
  return true;
}

function voteMatchesWhip(whip: BillWhip, comparableVote: string | null): boolean {
  if (!comparableVote) return true;
  if (whip.targetType === "speakerElection" || whip.targetType === "leadershipElection") {
    return comparableVote === whip.candidacyId?.toString();
  }
  return comparableVote === whip.direction;
}

async function loadBillTarget(db: Db, whip: BillWhip): Promise<TargetContext | null> {
  if (!(whip.targetId instanceof ObjectId)) return null;
  const bill = await db.collection<Bill>("bills").findOne({ _id: whip.targetId });
  if (
    !bill ||
    ![
      "active",
      "active_other",
      "active_both",
      "veto_override",
      "override_shugiin",
      "cabinet_review",
    ].includes(bill.status)
  ) {
    return null;
  }
  // override_shugiin (JP Shūgiin override) reuses the main `votes` field, so
  // falls through to the default branch below with the active/cabinet bills.
  //
  // A concurrent bill has TWO live maps and defiance is measured per voter, so both are
  // merged here — a senator's defiance lives in `otherChamberVotes` and would be
  // invisible if only the lower map were read. The keys are character/NPP ids and a
  // member sits in exactly one chamber, so the merge cannot collide.
  const voteMap =
    bill.status === "active_both"
      ? { ...(bill.votes ?? {}), ...(bill.otherChamberVotes ?? {}) }
      : bill.status === "active_other"
        ? bill.otherChamberVotes
        : bill.status === "veto_override"
          ? bill.vetoOverrideVotes
          : bill.votes;
  return {
    label: bill.title,
    votes: Object.entries(voteMap ?? {}).map(([voterKey, vote]) => ({
      voterKey,
      comparableVote: toComparableStandardVote(vote),
      displayVote: toDisplayStandardVote(vote),
    })),
  };
}

async function loadGovernmentTarget(db: Db, whip: BillWhip): Promise<TargetContext | null> {
  if (!(whip.targetId instanceof ObjectId)) return null;
  const collection =
    whip.targetType === "pmAppointmentVote"
      ? getPMAppointmentVotesCollection(db)
      : getNoConfidenceVotesCollection(db);
  const voteDoc = await collection.findOne({ _id: whip.targetId, status: "active" });
  if (!voteDoc) return null;
  return {
    label:
      whip.targetType === "pmAppointmentVote"
        ? "Prime Minister Appointment"
        : "No-Confidence Motion",
    votes: Object.entries(voteDoc.votes ?? {}).map(([voterKey, vote]) => ({
      voterKey,
      comparableVote: toComparableGovernmentVote(vote),
      displayVote: toDisplayGovernmentVote(vote),
    })),
  };
}

async function loadCabinetTarget(db: Db, whip: BillWhip): Promise<TargetContext | null> {
  if (!(whip.targetId instanceof ObjectId)) return null;
  const nomination = await db
    .collection<CabinetNomination>("cabinetNominations")
    .findOne({ _id: whip.targetId, status: "active" });
  if (!nomination) return null;
  return {
    label: nomination.nomineeCharacterName
      ? `Cabinet: ${nomination.nomineeCharacterName}`
      : "Cabinet Nomination",
    votes: Object.entries(nomination.votes ?? {}).map(([voterKey, vote]) => ({
      voterKey,
      comparableVote: toComparableStandardVote(vote),
      displayVote: toDisplayStandardVote(vote),
    })),
  };
}

async function loadLeadershipTarget(db: Db, whip: BillWhip): Promise<TargetContext | null> {
  const collectionName =
    whip.targetType === "speakerElection"
      ? "speakerNominations"
      : whip.chamber === "senate" || whip.chamber === "stateSenate"
        ? "senateLeadershipNominations"
        : "houseLeadershipNominations";
  const activeStatuses = ["open", "voting"] as const;
  const activeFilter =
    whip.targetType === "speakerElection"
      ? { status: { $in: activeStatuses } }
      : typeof whip.targetId === "string"
        ? { status: { $in: activeStatuses }, role: whip.targetId }
        : { status: { $in: activeStatuses } };

  const nominations = await db
    .collection<SpeakerNomination | HouseLeadershipNomination | SenateLeadershipNomination>(
      collectionName
    )
    .find(activeFilter)
    .toArray();
  if (nominations.length === 0) return null;

  const votesByVoter = new Map<string, string>();
  for (const nomination of nominations) {
    for (const voterKey of Object.keys(nomination.votes ?? {})) {
      votesByVoter.set(voterKey, nomination._id.toString());
    }
  }

  return {
    label:
      whip.targetType === "speakerElection"
        ? "Speaker Election"
        : whip.chamber === "senate" || whip.chamber === "stateSenate"
          ? "Senate Leadership"
          : "House Leadership",
    votes: Array.from(votesByVoter.entries()).map(([voterKey, nominationId]) => ({
      voterKey,
      comparableVote: nominationId,
      displayVote:
        nominations.find((nomination) => nomination._id.toString() === nominationId)?.nomineeName ??
        "Other candidate",
    })),
  };
}

async function loadTargetContext(db: Db, whip: BillWhip): Promise<TargetContext | null> {
  switch (whip.targetType) {
    case "bill":
      return loadBillTarget(db, whip);
    case "speakerElection":
    case "leadershipElection":
      return loadLeadershipTarget(db, whip);
    case "pmAppointmentVote":
    case "noConfidenceVote":
      return loadGovernmentTarget(db, whip);
    case "cabinetNomination":
      return loadCabinetTarget(db, whip);
    default:
      return null;
  }
}

function compareByUpdated(a: WhipDefianceItem, b: WhipDefianceItem): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

export async function buildWhipDefianceSnapshot(
  db: Db,
  scope: WhipDefianceScope,
  limit: number = 25
): Promise<WhipDefianceSnapshot> {
  const rawWhips = await db
    .collection<BillWhip>("billWhips")
    .find({
      issuedBy: scope.issuedBy,
      countryId: scope.countryId,
      partyId: scope.partyId,
      ...(scope.stateId ? { stateId: scope.stateId } : {}),
      ...(scope.caucusId ? { caucusId: scope.caucusId } : {}),
    })
    .sort({ createdAt: -1 })
    .toArray();
  const whips: BillWhip[] = [];
  const seen = new Set<string>();
  for (const whip of rawWhips) {
    const key = [
      whip.audience,
      whip.targetType,
      whip.targetId instanceof ObjectId ? whip.targetId.toString() : whip.targetId,
      whip.chamber,
      whip.candidacyId?.toString() ?? "",
      whip.audience === "character" ? getModeLabel(whip) : "npp",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    whips.push(whip);
  }

  const players: WhipDefianceItem[] = [];
  const npps: WhipDefianceItem[] = [];

  for (const whip of whips) {
    const target = await loadTargetContext(db, whip);
    if (!target) continue;

    const voterIds = parseVoterKeys(
      Object.fromEntries(target.votes.map((vote) => [vote.voterKey, vote.displayVote])),
      whip.audience
    );
    // Resolve the whip's chamber key to the office type seated members are
    // stored under (CN: "npc" → "npcDelegate"); otherwise CN voters' office/state
    // metadata is dropped from the defiance snapshot.
    const voterOfficeType = getOfficeTypeForChamber(scope.countryId, whip.chamber);
    const voterMap =
      whip.audience === "character"
        ? await loadCharacterMeta(db, voterIds, voterOfficeType, scope.caucusId)
        : await loadNppMeta(db, voterIds, voterOfficeType, scope.caucusId);

    for (const voteRecord of target.votes) {
      const voterId =
        whip.audience === "character"
          ? voteRecord.voterKey
          : voteRecord.voterKey.startsWith("npp_")
            ? voteRecord.voterKey.slice(4)
            : voteRecord.voterKey;
      const voter = voterMap.get(voterId);
      if (!voter || !voterMatchesScope(voter, scope)) continue;
      if (voteMatchesWhip(whip, voteRecord.comparableVote)) continue;

      const item: WhipDefianceItem = {
        whipId: whip._id.toString(),
        audience: whip.audience,
        mode: getModeLabel(whip),
        issuerRole: whip.issuedByRole,
        targetType: whip.targetType,
        targetLabel: target.label,
        chamber: chamberToOffice(whip.chamber),
        whipDirection: whip.direction,
        currentVoteLabel: voteRecord.displayVote,
        voterType: voter.voterType,
        voterId: voter.voterId,
        voterName: voter.voterName,
        voterState: voter.stateId,
        voterOffice: voter.office,
        voterHref: buildVoterHref(voter.voterType, voter.voterId),
        createdAt: whip.createdAt.toISOString(),
        updatedAt: whip.updatedAt.toISOString(),
      };
      if (voter.voterType === "character") {
        players.push(item);
      } else {
        npps.push(item);
      }
    }
  }

  players.sort(compareByUpdated);
  npps.sort(compareByUpdated);

  return {
    activeCount: players.length + npps.length,
    playerCount: players.length,
    nppCount: npps.length,
    players: players.slice(0, limit),
    npps: npps.slice(0, limit),
  };
}
