import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type {
  Character,
  State,
  DemographicCategory,
  StateDemographics,
  StatePartyOrg,
  Election,
  ElectionCandidate,
  NPP,
} from "@/lib/db/types";
import { computePollData, type OpponentForShare } from "@/lib/actions/pollCalculations";
import {
  getLastElectionPartyShares,
  type LastElectionPartySummary,
} from "@/lib/actions/prevElectionPartyShares";
import { computeLiveGroupTurnouts } from "@/lib/seeds/stateDemographics";
import { getGameTime } from "@/lib/time/gameTime";
import { isPrimaryEnded } from "@/lib/elections/phases";

export interface ElectionOpponents {
  electionId: string;
  electionType: string;
  state: string;
  /** True if the election is currently in its primary phase (primaryEndTime > now). */
  inPrimary: boolean;
  opponents: OpponentForShare[];
  /** Prior cycle general results by party (actual votes), for poll UI context */
  lastElection?: LastElectionPartySummary | null;
}

/**
 * Look up the character's active general election and return opponent summaries.
 * Returns null if no eligible election found or character is not a candidate.
 */
export async function getElectionOpponents(
  character: Character
): Promise<ElectionOpponents | null> {
  try {
    const db = await getDb();
    const charId = character._id;

    // Find elections in their home state that are active and in general phase
    const elections = await db
      .collection<Election>("elections")
      .find({ state: character.homeState, status: "active" })
      .toArray();

    if (elections.length === 0) return null;

    // Phase decisions are turn-first (drift-immune, freeze on pause) with a
    // Date fallback for un-backfilled docs.
    const gameTime = await getGameTime();
    const { currentTurn } = gameTime;

    for (const election of elections) {
      // Must be past primary phase (general election)
      if (!isPrimaryEnded(election, currentTurn, gameTime)) continue;

      // Check if our character is a candidate
      const myEntry = await db.collection<ElectionCandidate>("electionCandidates").findOne({
        electionId: election._id,
        characterId: charId,
        status: "active",
        isNPP: { $ne: true },
      });
      if (!myEntry) continue;

      // Fetch all other active candidates
      const otherCandidates = await db
        .collection<ElectionCandidate>("electionCandidates")
        .find({ electionId: election._id, status: "active", _id: { $ne: myEntry._id } })
        .toArray();

      if (otherCandidates.length === 0) return null;

      const [state, demographics, categories, statePartyOrgs] = await Promise.all([
        db
          .collection<State>("states")
          .findOne({ _id: character.homeState, countryId: character.countryId }),
        db
          .collection<StateDemographics>("stateDemographics")
          .findOne({ _id: character.homeState, countryId: character.countryId }),
        db.collection<DemographicCategory>("demographicCategories").find({}).toArray(),
        db
          .collection<StatePartyOrg>("statePartyOrg")
          .find({ countryId: character.countryId, stateId: character.homeState })
          .toArray(),
      ]);

      if (!state || !demographics) return null;

      // Pre-fetch turnout data once (same state for all opponents)
      const liveTurnouts = await computeLiveGroupTurnouts(state._id as string);

      // Pre-batch opponent lookups by type
      const nppIds = [
        ...new Set(
          otherCandidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!.toString())
        ),
      ];
      const charIds = [
        ...new Set(
          otherCandidates
            .filter((c) => !c.isNPP && c.characterId)
            .map((c) => c.characterId!.toString())
        ),
      ];

      const [nppDocs, charDocs] = await Promise.all([
        nppIds.length > 0
          ? db
              .collection<NPP>("npps")
              .find({ _id: { $in: nppIds.map((id) => new ObjectId(id)) } })
              .toArray()
          : Promise.resolve([]),
        charIds.length > 0
          ? db
              .collection<Character>("characters")
              .find({ _id: { $in: charIds.map((id) => new ObjectId(id)) } })
              .toArray()
          : Promise.resolve([]),
      ]);
      const nppById = new Map(nppDocs.map((n) => [n._id.toString(), n]));
      const charById = new Map(charDocs.map((c) => [c._id.toString(), c]));

      // Build opponent summaries with their own poll numbers
      const opponents = await Promise.all(
        otherCandidates.map(async (c) => {
          let opponentChar: Character | null = null;
          let opponentNPP: NPP | null = null;

          if (c.isNPP && c.nppId) {
            opponentNPP = nppById.get(c.nppId.toString()) ?? null;
          } else if (c.characterId) {
            opponentChar = charById.get(c.characterId.toString()) ?? null;
          }

          const econ = opponentChar?.policies.economic ?? opponentNPP?.policies.economic ?? 0;
          const social = opponentChar?.policies.social ?? opponentNPP?.policies.social ?? 0;
          const fav = opponentChar?.favorability ?? opponentNPP?.favorability ?? 50;
          const polInf = opponentChar?.politicalInfluence ?? opponentNPP?.politicalInfluence ?? 0;

          // Compute their estimated potential voters using same formula
          const syntheticChar = {
            ...character,
            policies: { economic: econ, social },
            favorability: fav,
            politicalInfluence: polInf,
            party: c.party,
          } as Character;

          const pd = await computePollData(
            syntheticChar,
            state,
            demographics,
            categories,
            statePartyOrgs,
            undefined,
            liveTurnouts,
            state.votingSystem ?? "fptp"
          );

          const archetypeApprovals =
            opponentChar?.archetypeApprovals ?? opponentNPP?.archetypeApprovals;
          // NPPs don't carry infamy; characters do. Leaving infamy undefined for
          // NPPs yields no penalty (infamyPenaltyMultiplier(undefined) === 1.0).
          const opponentInfamy = opponentChar?.infamy;

          return {
            candidateId: c._id.toString(),
            name: c.characterName,
            party: c.party,
            isNPP: c.isNPP ?? false,
            economicPosition: econ,
            socialPosition: social,
            favorability: fav,
            politicalInfluence: polInf,
            ...(archetypeApprovals && { archetypeApprovals }),
            ...(opponentInfamy != null && { infamy: opponentInfamy }),
            overallAppeal: pd.overallAppeal,
            totalPotentialVoters: pd.totalPotentialVoters,
            totalEstimatedVoters: pd.totalEstimatedVoters,
          };
        })
      );

      const lastElection = await getLastElectionPartyShares(db, election);

      const inPrimary = !isPrimaryEnded(election, currentTurn, gameTime);

      return {
        electionId: election._id.toString(),
        electionType: election.electionType,
        state: election.state,
        inPrimary,
        opponents,
        lastElection,
      };
    }

    return null;
  } catch (err) {
    console.error("[getElectionOpponents]", err);
    return null;
  }
}
