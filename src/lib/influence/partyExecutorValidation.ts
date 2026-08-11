import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import type {
  NPP,
  StatePartyOrg,
  PoliticalParty,
  Character,
  State,
  ElectionCandidate,
} from "@/lib/db/types";
import type { InfluenceType } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";
import { INFLUENCE_ACTIONS } from "./constants";
import { activeNppElectionCandidacyFilter } from "@/lib/elections/nppCandidacyQuery";
import { calculateRelocationCapacity } from "@/lib/npp/recruitment";

function getNPPCountry(npp: NPP): CountryId {
  return npp.countryId as CountryId;
}

/**
 * Reject party-influence stat-mutation actions when the target NPP's stat is
 * already pinned at the cap/floor. Without this, the party action pool +
 * treasury are debited for a clamped no-op write — same UX bug as the
 * simpleInfluence player path.
 *
 * Covers all four stat-mutating party-influence actions:
 * - boost_favorability  → npp.favorability cap 100
 * - boost_influence     → npp.politicalInfluence cap 100
 * - boost_loyalty       → npp.personality.loyalty cap 100
 * - reduce_stubbornness → npp.personality.stubbornness floor 0
 */
function checkTargetStatCap(
  npp: NPP,
  influenceType: InfluenceType
): { valid: boolean; error?: string } {
  if (influenceType === "boost_favorability" && (npp.favorability ?? 50) >= 100) {
    return {
      valid: false,
      error: `${npp.name}'s favorability is already maxed (100%). Wait for it to decay before boosting again.`,
    };
  }
  if (influenceType === "boost_influence" && (npp.politicalInfluence ?? 0) >= 100) {
    return {
      valid: false,
      error: `${npp.name}'s political influence is already maxed (100%).`,
    };
  }
  if (influenceType === "boost_loyalty" && (npp.personality?.loyalty ?? 50) >= 100) {
    return {
      valid: false,
      error: `${npp.name}'s loyalty is already maxed (100%).`,
    };
  }
  if (influenceType === "reduce_stubbornness" && (npp.personality?.stubbornness ?? 50) <= 0) {
    return {
      valid: false,
      error: `${npp.name}'s stubbornness is already at the floor (0%).`,
    };
  }
  return { valid: true };
}

export async function hasActivePlayersInState(stateId: string, partyId: string): Promise<boolean> {
  const db = await getDb();
  const playerCount = await db.collection<Character>("characters").countDocuments({
    homeState: stateId,
    party: partyId,
  });
  return playerCount > 0;
}

export async function getStatesWithoutPlayers(
  partyId: string,
  countryId: CountryId
): Promise<string[]> {
  const db = await getDb();
  const statesWithPlayers = await db.collection<Character>("characters").distinct("homeState", {
    party: partyId,
    countryId,
  });
  const allStates = await db
    .collection<State>("states")
    .find({ countryId })
    .project({ _id: 1 })
    .map((s) => s._id as unknown as string)
    .toArray();
  return allStates.filter((s) => !statesWithPlayers.includes(s));
}

export async function validateStatePartyInfluence(
  statePartyOrg: StatePartyOrg,
  npp: NPP,
  influenceType: InfluenceType,
  _fundAmount: number,
  actorCharacterId: ObjectId,
  context?: { electionId?: string; candidateId?: string; targetStateId?: string }
): Promise<{ valid: boolean; error?: string }> {
  const db = await getDb();

  const isChair = statePartyOrg.chairId?.equals(actorCharacterId);
  const isViceChair = statePartyOrg.viceChairId?.equals(actorCharacterId);
  const actor = await db.collection<Character>("characters").findOne({ _id: actorCharacterId });
  if (!actor) return { valid: false, error: "Actor not found" };

  const user = await db.collection("users").findOne({ _id: actor.userId });
  const isAdmin = user?.isAdmin || false;

  if (!isChair && !isViceChair && !isAdmin) {
    return {
      valid: false,
      error: "Only the State Party Chair or Vice Chair can use party influence.",
    };
  }

  if (influenceType === "relocate_state") {
    return {
      valid: false,
      error: "Only national party leadership can request that an NPP relocate states.",
    };
  }

  if (npp.homeState !== statePartyOrg.stateId) {
    return {
      valid: false,
      error:
        "This NPP is not in your state. State parties can only influence NPPs in their own state.",
    };
  }

  if (npp.party !== statePartyOrg.partyId) {
    return { valid: false, error: "State parties can only influence NPPs of their own party." };
  }

  // Affordability (Action Points + currency-based treasury cost) is enforced
  // atomically by the executor's debit — no stale Political-Strength check here.

  if (npp.retiredAt) {
    return { valid: false, error: "This NPP has retired from politics." };
  }

  const capCheck = checkTargetStatCap(npp, influenceType);
  if (!capCheck.valid) return capCheck;

  const actionWithdrawCheck = await validateNppMustBeCandidateForAction(
    db,
    influenceType,
    context,
    npp
  );
  if (!actionWithdrawCheck.valid) return actionWithdrawCheck;

  return { valid: true };
}

export async function validateNationalPartyInfluence(
  party: PoliticalParty,
  npp: NPP,
  influenceType: InfluenceType,
  _fundAmount: number,
  actorCharacterId: ObjectId,
  context?: { electionId?: string; candidateId?: string; targetStateId?: string }
): Promise<{ valid: boolean; error?: string }> {
  const db = await getDb();

  const isChair = party.chairId?.equals(actorCharacterId);
  const isViceChair = party.viceChairId?.equals(actorCharacterId);
  const actor = await db.collection<Character>("characters").findOne({ _id: actorCharacterId });
  if (!actor) return { valid: false, error: "Actor not found" };

  const user = await db.collection("users").findOne({ _id: actor.userId });
  const isAdmin = user?.isAdmin || false;

  if (!isChair && !isViceChair && !isAdmin) {
    return {
      valid: false,
      error: `Only the ${getPartyRoleLabel(party.countryId, "chair")} or ${getPartyRoleLabel(party.countryId, "viceChair")} can use party influence.`,
    };
  }

  const partyCountryId = (party.countryId ?? "US") as CountryId;
  const nppCountryId = getNPPCountry(npp);
  if (npp.party !== String(party.sequentialId) || nppCountryId !== partyCountryId) {
    return { valid: false, error: "National parties can only influence NPPs of their own party." };
  }

  // Affordability (Action Points + currency-based treasury cost) is enforced
  // atomically by the executor's debit — no stale Political-Strength check here.

  if (npp.retiredAt) {
    return { valid: false, error: "This NPP has retired from politics." };
  }

  const capCheck = checkTargetStatCap(npp, influenceType);
  if (!capCheck.valid) return capCheck;

  const relocationCheck = await validateNppStateRelocationRequest(
    db,
    npp,
    influenceType,
    context,
    partyCountryId
  );
  if (!relocationCheck.valid) return relocationCheck;

  const actionWithdrawCheck = await validateNppMustBeCandidateForAction(
    db,
    influenceType,
    context,
    npp
  );
  if (!actionWithdrawCheck.valid) return actionWithdrawCheck;

  return { valid: true };
}

async function validateNppStateRelocationRequest(
  db: Awaited<ReturnType<typeof getDb>>,
  npp: NPP,
  influenceType: InfluenceType,
  context: { electionId?: string; candidateId?: string; targetStateId?: string } | undefined,
  countryId: CountryId
): Promise<{ valid: boolean; error?: string }> {
  if (influenceType !== "relocate_state") {
    return { valid: true };
  }

  const targetStateId = context?.targetStateId?.trim();
  if (!targetStateId) {
    return { valid: false, error: "Select a target state for this relocation request." };
  }

  if (targetStateId === npp.homeState) {
    return { valid: false, error: "This NPP already lives in that state." };
  }

  const targetState = await db
    .collection<State>("states")
    .findOne({ _id: targetStateId, countryId });
  if (!targetState) {
    return { valid: false, error: "Target state not found in this country." };
  }

  const targetStatePartyOrg = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .findOne({ _id: `${targetStateId}_${npp.party}` });
  const targetOrgLevel = targetStatePartyOrg?.organization ?? 0;
  const [targetStateNppCount, regionCount, partyNppCount] = await Promise.all([
    db.collection<NPP>("npps").countDocuments({
      party: npp.party,
      homeState: targetStateId,
      retiredAt: null,
    }),
    db.collection<State>("states").countDocuments({ countryId }),
    db.collection<NPP>("npps").countDocuments({ party: npp.party, retiredAt: null }),
  ]);
  // Relocation is net-zero nationally, so it is capped by the roster-aware
  // relocation capacity, not the recruitment growth cap. See
  // `calculateRelocationCapacity`.
  const maxSlots = calculateRelocationCapacity(targetOrgLevel, partyNppCount, regionCount);
  if (targetStateNppCount >= maxSlots) {
    return {
      valid: false,
      error: `${targetState.name} is at capacity for your party (${targetStateNppCount}/${maxSlots} politicians). Build your party organization there, or move a politician out first.`,
    };
  }

  return { valid: true };
}

async function validateNppMustBeCandidateForAction(
  db: Awaited<ReturnType<typeof getDb>>,
  influenceType: InfluenceType,
  context: { electionId?: string; candidateId?: string } | undefined,
  npp: NPP
): Promise<{ valid: boolean; error?: string }> {
  const actionConfig = INFLUENCE_ACTIONS[influenceType];
  if (!actionConfig.nppMustBeCandidate) {
    return { valid: true };
  }
  if (!context?.electionId) {
    return { valid: false, error: "This action requires selecting an election." };
  }

  let electionObjId: ObjectId;
  try {
    electionObjId = new ObjectId(context.electionId);
  } catch {
    return { valid: false, error: "Invalid election ID." };
  }

  const cand = await db
    .collection<ElectionCandidate>("electionCandidates")
    .findOne(activeNppElectionCandidacyFilter(electionObjId, npp._id));
  if (!cand) {
    return {
      valid: false,
      error: "This NPP is not an active candidate in the selected election.",
    };
  }

  return { valid: true };
}
