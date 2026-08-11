import type { CountryId } from "@/lib/constants/countries";
import type { Character, Election, ElectionCandidate, NPP, PoliticalParty } from "@/lib/db/types";
import { getNationalPartyInfluenceOptions, INFLUENCE_ACTIONS } from "@/lib/influence";
import type { NationalPartyInfluenceResponse } from "@/lib/parties/dto/partyView";
import {
  NPP_MANAGEMENT_AP_COST,
  nppActionPointCap,
  nppActionPointRegen,
  nppManagementFundCost,
  nppTreasuryCurrency,
} from "@/lib/npp/actionPoints";
import { resolvePartyTier } from "@/lib/parties/partyTier";
import type { Db } from "mongodb";

const NATIONAL_PARTY_MANAGEMENT_ACTIONS = [
  "boost_favorability",
  "boost_influence",
  "boost_loyalty",
  "reduce_stubbornness",
  "relocate_state",
] as const;

export async function getNationalPartyInfluenceView(
  db: Db,
  party: PoliticalParty,
  countryId: CountryId
): Promise<NationalPartyInfluenceResponse> {
  const options = await getNationalPartyInfluenceOptions(party);
  const statesWithNpps = Object.keys(options.nppsByState);
  const activeElections =
    statesWithNpps.length === 0
      ? []
      : await db
          .collection<Election>("elections")
          .find({
            countryId,
            state: { $in: statesWithNpps },
            status: { $in: ["upcoming", "active"] },
          })
          .toArray();

  const electionIds = activeElections.map((election) => election._id);
  const candidates =
    electionIds.length === 0
      ? []
      : await db
          .collection<ElectionCandidate>("electionCandidates")
          .find({ electionId: { $in: electionIds }, status: "active" })
          .toArray();

  const charIds = candidates
    .filter((candidate) => !candidate.isNPP)
    .map((candidate) => candidate.characterId);
  const nppIds = candidates
    .filter((candidate) => candidate.isNPP && candidate.nppId)
    .map((candidate) => candidate.nppId!);
  const [characters, npps] = await Promise.all([
    charIds.length === 0
      ? Promise.resolve([] as Character[])
      : db
          .collection<Character>("characters")
          .find({ _id: { $in: charIds } })
          .toArray(),
    nppIds.length === 0
      ? Promise.resolve([] as NPP[])
      : db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } })
          .toArray(),
  ]);
  const charMap = new Map(characters.map((character) => [character._id.toString(), character]));
  const nppMap = new Map(npps.map((npp) => [npp._id.toString(), npp]));

  // NPP work spends a flat 1 AP per management action from the dedicated pool.
  const tier = resolvePartyTier(party);
  const apCap = nppActionPointCap("national", tier);
  const availableAp = party.nppActionPoints ?? apCap;

  const currency = nppTreasuryCurrency(countryId);
  const actions = NATIONAL_PARTY_MANAGEMENT_ACTIONS.map((type) => {
    const config = INFLUENCE_ACTIONS[type];
    const fundCost = nppManagementFundCost(type, currency);
    let available = true;
    let unavailableReason: string | undefined;
    if (availableAp < NPP_MANAGEMENT_AP_COST) {
      available = false;
      unavailableReason = "Not enough Action Points";
    } else if ((party.treasury ?? 0) < fundCost) {
      available = false;
      unavailableReason = "Not enough party treasury funds";
    }
    return {
      type: config.type,
      name: config.name,
      description: config.description,
      actionCost: NPP_MANAGEMENT_AP_COST,
      baseFundCost: fundCost,
      baseChance: config.baseChance,
      available,
      unavailableReason,
    };
  });

  return {
    partyId: String(party.sequentialId),
    partyName: party.name,
    politicalStrength: party.politicalStrength || 0,
    treasury: party.treasury ?? 0,
    nppActionPoints: availableAp,
    nppActionPointCap: apCap,
    nppActionPointRegen: nppActionPointRegen("national", tier),
    actions,
    availableStates: options.availableStates,
    stateNames: options.stateNames,
    targetStates: options.targetStates,
    nppsByState: options.nppsByState,
    context: {
      activeElections: activeElections.map((election) => ({
        id: election._id.toString(),
        label: `${election.state} ${election.electionType}${
          election.electionType === "senate" ? ` (Class ${election.senateClass})` : ""
        }`,
        state: election.state,
        type: election.electionType,
        senateClass: election.senateClass ?? undefined,
      })),
      nppCandidacies: candidates
        .filter((candidate) => candidate.isNPP)
        .map((candidate) => ({
          electionId: candidate.electionId.toString(),
          candidateId: candidate._id.toString(),
          nppId: candidate.nppId?.toString(),
        })),
      candidates: candidates.map((candidate) => ({
        id: candidate._id.toString(),
        electionId: candidate.electionId.toString(),
        name: candidate.characterName,
        party: candidate.party,
        isNPP: candidate.isNPP || false,
        politicalInfluence:
          candidate.isNPP && candidate.nppId
            ? (nppMap.get(candidate.nppId.toString())?.politicalInfluence ?? 0)
            : (charMap.get(candidate.characterId.toString())?.nationalInfluence ??
              charMap.get(candidate.characterId.toString())?.politicalInfluence ??
              0),
      })),
    },
  };
}
