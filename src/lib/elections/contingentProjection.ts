/**
 * Live projection of a US contingent presidential election.
 *
 * When the projected Electoral College has no majority, this runs the same
 * House state-delegation and Senate VP ballot the turn engine would run
 * (`loadContingentElectionData` + `resolveContingentElection`) against the
 * Congress that will actually cast it.
 *
 * Which Congress that is follows the engine, not a guess. Election resolution
 * seats House and Senate winners before the president in the same turn
 * (`generalElectionResolutionOrder`), so every chamber race that ends on or
 * before the presidential race seats its winners first. That is the 12th/20th
 * Amendment rule: the newly elected House picks the president. Seats with no
 * race in that window keep their sitting holder. In the founding round no
 * Congress is seated yet and every seat is up, so the projection is entirely
 * the House and Senate being elected now.
 *
 * Each concurrent race is projected from its current tally with the
 * resolver's US path: the same eligibility drops (retired NPPs, sitting
 * executives, deleted characters), conversion penalty, districted House
 * resolution or `allocateSeats`, and legacy seat floor.
 */
import { ObjectId, type Db } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  ElectedOfficial,
  GameState,
  NPP,
} from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import {
  assessContingentEvRisk,
  type ContingentProjectionDisplay,
} from "@/lib/elections/presidentialResolutionDisplay";
import { resolveContingentElection } from "@/lib/elections/contingentElection";
import { CONTINGENT_EXCLUDED_HOUSE_STATE } from "@/lib/elections/contingentConstants";
import { isExecutiveOffice } from "@/lib/elections/executiveOffice";
import { loadApportionment } from "@/lib/elections/apportionment";
import { loadSurvivingPartyResolver } from "@/lib/parties/survivingParty";
import { isRedistrictingEnabled } from "@/lib/redistricting/flag";
import { districtedHouseResolution } from "@/lib/redistricting/districtedHouseResolution";
import { allocateSeats } from "@/lib/turn/election/seatAllocation";
import {
  applyConversionVotePenalty,
  applyLegacySeatFloor,
} from "@/lib/turn/election/conversionTerms";
import { buildPrimaryShareMap } from "@/lib/turn/election/generalResolutionHelpers";
import {
  loadContingentElectionData,
  type ContingentChamberOfficials,
} from "@/lib/turn/election/loadContingentElectionData";

const CHAMBER_TYPES = ["house", "senate"] as const;

function lastSnapshotVotes(tally: ElectionVoteTally): Record<string, number> {
  const last = tally.turnSnapshots?.[tally.turnSnapshots.length - 1];
  return last?.cumulativeVotes ?? {};
}

/**
 * Officials one chamber race would seat if it resolved on its current tally.
 * An empty list means the race would leave its seats vacant.
 */
async function projectChamberRace(
  db: Db,
  race: Election,
  tally: ElectionVoteTally | null,
  gameState: GameState | null,
  houseSeats: Record<string, number>,
  survivingParty: (party: string | undefined) => string | undefined
): Promise<ElectedOfficial[]> {
  if (!tally) return [];
  let effectiveVotes: Record<string, number> = { ...tally.totalVotes };
  if (Object.keys(effectiveVotes).length === 0) effectiveVotes = { ...lastSnapshotVotes(tally) };
  if (Object.values(effectiveVotes).reduce((s, v) => s + v, 0) === 0) return [];

  const candidateIds = Object.keys(effectiveVotes);
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: candidateIds.map((id) => new ObjectId(id)) }, status: "active" })
    .toArray();
  for (const c of candidates) c.party = survivingParty(c.party) ?? c.party;
  const candidateMap = new Map(candidates.map((c) => [c._id.toString(), c]));

  const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId as ObjectId);
  const charIds = candidates
    .filter((c) => !c.isNPP && c.characterId)
    .map((c) => c.characterId as ObjectId);
  const [npps, chars] = await Promise.all([
    nppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find(
            { _id: { $in: nppIds } },
            { projection: { _id: 1, retiredAt: 1, currentOffice: 1 } }
          )
          .toArray()
      : Promise.resolve([]),
    charIds.length > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } }, { projection: { _id: 1, currentOffice: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);
  const nppById = new Map(npps.map((n) => [n._id.toString(), n]));
  const charById = new Map(chars.map((c) => [c._id.toString(), c]));

  const ineligible = new Set<string>();
  for (const c of candidates) {
    const id = c._id.toString();
    if (c.isNPP && c.nppId) {
      const npp = nppById.get(c.nppId.toString());
      if (!npp || npp.retiredAt != null || isExecutiveOffice(npp.currentOffice ?? null))
        ineligible.add(id);
    } else if (c.characterId) {
      const char = charById.get(c.characterId.toString());
      if (!char || isExecutiveOffice(char.currentOffice ?? null)) ineligible.add(id);
    }
  }
  effectiveVotes = Object.fromEntries(
    Object.entries(effectiveVotes).filter(([id]) => !ineligible.has(id))
  );
  effectiveVotes =
    applyConversionVotePenalty(
      effectiveVotes,
      (id) => candidateMap.get(id)?.party,
      race.conversionTerms
    ) ?? effectiveVotes;

  const ranked = candidateIds
    .map((id) => ({
      id,
      votes: effectiveVotes[id] ?? 0,
      party: candidateMap.get(id)?.party,
      isNPP: candidateMap.get(id)?.isNPP,
    }))
    .filter(({ id }) => candidateMap.has(id) && !ineligible.has(id))
    .sort((a, b) => b.votes - a.votes);
  if (ranked.length === 0) return [];
  const totalVotesCast = ranked.reduce((sum, { votes }) => sum + votes, 0);

  let districted: Awaited<ReturnType<typeof districtedHouseResolution>> = null;
  if (race.electionType === "house" && isRedistrictingEnabled(gameState)) {
    const candidateParty: Record<string, string> = {};
    const candidateCharacterId: Record<string, string | null> = {};
    const candidateNppId: Record<string, string | null> = {};
    for (const id of Object.keys(effectiveVotes)) {
      const c = candidateMap.get(id);
      candidateParty[id] = c?.party ?? tally.candidateParties?.[id] ?? "";
      candidateNppId[id] = c?.isNPP && c.nppId ? c.nppId.toString() : null;
      candidateCharacterId[id] = !c?.isNPP && c?.characterId ? c.characterId.toString() : null;
    }
    districted = await districtedHouseResolution(db, {
      countryId: "US",
      stateId: race.state as string,
      candidateVotes: effectiveVotes,
      candidateParty,
      candidateCharacterId,
      candidateNppId,
      primaryShares: buildPrimaryShareMap(tally.primaryResults ?? null),
      districtBoosts: (race as { districtCampaignBoosts?: Record<string, Record<string, number>> })
        .districtCampaignBoosts,
      now: new Date(),
    });
  }

  const allocation = applyLegacySeatFloor(
    districted ??
      allocateSeats(
        race.electionType,
        race.state,
        race.totalSeats ?? 1,
        ranked,
        totalVotesCast,
        houseSeats,
        undefined,
        undefined,
        race.countryId ?? "US",
        race.allocationMethod
      ),
    ranked,
    race.conversionTerms
  );

  const seated: ElectedOfficial[] = [];
  for (const [id, seats] of allocation.winners) {
    const c = candidateMap.get(id);
    if (!c || seats <= 0) continue;
    const isNPP = Boolean(c.isNPP && c.nppId);
    seated.push({
      _id: new ObjectId(),
      countryId: race.countryId,
      officeType: race.electionType,
      state: race.state,
      ...(race.senateClass ? { senateClass: race.senateClass } : {}),
      seatsHeld: seats,
      characterId: isNPP ? null : (c.characterId ?? null),
      isNPP,
      nppId: isNPP ? c.nppId : null,
      party: c.party,
    });
  }
  return seated;
}

const seatedHolderFilter = {
  $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true }, isNPP: true }],
};

async function buildProjectedChamber(
  db: Db,
  president: Election,
  countryId: string,
  gameState: GameState | null
): Promise<{
  chamber: ContingentChamberOfficials;
  houseRacesProjected: number;
  sittingHouseStates: number;
}> {
  const windowEnd = president.endTurn;
  const races = await db
    .collection<Election>("elections")
    .find({
      countryId: countryId as CountryId,
      electionType: { $in: [...CHAMBER_TYPES] },
      status: { $in: ["upcoming", "active", "completed"] },
      ...(windowEnd != null ? { endTurn: { $lte: windowEnd } } : { endTime: president.endTime }),
    })
    .toArray();

  const tallies =
    races.length > 0
      ? await db
          .collection<ElectionVoteTally>("electionVoteTallies")
          .find({ electionId: { $in: races.map((r) => r._id) } })
          .toArray()
      : [];
  const tallyByElection = new Map(tallies.map((t) => [t.electionId.toString(), t]));
  const houseSeats = (await loadApportionment(db, gameState?.preset, gameState?.currentYear))
    .houseSeats;
  const survivingParty = await loadSurvivingPartyResolver(db, countryId);

  const projected = await Promise.all(
    races.map(async (race) => ({
      race,
      officials: await projectChamberRace(
        db,
        race,
        tallyByElection.get(race._id.toString()) ?? null,
        gameState,
        houseSeats,
        survivingParty
      ),
    }))
  );

  const houseStatesUp = new Set<string>();
  const senateSeatsUp = new Set<string>();
  const senateStatesUpAllClasses = new Set<string>();
  const house: ElectedOfficial[] = [];
  const senate: ElectedOfficial[] = [];
  for (const { race, officials } of projected) {
    if (!race.state) continue;
    if (race.electionType === "house") {
      houseStatesUp.add(race.state);
      house.push(...officials);
    } else {
      if (race.senateClass) senateSeatsUp.add(`${race.state}:${race.senateClass}`);
      else senateStatesUpAllClasses.add(race.state);
      senate.push(...officials);
    }
  }

  const [sittingHouse, sittingSenate] = await Promise.all([
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({
        countryId: countryId as CountryId,
        officeType: "house",
        state: { $exists: true, $nin: [CONTINGENT_EXCLUDED_HOUSE_STATE, ...houseStatesUp] },
        ...seatedHolderFilter,
      })
      .toArray(),
    db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ countryId: countryId as CountryId, officeType: "senate", ...seatedHolderFilter })
      .toArray(),
  ]);
  house.push(...sittingHouse);
  for (const s of sittingSenate) {
    if (!s.state || senateStatesUpAllClasses.has(s.state)) continue;
    if (s.senateClass && senateSeatsUp.has(`${s.state}:${s.senateClass}`)) continue;
    senate.push(s);
  }

  return {
    chamber: { house, senate },
    houseRacesProjected: houseStatesUp.size,
    sittingHouseStates: new Set(sittingHouse.map((o) => o.state)).size,
  };
}

async function personName(db: Db, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  if (personId.startsWith("npp_")) {
    const npp = await db
      .collection<NPP>("npps")
      .findOne({ _id: new ObjectId(personId.slice(4)) }, { projection: { name: 1 } });
    return npp?.name ?? null;
  }
  if (!ObjectId.isValid(personId)) return null;
  const char = await db
    .collection<Character>("characters")
    .findOne({ _id: new ObjectId(personId) }, { projection: { name: 1 } });
  return char?.name ?? null;
}

async function computeProjection(
  db: Db,
  president: Election,
  electoralVotesByCandidate: Record<string, number>,
  gameState: GameState | null
): Promise<ContingentProjectionDisplay | null> {
  const countryId = president.countryId ?? "US";
  const { chamber, houseRacesProjected, sittingHouseStates } = await buildProjectedChamber(
    db,
    president,
    countryId,
    gameState
  );

  const survivingParty = await loadSurvivingPartyResolver(db, countryId);
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({
      _id: { $in: Object.keys(electoralVotesByCandidate).map((id) => new ObjectId(id)) },
      status: "active",
    })
    .toArray();
  for (const c of candidates) c.party = survivingParty(c.party) ?? c.party;

  const { chamberSnapshot: _unused, ...input } = await loadContingentElectionData(
    db,
    president._id,
    countryId,
    candidates,
    electoralVotesByCandidate,
    { chamberOfficials: chamber }
  );
  if (input.presidentCandidates.length === 0) return null;
  const result = resolveContingentElection({
    electionId: president._id,
    electoralVotesByCandidate,
    ...input,
  });

  const founding = gameState?.preIteration?.active === true;
  const basis: ContingentProjectionDisplay["basis"] = founding
    ? "founding"
    : houseRacesProjected === 0
      ? "sitting"
      : sittingHouseStates > 0
        ? "mixed"
        : "incoming";

  const finalBallot = result.houseBallots[result.houseBallots.length - 1];
  const delegationsVoting = finalBallot
    ? Object.values(finalBallot.delegationVotes).filter((v) => v != null).length
    : 0;
  const topHouse = Math.max(0, ...Object.values(result.houseVoteTotals));
  const topSenate = Math.max(0, ...Object.values(result.senateVoteTotals));

  return {
    basis,
    presidentWinnerId: result.presidentWinnerId,
    houseDeadlocked: topHouse < result.houseThreshold,
    houseVoteTotals: result.houseVoteTotals,
    houseThreshold: result.houseThreshold,
    delegationsVoting,
    houseRacesProjected,
    vicePresidentWinnerId: result.vicePresidentWinnerId,
    vicePresidentWinnerName: await personName(db, result.vicePresidentWinnerId),
    senateVoteTotals: result.senateVoteTotals,
    senateThreshold: result.senateThreshold,
    senateDeadlocked:
      result.eligibleVicePresidentCandidateIds.length >= 2 && topSenate < result.senateThreshold,
  };
}

/**
 * The projection reads ~100 chamber tallies plus districted House resolution,
 * and every input moves only when a turn processes. Memoise per election per
 * turn so page views and polling share one computation.
 */
const projectionCache = new Map<string, Promise<ContingentProjectionDisplay | null>>();
const PROJECTION_CACHE_LIMIT = 16;

export async function projectContingentElection(
  db: Db,
  president: Election,
  electoralVotesByCandidate: Record<string, number> | undefined,
  evNeeded: number,
  gameState: GameState | null
): Promise<ContingentProjectionDisplay | null> {
  if ((president.countryId ?? "US") !== "US" || president.electionType !== "president") return null;
  const risk = assessContingentEvRisk(electoralVotesByCandidate, evNeeded);
  if (!risk?.atRisk || !electoralVotesByCandidate) return null;

  const evKey = Object.entries(electoralVotesByCandidate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, ev]) => `${id}=${ev}`)
    .join(",");
  const key = `${president._id.toString()}:${gameState?.currentTurn ?? "?"}:${evKey}`;
  let pending = projectionCache.get(key);
  if (!pending) {
    pending = computeProjection(db, president, electoralVotesByCandidate, gameState).catch(
      (err) => {
        projectionCache.delete(key);
        console.error(`[contingentProjection] ${president._id.toString()} failed`, err);
        return null;
      }
    );
    if (projectionCache.size >= PROJECTION_CACHE_LIMIT) projectionCache.clear();
    projectionCache.set(key, pending);
  }
  return pending;
}
