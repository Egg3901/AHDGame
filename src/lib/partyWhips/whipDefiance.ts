import { ObjectId, type Db, type Filter } from "mongodb";
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
  SpeakerVacateMotion,
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
import { impeachmentStageChamberKey } from "@/lib/impeachment/impeachmentTally";
import type { Impeachment } from "@/lib/db/types/impeachment";
import { isBillWhipInCurrentPhase } from "@/lib/congress/billWhipPhase";

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

async function loadBillTarget(
  whip: BillWhip,
  billsById: ReadonlyMap<string, Bill>
): Promise<TargetContext | null> {
  if (!(whip.targetId instanceof ObjectId)) return null;
  const bill = billsById.get(whip.targetId.toString());
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
  if (!isBillWhipInCurrentPhase(bill, whip)) return null;
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

function loadCabinetTarget(
  whip: BillWhip,
  nominationsById: ReadonlyMap<string, CabinetNomination>
): TargetContext | null {
  if (!(whip.targetId instanceof ObjectId)) return null;
  const nomination = nominationsById.get(whip.targetId.toString());
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

async function loadVacateTarget(db: Db, whip: BillWhip): Promise<TargetContext | null> {
  const motion = await db
    .collection<SpeakerVacateMotion>("speakerVacateMotions")
    .findOne({ _id: "current", status: "voting" });
  // Only whips issued during THIS motion describe the ballots on it; the
  // singleton "current" id is reused, so an older whip must not be scored
  // against a fresh motion's votes.
  if (!motion || whip.createdAt < motion.startedAt) return null;
  return {
    label: motion.targetSpeakerName
      ? `Motion to Vacate: ${motion.targetSpeakerName}`
      : "Motion to Vacate the Chair",
    votes: Object.entries(motion.votes ?? {}).map(([voterKey, vote]) => ({
      voterKey,
      comparableVote: toComparableStandardVote(vote),
      // "FOR"/"AGAINST" reads as ambiguous on a motion to vacate, so name the
      // outcome each ballot produces instead.
      displayVote: vote === "for" ? "VACATE" : vote === "against" ? "KEEP" : "Unknown",
    })),
  };
}

async function loadImpeachmentTarget(db: Db, whip: BillWhip): Promise<TargetContext | null> {
  if (!(whip.targetId instanceof ObjectId)) return null;
  const impeachment = await db
    .collection<Impeachment>("impeachments")
    .findOne({ _id: whip.targetId, stage: { $in: ["house", "senate"] } });
  if (!impeachment) return null;

  // Read the map for the stage the whip was issued against. A whip from the
  // House stage must not be scored against Senate ballots: the two chambers
  // hold different members and the case keeps both maps.
  const stageChamber = impeachmentStageChamberKey(impeachment);
  if (stageChamber !== whip.chamber) return null;

  const votes = impeachment.stage === "house" ? impeachment.houseVotes : impeachment.senateVotes;
  return {
    label:
      impeachment.stage === "house"
        ? `Impeachment: ${impeachment.targetName}`
        : `Impeachment Trial: ${impeachment.targetName}`,
    votes: Object.entries(votes ?? {}).map(([voterKey, vote]) => ({
      voterKey,
      // Impeachment ballots are aye/nay/abstain; the first two map onto the
      // whip's for/against, and an abstention is never a whipped direction so
      // it always reads as defiance.
      comparableVote: vote === "abstain" ? "abstain" : toComparableGovernmentVote(vote),
      displayVote:
        vote === "aye"
          ? "REMOVE"
          : vote === "nay"
            ? "ACQUIT"
            : vote === "abstain"
              ? "ABSTAIN"
              : "Unknown",
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

async function loadTargetContext(
  db: Db,
  whip: BillWhip,
  billsById: ReadonlyMap<string, Bill>,
  cabinetNominationsById: ReadonlyMap<string, CabinetNomination>
): Promise<TargetContext | null> {
  switch (whip.targetType) {
    case "bill":
      return loadBillTarget(whip, billsById);
    case "speakerElection":
    case "leadershipElection":
      return loadLeadershipTarget(db, whip);
    case "pmAppointmentVote":
    case "noConfidenceVote":
      return loadGovernmentTarget(db, whip);
    case "cabinetNomination":
      return loadCabinetTarget(whip, cabinetNominationsById);
    case "speakerVacateMotion":
      return loadVacateTarget(db, whip);
    case "impeachmentVote":
      return loadImpeachmentTarget(db, whip);
    default:
      return null;
  }
}

function compareByUpdated(a: WhipDefianceItem, b: WhipDefianceItem): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function dedupeWhips(rawWhips: readonly BillWhip[]): BillWhip[] {
  const seen = new Set<string>();
  return rawWhips.filter((whip) => {
    const key = [
      whip.audience,
      whip.targetType,
      whip.targetId instanceof ObjectId ? whip.targetId.toString() : whip.targetId,
      whip.chamber,
      whip.candidacyId?.toString() ?? "",
      whip.audience === "character" ? getModeLabel(whip) : "npp",
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function targetCacheKey(whip: BillWhip): string {
  return [
    whip.targetType,
    whip.targetId instanceof ObjectId ? whip.targetId.toString() : whip.targetId,
    whip.chamber,
    whip.targetType === "speakerVacateMotion" || whip.targetType === "bill"
      ? whip.createdAt.toISOString()
      : "",
  ].join(":");
}

type CaucusWhipDefianceScope = WhipDefianceScope & {
  issuedBy: "caucus";
  caucusId: ObjectId;
};

/** Shared batch engine for single and multiple whip-defiance scopes. */
async function buildWhipDefianceSnapshotsForScopes(
  db: Db,
  scopes: readonly WhipDefianceScope[],
  limit: number,
  rawWhips: readonly BillWhip[],
  preloadedMemberships?: readonly CaucusMembership[],
  preloadedMembers?: { characters?: readonly Character[]; npps?: readonly NPP[] }
): Promise<Map<number, WhipDefianceSnapshot>> {
  if (scopes.length === 0) return new Map();
  const whipsByScope = new Map(
    scopes.map((scope, scopeIndex) => [
      scopeIndex,
      dedupeWhips(
        rawWhips.filter(
          (whip) =>
            whip.issuedBy === scope.issuedBy &&
            whip.countryId === scope.countryId &&
            whip.partyId === scope.partyId &&
            (!scope.stateId || whip.stateId === scope.stateId) &&
            (!scope.caucusId || whip.caucusId?.toString() === scope.caucusId.toString())
        )
      ),
    ])
  );
  // Preserve each scope's independently deduplicated rows. Across caucuses a
  // bill whip's creation time can distinguish the current veto phase from an
  // earlier one, even when target, chamber, audience, and mode all match.
  const allWhips = [...whipsByScope.values()].flat();
  const billIds = [
    ...new Map(
      allWhips
        .filter((whip) => whip.targetType === "bill" && whip.targetId instanceof ObjectId)
        .map((whip) => [whip.targetId.toString(), whip.targetId as ObjectId])
    ).values(),
  ];
  const cabinetIds = [
    ...new Map(
      allWhips
        .filter(
          (whip) => whip.targetType === "cabinetNomination" && whip.targetId instanceof ObjectId
        )
        .map((whip) => [whip.targetId.toString(), whip.targetId as ObjectId])
    ).values(),
  ];
  const [bills, nominations] = await Promise.all([
    billIds.length
      ? db
          .collection<Bill>("bills")
          .find({ _id: { $in: billIds } })
          .toArray()
      : Promise.resolve([] as Bill[]),
    cabinetIds.length
      ? db
          .collection<CabinetNomination>("cabinetNominations")
          .find({ _id: { $in: cabinetIds }, status: "active" })
          .toArray()
      : Promise.resolve([] as CabinetNomination[]),
  ]);
  const billsById = new Map(bills.map((bill) => [bill._id.toString(), bill]));
  const nominationsById = new Map(
    nominations.map((nomination) => [nomination._id.toString(), nomination])
  );

  const targetPromises = new Map<string, Promise<TargetContext | null>>();
  for (const whip of allWhips) {
    const key = targetCacheKey(whip);
    if (!targetPromises.has(key)) {
      targetPromises.set(
        key,
        whip.targetType === "bill"
          ? loadBillTarget(whip, billsById)
          : whip.targetType === "cabinetNomination"
            ? Promise.resolve(loadCabinetTarget(whip, nominationsById))
            : loadTargetContext(db, whip, billsById, nominationsById)
      );
    }
  }
  const targetByKey = new Map<string, TargetContext | null>();
  await Promise.all(
    [...targetPromises].map(async ([key, promise]) => targetByKey.set(key, await promise))
  );

  const officesByAudience = new Map<WhipAudience, Set<string>>();
  const voterIdsByAudience = new Map<WhipAudience, Set<string>>();
  for (const whip of allWhips) {
    const target = targetByKey.get(targetCacheKey(whip));
    if (!target) continue;
    const office = getOfficeTypeForChamber(whip.countryId as CountryId, whip.chamber);
    (
      officesByAudience.get(whip.audience) ??
      officesByAudience.set(whip.audience, new Set()).get(whip.audience)!
    ).add(office);
    const ids = voterIdsByAudience.get(whip.audience) ?? new Set<string>();
    for (const id of parseVoterKeys(
      Object.fromEntries(target.votes.map((vote) => [vote.voterKey, vote.displayVote])),
      whip.audience
    )) {
      ids.add(id);
    }
    voterIdsByAudience.set(whip.audience, ids);
  }
  const caucusIds = scopes.flatMap((scope) => (scope.caucusId ? [scope.caucusId] : []));
  const characterIds = [...(voterIdsByAudience.get("character") ?? [])].map(
    (id) => new ObjectId(id)
  );
  const nppIds = [...(voterIdsByAudience.get("npp") ?? [])].map((id) => new ObjectId(id));
  const knownCharacterIds = new Set(
    (preloadedMembers?.characters ?? []).map((character) => character._id.toString())
  );
  const knownNppIds = new Set((preloadedMembers?.npps ?? []).map((npp) => npp._id.toString()));
  const missingCharacterIds = characterIds.filter((id) => !knownCharacterIds.has(id.toString()));
  const missingNppIds = nppIds.filter((id) => !knownNppIds.has(id.toString()));
  const officeTypes = [...new Set([...officesByAudience.values()].flatMap((set) => [...set]))];
  const officialClauses = [
    ...(characterIds.length ? [{ characterId: { $in: characterIds } }] : []),
    ...(nppIds.length ? [{ nppId: { $in: nppIds } }] : []),
  ];
  const membershipClauses: Filter<CaucusMembership>[] = [
    ...(characterIds.length ? [{ memberType: "character", memberId: { $in: characterIds } }] : []),
    ...(nppIds.length ? [{ memberType: "npp", memberId: { $in: nppIds } }] : []),
  ];
  type VoterOfficial = Pick<
    ElectedOfficial,
    "characterId" | "nppId" | "isNPP" | "state" | "officeType"
  >;
  const [characters, npps, officials] = await Promise.all([
    missingCharacterIds.length
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: missingCharacterIds } })
          .project<Pick<Character, "_id" | "name" | "party">>({ _id: 1, name: 1, party: 1 })
          .toArray()
      : Promise.resolve([] as Character[]),
    missingNppIds.length
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: missingNppIds } })
          .project<Pick<NPP, "_id" | "name" | "party">>({ _id: 1, name: 1, party: 1 })
          .toArray()
      : Promise.resolve([] as NPP[]),
    officialClauses.length
      ? db
          .collection<ElectedOfficial>("electedOfficials")
          .find({ officeType: { $in: officeTypes }, $or: officialClauses })
          .project<VoterOfficial>({ characterId: 1, nppId: 1, isNPP: 1, state: 1, officeType: 1 })
          .toArray()
      : Promise.resolve([] as VoterOfficial[]),
  ]);
  const memberships = preloadedMemberships
    ? preloadedMemberships.filter(
        (membership) =>
          membership.status === "active" &&
          caucusIds.some((id) => id.toString() === membership.caucusId.toString())
      )
    : caucusIds.length && membershipClauses.length
      ? await db
          .collection<CaucusMembership>("caucusMemberships")
          .find({ caucusId: { $in: caucusIds }, status: "active", $or: membershipClauses })
          .toArray()
      : [];
  const caucusIdsByMember = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const key = `${membership.memberType}:${membership.memberId.toString()}`;
    const ids = caucusIdsByMember.get(key) ?? new Set<string>();
    ids.add(membership.caucusId.toString());
    caucusIdsByMember.set(key, ids);
  }
  const officialByMemberOffice = new Map<string, VoterOfficial>();
  for (const official of officials) {
    if (official.characterId) {
      officialByMemberOffice.set(
        `character:${official.officeType}:${official.characterId.toString()}`,
        official
      );
    }
    if (official.nppId) {
      officialByMemberOffice.set(
        `npp:${official.officeType}:${official.nppId.toString()}`,
        official
      );
    }
  }
  const voterMeta = new Map<string, VoterMeta>();
  for (const character of [...(preloadedMembers?.characters ?? []), ...characters]) {
    for (const office of officesByAudience.get("character") ?? []) {
      const official = officialByMemberOffice.get(
        `character:${office}:${character._id.toString()}`
      );
      voterMeta.set(`character:${office}:${character._id.toString()}`, {
        voterType: "character",
        voterId: character._id.toString(),
        voterName: character.name,
        partyId: character.party ?? null,
        stateId: official?.state ?? null,
        office: official?.officeType ?? null,
        caucusIds: caucusIdsByMember.get(`character:${character._id.toString()}`) ?? new Set(),
      });
    }
  }
  for (const npp of [...(preloadedMembers?.npps ?? []), ...npps]) {
    for (const office of officesByAudience.get("npp") ?? []) {
      const official = officialByMemberOffice.get(`npp:${office}:${npp._id.toString()}`);
      voterMeta.set(`npp:${office}:${npp._id.toString()}`, {
        voterType: "npp",
        voterId: npp._id.toString(),
        voterName: npp.name,
        partyId: npp.party ?? null,
        stateId: official?.state ?? null,
        office: official?.officeType ?? null,
        caucusIds: caucusIdsByMember.get(`npp:${npp._id.toString()}`) ?? new Set(),
      });
    }
  }

  return new Map(
    scopes.map((scope, scopeIndex) => {
      const players: WhipDefianceItem[] = [];
      const nppsForScope: WhipDefianceItem[] = [];
      for (const whip of whipsByScope.get(scopeIndex) ?? []) {
        const target = targetByKey.get(targetCacheKey(whip));
        if (!target) continue;
        const office = getOfficeTypeForChamber(scope.countryId, whip.chamber);
        for (const vote of target.votes) {
          const id =
            whip.audience === "character"
              ? vote.voterKey
              : vote.voterKey.startsWith("npp_")
                ? vote.voterKey.slice(4)
                : vote.voterKey;
          const voter = voterMeta.get(`${whip.audience}:${office}:${id}`);
          if (!voter || !voterMatchesScope(voter, scope)) continue;
          if (voteMatchesWhip(whip, vote.comparableVote)) continue;
          const item: WhipDefianceItem = {
            whipId: whip._id.toString(),
            audience: whip.audience,
            mode: getModeLabel(whip),
            issuerRole: whip.issuedByRole,
            targetType: whip.targetType,
            targetLabel: target.label,
            chamber: chamberToOffice(whip.chamber),
            whipDirection: whip.direction,
            currentVoteLabel: vote.displayVote,
            voterType: voter.voterType,
            voterId: voter.voterId,
            voterName: voter.voterName,
            voterState: voter.stateId,
            voterOffice: voter.office,
            voterHref: buildVoterHref(voter.voterType, voter.voterId),
            createdAt: whip.createdAt.toISOString(),
            updatedAt: whip.updatedAt.toISOString(),
          };
          if (voter.voterType === "character") players.push(item);
          else nppsForScope.push(item);
        }
      }
      players.sort(compareByUpdated);
      nppsForScope.sort(compareByUpdated);
      const snapshot = {
        activeCount: players.length + nppsForScope.length,
        playerCount: players.length,
        nppCount: nppsForScope.length,
        players: players.slice(0, limit),
        npps: nppsForScope.slice(0, limit),
      };
      return [scopeIndex, snapshot];
    })
  );
}

/** Build multiple caucus snapshots while sharing common target and voter reads. */
export async function buildWhipDefianceSnapshots(
  db: Db,
  scopes: readonly CaucusWhipDefianceScope[],
  limit: number,
  rawWhips: readonly BillWhip[],
  preloadedMemberships?: readonly CaucusMembership[],
  preloadedMembers?: { characters?: readonly Character[]; npps?: readonly NPP[] }
): Promise<Map<string, WhipDefianceSnapshot>> {
  const byIndex = await buildWhipDefianceSnapshotsForScopes(
    db,
    scopes,
    limit,
    rawWhips,
    preloadedMemberships,
    preloadedMembers
  );
  return new Map(scopes.map((scope, index) => [scope.caucusId.toString(), byIndex.get(index)!]));
}

export async function buildWhipDefianceSnapshot(
  db: Db,
  scope: WhipDefianceScope,
  limit: number = 25,
  preloadedWhips?: readonly BillWhip[]
): Promise<WhipDefianceSnapshot> {
  const rawWhips = preloadedWhips
    ? preloadedWhips.filter(
        (whip) =>
          whip.issuedBy === scope.issuedBy &&
          whip.countryId === scope.countryId &&
          whip.partyId === scope.partyId &&
          (!scope.stateId || whip.stateId === scope.stateId) &&
          (!scope.caucusId || whip.caucusId?.toString() === scope.caucusId.toString())
      )
    : await db
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
  return (await buildWhipDefianceSnapshotsForScopes(db, [scope], limit, rawWhips)).get(0)!;
}
