import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type {
  Character,
  ElectionCandidate,
  ElectionVoteTally,
  ElectedOfficial,
  NPP,
  PoliticalParty,
} from "@/lib/db/types";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import {
  CONTINGENT_EXCLUDED_HOUSE_STATE,
  CONTINGENT_HOUSE_STATE_IDS,
  getTopContingentPresidentCandidates,
  getTopContingentVicePresidentCandidateIds,
  type ContingentCandidateProfile,
  type ContingentHouseDelegation,
  type ContingentVoterProfile,
  type ResolveContingentElectionInput,
} from "@/lib/turn/election/contingentElection";

function partyKey(countryId: string, partyId: string): string {
  return `${countryId}:${partyId}`;
}

type PartyPolicyFallback = Pick<PoliticalParty, "economicPosition" | "socialPosition">;

function buildCandidateProfile(
  id: string,
  party: string,
  policies: { economic: number; social: number } | undefined,
  partyFallback: PartyPolicyFallback | undefined
): ContingentCandidateProfile {
  return {
    id,
    party,
    economic: policies?.economic ?? partyFallback?.economicPosition ?? 0,
    social: policies?.social ?? partyFallback?.socialPosition ?? 0,
  };
}

function buildVoterProfile(
  id: string,
  party: string,
  policies: { economic: number; social: number } | undefined,
  partyFallback: PartyPolicyFallback | undefined,
  weight?: number
): ContingentVoterProfile {
  return {
    id,
    party,
    economic: policies?.economic ?? partyFallback?.economicPosition ?? 0,
    social: policies?.social ?? partyFallback?.socialPosition ?? 0,
    weight,
  };
}

export type ContingentChamberSnapshot = NonNullable<ElectionVoteTally["contingentChamberSnapshot"]>;

export type LoadContingentElectionDataResult = Omit<
  ResolveContingentElectionInput,
  "electionId" | "electoralVotesByCandidate"
> & {
  /** Populated when chamber composition was read live (not reused from a snapshot). */
  chamberSnapshot?: ContingentChamberSnapshot;
};

function padHouseDelegationsToAllStates(
  delegations: ContingentHouseDelegation[]
): ContingentHouseDelegation[] {
  const byState = new Map(delegations.map((d) => [d.stateId, d.voters]));
  return CONTINGENT_HOUSE_STATE_IDS.map((stateId) => ({
    stateId,
    voters: byState.get(stateId) ?? [],
  }));
}

function chamberSnapshotFromChamberData(
  houseDelegations: ContingentHouseDelegation[],
  senators: ContingentVoterProfile[],
  capturedAt: Date
): ContingentChamberSnapshot {
  return {
    capturedAt,
    houseDelegations: houseDelegations.map((d) => ({
      stateId: d.stateId,
      voters: d.voters.map((v) => ({
        id: v.id,
        party: v.party,
        economic: v.economic,
        social: v.social,
        weight: v.weight,
      })),
    })),
    senators: senators.map((v) => ({
      id: v.id,
      party: v.party,
      economic: v.economic,
      social: v.social,
      weight: v.weight,
    })),
  };
}

/**
 * Load current House/Senate composition and candidate profiles for a contingent
 * presidential election.
 */
export async function loadContingentElectionData(
  db: Db,
  electionId: ObjectId,
  countryId: string,
  candidates: ElectionCandidate[],
  electoralVotesByCandidate: Record<string, number>,
  options?: { chamberSnapshot?: ContingentChamberSnapshot }
): Promise<LoadContingentElectionDataResult> {
  const frozenChamber = options?.chamberSnapshot;
  const [houseOfficials, senateOfficials, parties] = await Promise.all([
    frozenChamber
      ? Promise.resolve([] as ElectedOfficial[])
      : db
          .collection<ElectedOfficial>("electedOfficials")
          .find({
            countryId: countryId as CountryId,
            officeType: "house",
            state: { $exists: true, $ne: CONTINGENT_EXCLUDED_HOUSE_STATE },
            $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true }, isNPP: true }],
          })
          .toArray(),
    frozenChamber
      ? Promise.resolve([] as ElectedOfficial[])
      : db
          .collection<ElectedOfficial>("electedOfficials")
          .find({
            countryId: countryId as CountryId,
            officeType: "senate",
            $or: [{ characterId: { $ne: null } }, { nppId: { $exists: true }, isNPP: true }],
          })
          .toArray(),
    db
      .collection<PoliticalParty>("politicalParties")
      .find({ countryId: countryId as CountryId })
      .project<
        Pick<PoliticalParty, "countryId" | "sequentialId" | "economicPosition" | "socialPosition">
      >({
        countryId: 1,
        sequentialId: 1,
        economicPosition: 1,
        socialPosition: 1,
      })
      .toArray(),
  ]);

  const partyMap = new Map(parties.map((p) => [partyKey(p.countryId, String(p.sequentialId)), p]));

  const charIds = new Set<string>();
  const nppIds = new Set<string>();

  for (const official of [...houseOfficials, ...senateOfficials]) {
    if (official.characterId) charIds.add(official.characterId.toString());
    if (official.isNPP && official.nppId) nppIds.add(official.nppId.toString());
  }

  const eligiblePresidentIds = new Set(
    getTopContingentPresidentCandidates(electoralVotesByCandidate, 3)
  );
  const runningMateByPresidentId: Record<string, string | undefined> = {};
  for (const candidate of candidates) {
    const cid = candidate._id.toString();
    if (!eligiblePresidentIds.has(cid)) continue;
    if (candidate.runningMateId) {
      const rmId = candidate.runningMateId.toString();
      runningMateByPresidentId[cid] = rmId;
      charIds.add(rmId);
    }
    if (candidate.isNPP && candidate.nppId) {
      nppIds.add(candidate.nppId.toString());
    } else if (candidate.characterId) {
      charIds.add(candidate.characterId.toString());
    }
  }

  // NPP presidential tickets may lack runningMateId — mirror presidentResolution's
  // same-party highest-PI auto-pick so Senate contingent ballots stay complete.
  for (const candidate of candidates) {
    const cid = candidate._id.toString();
    if (!eligiblePresidentIds.has(cid)) continue;
    if (runningMateByPresidentId[cid]) continue;
    if (!candidate.isNPP || !candidate.nppId) continue;
    const autoVp = await db
      .collection<NPP>("npps")
      .find({
        party: candidate.party,
        countryId: countryId as CountryId,
        _id: { $ne: candidate.nppId },
      })
      .sort({ politicalInfluence: -1 })
      .limit(1)
      .project({ _id: 1 })
      .toArray();
    if (autoVp[0]) {
      const nppVpKey = `npp_${autoVp[0]._id.toString()}`;
      runningMateByPresidentId[cid] = nppVpKey;
      nppIds.add(autoVp[0]._id.toString());
    }
  }

  const eligibleVpIds = new Set(
    getTopContingentVicePresidentCandidateIds(
      electoralVotesByCandidate,
      runningMateByPresidentId,
      2
    )
  );

  const [characters, npps] = await Promise.all([
    charIds.size > 0
      ? db
          .collection<Character>("characters")
          .find({ _id: { $in: [...charIds].map((id) => new ObjectId(id)) } })
          .project({ _id: 1, party: 1, policies: 1, currentOffice: 1 })
          .toArray()
      : [],
    nppIds.size > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: [...nppIds].map((id) => new ObjectId(id)) } })
          .project({ _id: 1, party: 1, policies: 1 })
          .toArray()
      : [],
  ]);

  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

  function policiesForOfficial(official: ElectedOfficial): ContingentVoterProfile | null {
    const weight = official.seatsHeld ?? 1;
    if (official.characterId) {
      const char = charMap.get(official.characterId.toString());
      const executiveType = char?.currentOffice?.type;
      if (executiveType === "president" || executiveType === "vicePresident") {
        return null;
      }
      const party = char?.party ?? official.party ?? "independent";
      return buildVoterProfile(
        official.characterId.toString(),
        party,
        char?.policies,
        partyMap.get(partyKey(countryId, party)),
        weight
      );
    }
    if (official.isNPP && official.nppId) {
      const npp = nppMap.get(official.nppId.toString());
      const party = npp?.party ?? official.party ?? "independent";
      return buildVoterProfile(
        `npp_${official.nppId.toString()}`,
        party,
        npp?.policies,
        partyMap.get(partyKey(countryId, party)),
        weight
      );
    }
    return null;
  }

  let houseDelegations: ContingentHouseDelegation[];
  let senators: ContingentVoterProfile[];

  if (frozenChamber) {
    houseDelegations = padHouseDelegationsToAllStates(
      frozenChamber.houseDelegations.map((d) => ({
        stateId: d.stateId,
        voters: d.voters.map((v) => ({ ...v, weight: v.weight ?? 1 })),
      }))
    );
    senators = frozenChamber.senators.map((v) => ({ ...v, weight: v.weight ?? 1 }));
  } else {
    const delegationsByState = new Map<string, ContingentVoterProfile[]>();
    for (const official of houseOfficials) {
      const stateId = official.state;
      if (!stateId || stateId === CONTINGENT_EXCLUDED_HOUSE_STATE) continue;
      const voter = policiesForOfficial(official);
      if (!voter) continue;
      const list = delegationsByState.get(stateId) ?? [];
      list.push(voter);
      delegationsByState.set(stateId, list);
    }

    houseDelegations = padHouseDelegationsToAllStates(
      [...delegationsByState.entries()].map(([stateId, voters]) => ({ stateId, voters }))
    );

    senators = [];
    for (const official of senateOfficials) {
      const voter = policiesForOfficial(official);
      if (voter) senators.push({ ...voter, weight: 1 });
    }
  }

  const presidentCandidates: ContingentCandidateProfile[] = [];
  for (const candidate of candidates) {
    const cid = candidate._id.toString();
    if (!eligiblePresidentIds.has(cid)) continue;
    if (candidate.isNPP && candidate.nppId) {
      const npp = nppMap.get(candidate.nppId.toString());
      presidentCandidates.push(
        buildCandidateProfile(
          cid,
          candidate.party,
          npp?.policies,
          partyMap.get(partyKey(countryId, candidate.party))
        )
      );
    } else if (candidate.characterId) {
      const char = charMap.get(candidate.characterId.toString());
      presidentCandidates.push(
        buildCandidateProfile(
          cid,
          candidate.party,
          char?.policies,
          partyMap.get(partyKey(countryId, candidate.party))
        )
      );
    }
  }

  const vicePresidentCandidates: ContingentCandidateProfile[] = [];
  for (const vpId of eligibleVpIds) {
    if (vpId.startsWith("npp_")) {
      const npp = nppMap.get(vpId.slice(4));
      if (!npp) continue;
      const party = npp.party ?? "independent";
      vicePresidentCandidates.push(
        buildCandidateProfile(vpId, party, npp.policies, partyMap.get(partyKey(countryId, party)))
      );
      continue;
    }
    const char = charMap.get(vpId);
    if (!char) continue;
    const party = char.party ?? "independent";
    vicePresidentCandidates.push(
      buildCandidateProfile(vpId, party, char.policies, partyMap.get(partyKey(countryId, party)))
    );
  }

  const evByEligibleId: Record<string, number> = {};
  for (const cid of eligiblePresidentIds) {
    evByEligibleId[cid] = electoralVotesByCandidate[cid] ?? 0;
  }
  for (const [presId, vpId] of Object.entries(runningMateByPresidentId)) {
    if (vpId && eligibleVpIds.has(vpId)) {
      evByEligibleId[vpId] = electoralVotesByCandidate[presId] ?? 0;
    }
  }

  const capturedAt = new Date();
  return {
    presidentCandidates,
    vicePresidentCandidates,
    houseDelegations,
    senators,
    evByEligibleId,
    ...(frozenChamber
      ? {}
      : {
          chamberSnapshot: chamberSnapshotFromChamberData(houseDelegations, senators, capturedAt),
        }),
  };
}

/** Default country for US presidential contingent elections. */
export const US_CONTINGENT_COUNTRY_ID = COUNTRY_CONFIGS.US.id;
