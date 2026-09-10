import { ObjectId, type Db } from "mongodb";
import type {
  Character,
  ElectedOfficial,
  Election,
  ElectionCandidate,
  PoliticalParty,
} from "@/lib/db/types";
import { electionStatusBlocksFurtherEntry } from "@/lib/elections/activeCandidacy";
import { DEFAULT_CANDIDATE_SUPPORT } from "@/lib/electionEngine/electionFormulaFactors";
import { officeKeyForElectionType } from "@/lib/utils/electionLabels";
import { activeUserIds } from "@/lib/players/playerActivity";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryState } from "@/lib/countryState";
import {
  canFieldExecutiveCandidate,
  canFieldLegislativeCandidate,
} from "@/lib/turn/onePartyConstraints";

const EXCLUDED_TYPES = new Set(["president", "vicePresident"]);

export function getElectionSeatKey(election: Election): string {
  return [
    election.countryId ?? "US",
    officeKeyForElectionType(election.electionType, election.countryId),
    election.state,
    election.electionType === "senate" ? (election.senateClass ?? "") : "",
    election.chamberClass ?? "",
  ].join("|");
}

function getOfficialSeatKey(official: ElectedOfficial, fallbackCountryId?: string): string {
  return [
    official.countryId ?? fallbackCountryId ?? "US",
    official.officeType,
    official.state ?? "",
    official.officeType === "senate" ? (official.senateClass ?? "") : "",
    official.chamberClass ?? "",
  ].join("|");
}

/**
 * Automatically enters characters with autoRunForReelection=true into the exact
 * seat they should run for next:
 * - incumbents defend the seat they currently hold
 * - otherwise, characters re-enter the most recent resolved seat they contested
 *
 * Skips presidential races and respects existing withdrawals - a character who
 * manually withdrew from an election will not be re-entered.
 */
export async function runAutoReelectionEntry(
  db: Db,
  now: Date,
  currentTurn: number
): Promise<void> {
  const optedInCharacters = await db
    .collection<Character>("characters")
    .find({ autoRunForReelection: true })
    .toArray();

  if (optedInCharacters.length === 0) return;

  // Inactive players (>96 turns) are not auto-run for reelection — they opted in
  // but have since gone dark. Resolve activity per user (see playerActivity).
  const candidateUserIds = optedInCharacters
    .map((character) => character.userId)
    .filter((id): id is NonNullable<typeof id> => id != null);
  const activeIds = await activeUserIds(db, candidateUserIds, now);
  const characters = optedInCharacters.filter(
    (character) => character.userId && activeIds.has(character.userId.toString())
  );

  if (characters.length === 0) return;

  const characterIds = characters.map((character) => character._id);
  const targetSeatByCharacterId = new Map<string, string>();
  const characterById = new Map(
    characters.map((character) => [character._id.toHexString(), character] as const)
  );

  const offices = await db
    .collection<ElectedOfficial>("electedOfficials")
    .find({ characterId: { $in: characterIds } })
    .toArray();
  for (const office of offices) {
    if (!office.characterId) continue;
    const characterKey = office.characterId.toHexString();
    const characterCountryId = characterById.get(characterKey)?.countryId;
    targetSeatByCharacterId.set(characterKey, getOfficialSeatKey(office, characterCountryId));
  }

  const priorCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ characterId: { $in: characterIds } })
    .toArray();
  const priorElectionIds = [
    ...new Set(priorCandidates.map((candidate) => candidate.electionId.toHexString())),
  ];
  const priorElections =
    priorElectionIds.length > 0
      ? await db
          .collection<Election>("elections")
          .find({
            _id: { $in: priorElectionIds.map((id) => new ObjectId(id)) },
            status: "resolved",
            electionType: { $nin: Array.from(EXCLUDED_TYPES) },
          })
          .toArray()
      : [];
  const priorElectionById = new Map(
    priorElections.map((election) => [election._id.toHexString(), election])
  );
  // #575/#574: everything the per-character checks used to query is derivable
  // from `priorCandidates`, which already holds every candidacy belonging to
  // these characters. Two lookups replace 3 awaited round trips per character.
  //
  // `existingEntry` answers "is this character already in this election?" — the
  // old per-character findOne on (electionId, characterId).
  const existingEntry = new Set(
    priorCandidates.map((c) => `${c.electionId.toHexString()}:${c.characterId.toHexString()}`)
  );

  // `blockingElectionsByCharacter` answers findBlockingActiveCandidacy: the
  // elections where this character holds an ACTIVE candidacy whose election
  // status still blocks further entry. Only the election statuses need
  // fetching, and only for elections an active candidacy actually references.
  const activeCandidacies = priorCandidates.filter((c) => c.status === "active");
  const blockingElectionsByCharacter = new Map<string, Set<string>>();
  if (activeCandidacies.length > 0) {
    const referencedIds = [...new Set(activeCandidacies.map((c) => c.electionId.toHexString()))];
    const statusRows = await db
      .collection<Election>("elections")
      .find(
        { _id: { $in: referencedIds.map((id) => new ObjectId(id)) } },
        { projection: { status: 1 } }
      )
      .toArray();
    const blocking = new Set(
      statusRows
        .filter((e) => electionStatusBlocksFurtherEntry(e.status))
        .map((e) => e._id.toHexString())
    );
    for (const c of activeCandidacies) {
      const electionKey = c.electionId.toHexString();
      if (!blocking.has(electionKey)) continue;
      const characterKey = c.characterId.toHexString();
      let set = blockingElectionsByCharacter.get(characterKey);
      if (!set) blockingElectionsByCharacter.set(characterKey, (set = new Set()));
      set.add(electionKey);
    }
  }

  const latestResolvedCandidateByCharacterId = new Map<
    string,
    { seatKey: string; resolvedAt: number }
  >();

  for (const candidate of priorCandidates) {
    const election = priorElectionById.get(candidate.electionId.toHexString());
    if (!election) continue;

    const characterKey = candidate.characterId.toHexString();
    const character = characterById.get(characterKey);
    if (!character) continue;
    if (targetSeatByCharacterId.has(characterKey)) continue;
    if ((election.countryId ?? "US") !== character.countryId) continue;
    if (election.state !== character.homeState) continue;

    const resolvedAtSource =
      candidate.withdrawnAt ?? election.updatedAt ?? election.endTime ?? election.createdAt;
    const resolvedAt = new Date(resolvedAtSource).getTime();
    const previous = latestResolvedCandidateByCharacterId.get(characterKey);
    if (!previous || resolvedAt > previous.resolvedAt) {
      latestResolvedCandidateByCharacterId.set(characterKey, {
        seatKey: getElectionSeatKey(election),
        resolvedAt,
      });
    }
  }

  for (const [characterKey, value] of latestResolvedCandidateByCharacterId) {
    targetSeatByCharacterId.set(characterKey, value.seatKey);
  }

  const elections = await db
    .collection<Election>("elections")
    .find({
      status: { $in: ["active", "upcoming"] },
      electionType: { $nin: Array.from(EXCLUDED_TYPES) },
    })
    .toArray();

  if (elections.length === 0) return;

  const countryIds = [
    ...new Set(elections.map((election) => (election.countryId ?? "US") as CountryId)),
  ];
  const opsConfigByCountry = new Map<CountryId, { governmentType: "onePartyState" }>();
  for (const countryId of countryIds) {
    const runtime = await getCountryState(db, countryId);
    if (runtime.governmentType === "onePartyState") {
      opsConfigByCountry.set(countryId, { governmentType: "onePartyState" });
    }
  }
  const partyByKey = new Map<string, Pick<PoliticalParty, "regimeStatus">>();
  if (opsConfigByCountry.size > 0) {
    const parties = await db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: { $in: [...opsConfigByCountry.keys()] } })
      .toArray();
    for (const party of parties) {
      partyByKey.set(`${party.countryId ?? "US"}:${String(party.sequentialId)}`, party);
    }
  }

  for (const election of elections) {
    // Auto-reentry only applies while the primary is still open — skip races
    // whose primary has closed. Turn-first (drift-immune) with a Date fallback.
    const primaryClosed =
      typeof election.primaryEndTurn === "number"
        ? currentTurn >= election.primaryEndTurn
        : !!election.primaryEndTime && now > new Date(election.primaryEndTime);
    if (primaryClosed) continue;

    const electionSeatKey = getElectionSeatKey(election);
    const eligible = characters.filter(
      (character) => targetSeatByCharacterId.get(character._id.toHexString()) === electionSeatKey
    );
    if (eligible.length === 0) continue;

    const electionKey = election._id.toHexString();
    const pending: Omit<ElectionCandidate, "_id">[] = [];
    const pendingNames: string[] = [];

    for (const character of eligible) {
      const characterKey = character._id.toHexString();
      if (existingEntry.has(`${electionKey}:${characterKey}`)) continue;

      // Blocked when the character holds an active candidacy in some OTHER
      // still-open race. Their candidacy in THIS race is excluded, matching
      // findBlockingActiveCandidacy's excludeElectionId.
      const blockingElections = blockingElectionsByCharacter.get(characterKey);
      if (blockingElections && [...blockingElections].some((id) => id !== electionKey)) continue;

      const electionCountry = (election.countryId ?? character.countryId ?? "US") as CountryId;
      const opsConfig = opsConfigByCountry.get(electionCountry);
      if (opsConfig) {
        const party =
          character.party && character.party !== "independent"
            ? (partyByKey.get(`${electionCountry}:${character.party}`) ?? null)
            : null;
        if (
          !canFieldLegislativeCandidate(opsConfig, party) ||
          !canFieldExecutiveCandidate(opsConfig, party, election.electionType)
        ) {
          continue;
        }
      }

      pending.push({
        electionId: election._id,
        countryId: election.countryId ?? character.countryId,
        characterId: character._id,
        characterName: character.name,
        party: character.party,
        status: "active",
        support: DEFAULT_CANDIDATE_SUPPORT,
        enteredAt: now,
      } as Omit<ElectionCandidate, "_id">);
      pendingNames.push(character.name);

      // Record the decision, not the write. A later election sharing this seat
      // key must see this entry as blocking, which is what the sequential
      // insertOne used to give us for free.
      existingEntry.add(`${electionKey}:${characterKey}`);
      let set = blockingElectionsByCharacter.get(characterKey);
      if (!set) blockingElectionsByCharacter.set(characterKey, (set = new Set()));
      set.add(electionKey);
    }

    if (pending.length === 0) continue;
    try {
      // Unordered: a duplicate key on one document still inserts the rest,
      // preserving the per-character tolerance the old try/catch had.
      await db.collection("electionCandidates").insertMany(pending as never[], { ordered: false });
    } catch {
      // Duplicate key or transient error - the unordered write still applied
      // everything it could, same as skipping silently per character before.
    }
    console.log(
      `[AutoReelection] Entered ${pendingNames.length} into ${election.electionType}/${election.state}: ${pendingNames.join(", ")}`
    );
  }
}
