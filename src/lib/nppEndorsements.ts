import { ObjectId, type ClientSession, type Db, type Filter } from "mongodb";
import type {
  Character,
  Election,
  ElectionCandidate,
  NPP,
  NPPEndorsement,
  NPPEndorsementPhase,
  NPPEndorsementSource,
  NPPEndorsementWithdrawalReason,
} from "@/lib/db/types";

export const NPP_ENDORSEMENT_REEVALUATION_TURNS = 4;
export const NPP_ENDORSEMENT_MIN_SCORE = 58;
export const NPP_ENDORSEMENT_SWITCH_MARGIN = 12;
export const NPP_ENDORSEMENT_DIRECT_FAVORABILITY_PER_ENDORSEMENT = 1.5;
export const NPP_ENDORSEMENT_DIRECT_FAVORABILITY_CAP = 6;

const NATIONAL_RACE_TYPES = new Set(["president", "primeMinister", "chancellor", "uachtaran"]);

export interface EndorsementCandidateProfile {
  candidate: ElectionCandidate;
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  party: string;
  homeState: string | null;
  relationshipScore: number;
}

export type RequestedEndorsementLikelihood = "likely_accept" | "likely_decline";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRelationshipScore(score: number): number {
  return clamp((score + 100) / 2, 0, 100);
}

function isNationalRace(election: Election): boolean {
  return NATIONAL_RACE_TYPES.has(election.electionType);
}

export function getNppOfficeType(npp: NPP): string | null {
  if (!npp.currentOffice) return null;
  if (typeof npp.currentOffice === "string") return npp.currentOffice;
  return "type" in npp.currentOffice ? npp.currentOffice.type : null;
}

export function getEndorsementDecisionPhase(
  election: Election,
  currentTurn: number,
  now: Date
): NPPEndorsementPhase {
  // Turn-first (drift-immune, freezes on pause) with a Date fallback for
  // elections not yet backfilled.
  const inPrimary =
    typeof election.primaryEndTurn === "number"
      ? currentTurn < election.primaryEndTurn
      : election.primaryEndTime
        ? election.primaryEndTime.getTime() > now.getTime()
        : false;
  return inPrimary ? "primary" : "general";
}

export function getEndorsementTargetId(candidate: ElectionCandidate): ObjectId {
  return candidate.characterId;
}

export function isSelfEndorsementCandidate(npp: NPP, candidate: ElectionCandidate): boolean {
  return Boolean(candidate.isNPP && candidate.nppId?.equals(npp._id));
}

export function getNppElectionRelevanceScore(npp: NPP, election: Election): number {
  if (npp.countryId && election.countryId !== npp.countryId) return 0;

  const officeType = getNppOfficeType(npp);
  const officeState =
    npp.currentOffice && typeof npp.currentOffice === "object" && "state" in npp.currentOffice
      ? (npp.currentOffice.state ?? null)
      : null;

  const homeStateMatch = election.state === npp.homeState;
  const nationalRace = isNationalRace(election);
  const sameOfficeType = officeType != null && officeType === election.electionType;
  const sameOfficeState = sameOfficeType && officeState != null && officeState === election.state;

  // Broad race scope needs a plausibility gate so endorsements do not become
  // ambient background noise from every NPP in the country every few turns.
  if (!homeStateMatch && !nationalRace && !sameOfficeState) {
    return 0;
  }

  let score = 0;
  if (homeStateMatch) score += 34;
  if (nationalRace) score += 18;
  if (sameOfficeType) score += 20;
  if (sameOfficeState) score += 12;

  if (
    sameOfficeType &&
    npp.currentOffice &&
    typeof npp.currentOffice === "object" &&
    "senateClass" in npp.currentOffice &&
    typeof npp.currentOffice.senateClass === "number" &&
    typeof election.senateClass === "number" &&
    npp.currentOffice.senateClass === election.senateClass
  ) {
    score += 6;
  }

  if (
    sameOfficeType &&
    npp.currentOffice &&
    typeof npp.currentOffice === "object" &&
    "chamberClass" in npp.currentOffice &&
    typeof npp.currentOffice.chamberClass === "number" &&
    typeof election.chamberClass === "number" &&
    npp.currentOffice.chamberClass === election.chamberClass
  ) {
    score += 6;
  }

  return score;
}

export function nppCanPlausiblyEndorseElection(npp: NPP, election: Election): boolean {
  // Player-requested endorsements are available for any election type the
  // player runs in, as long as the NPP and election share a country. The
  // narrower relevance score (home state / national race / same-office-state)
  // still informs organic priority via getNppElectionRelevanceScore, but it
  // must not gate the Campaign Manager — players were locked out of valid
  // requests in races where they had clear ally relationships.
  if (npp.countryId && election.countryId !== npp.countryId) return false;
  return true;
}

export function getRequestedEndorsementRelationshipRequirement(
  npp: Pick<NPP, "policies">,
  candidatePolicies: Pick<Character, "policies"> | Pick<NPP, "policies">
): number {
  // Endorsement asks are now manual-only and deterministic. A perfect
  // ideological match can get an NPP comfortable enough at 40 relationship,
  // while every policy step away makes the ask harder up to the default 50.
  const policyDistance = clamp(
    Math.abs(npp.policies.economic - candidatePolicies.policies.economic) +
      Math.abs(npp.policies.social - candidatePolicies.policies.social),
    0,
    10
  );
  return 40 + policyDistance;
}

export function getRequestedEndorsementLikelihood(
  relationshipScore: number,
  requiredRelationship: number
): RequestedEndorsementLikelihood {
  return relationshipScore >= requiredRelationship ? "likely_accept" : "likely_decline";
}

export function buildActiveVisibleNppEndorsementFilter(
  baseFilter: Filter<NPPEndorsement> = {}
): Filter<NPPEndorsement> {
  // Organic campaign endorsements were removed in favor of manual requests.
  // Legacy organic rows may still exist in live data until the next cleanup
  // tick, so every read path must hide them immediately rather than letting
  // stale boosts and endorsement counts leak into the current turn.
  return {
    $and: [
      baseFilter,
      { isActive: true },
      {
        $or: [{ source: { $exists: false } }, { source: "arranged" }],
      },
    ],
  };
}

export function scoreEndorsementCandidate(
  npp: NPP,
  election: Election,
  profile: EndorsementCandidateProfile
): number {
  if (isSelfEndorsementCandidate(npp, profile.candidate)) {
    return 0;
  }

  const relevance = getNppElectionRelevanceScore(npp, election);
  if (relevance <= 0) return 0;

  const ideologicalDistance =
    Math.abs(npp.policies.economic - profile.economicPosition) +
    Math.abs(npp.policies.social - profile.socialPosition);
  const ideologyAlignment = 100 - clamp((ideologicalDistance / 20) * 100, 0, 100);
  const viability = clamp(profile.favorability * 0.65 + profile.politicalInfluence * 0.35, 0, 100);
  const relationship = normalizeRelationshipScore(profile.relationshipScore);
  const samePartyBonus = profile.party === npp.party ? 16 : 0;
  const homeStateBonus = profile.homeState != null && profile.homeState === npp.homeState ? 6 : 0;

  return (
    relationship * 0.28 +
    ideologyAlignment * 0.24 +
    clamp(relevance, 0, 40) * 0.5 +
    viability * 0.18 +
    samePartyBonus +
    homeStateBonus
  );
}

export async function withdrawNppEndorsement(
  db: Db,
  endorsementId: ObjectId,
  reason: NPPEndorsementWithdrawalReason,
  now: Date
): Promise<void> {
  await db.collection<NPPEndorsement>("nppEndorsements").updateOne(
    { _id: endorsementId, isActive: true },
    {
      $set: {
        isActive: false,
        withdrawnAt: now,
        withdrawnReason: reason,
      },
    }
  );
}

export interface UpsertNppEndorsementInput {
  npp: NPP;
  candidate: ElectionCandidate;
  source: NPPEndorsementSource;
  now: Date;
  currentTurn: number;
  score?: number;
  candidateCountAtDecision: number;
  electionPhaseAtDecision: NPPEndorsementPhase;
  arrangedBy?: ObjectId;
  arrangedByParty?: string;
  session?: ClientSession;
}

export async function upsertNppEndorsement(
  db: Db,
  input: UpsertNppEndorsementInput
): Promise<void> {
  if (isSelfEndorsementCandidate(input.npp, input.candidate)) {
    return;
  }

  const targetId = getEndorsementTargetId(input.candidate);
  const endorsementsCol = db.collection<NPPEndorsement>("nppEndorsements");
  const existing = await endorsementsCol
    .find(
      {
        nppId: input.npp._id,
        electionId: input.candidate.electionId,
        isActive: true,
      },
      input.session ? { session: input.session } : undefined
    )
    .toArray();

  const matching = existing.find((endorsement) => endorsement.candidateId.equals(targetId));
  const setFields: Pick<
    NPPEndorsement,
    | "nppName"
    | "candidateName"
    | "candidateIsNPP"
    | "source"
    | "score"
    | "candidateCountAtDecision"
    | "electionPhaseAtDecision"
  > & {
    lastEvaluatedTurn: number;
    reevaluateAfterTurn: number;
  } & {
    arrangedBy?: ObjectId;
    arrangedByParty?: string;
  } = {
    nppName: input.npp.name,
    candidateName: input.candidate.characterName,
    candidateIsNPP: Boolean(input.candidate.isNPP),
    source: input.source,
    score: input.score,
    candidateCountAtDecision: input.candidateCountAtDecision,
    electionPhaseAtDecision: input.electionPhaseAtDecision,
    lastEvaluatedTurn: input.currentTurn,
    reevaluateAfterTurn: input.currentTurn + NPP_ENDORSEMENT_REEVALUATION_TURNS,
  };
  if (input.arrangedBy) {
    setFields.arrangedBy = input.arrangedBy;
  }
  if (input.arrangedByParty) {
    setFields.arrangedByParty = input.arrangedByParty;
  }

  if (matching) {
    await endorsementsCol.updateOne(
      { _id: matching._id },
      {
        $set: setFields,
        $unset: {
          withdrawnAt: "",
          withdrawnReason: "",
          ...(!input.arrangedBy ? { arrangedBy: "" } : {}),
          ...(!input.arrangedByParty ? { arrangedByParty: "" } : {}),
        },
      },
      input.session ? { session: input.session } : undefined
    );
  } else {
    await endorsementsCol.insertOne(
      {
        _id: new ObjectId(),
        nppId: input.npp._id,
        electionId: input.candidate.electionId,
        candidateId: targetId,
        nppName: setFields.nppName,
        candidateName: setFields.candidateName,
        candidateIsNPP: setFields.candidateIsNPP,
        source: setFields.source,
        score: setFields.score,
        candidateCountAtDecision: setFields.candidateCountAtDecision,
        electionPhaseAtDecision: setFields.electionPhaseAtDecision,
        lastEvaluatedTurn: setFields.lastEvaluatedTurn,
        reevaluateAfterTurn: setFields.reevaluateAfterTurn,
        ...(input.arrangedBy ? { arrangedBy: input.arrangedBy } : {}),
        ...(input.arrangedByParty ? { arrangedByParty: input.arrangedByParty } : {}),
        isActive: true,
        createdAt: input.now,
      },
      input.session ? { session: input.session } : undefined
    );
  }

  const staleIds = existing
    .filter((endorsement) =>
      matching ? !endorsement._id.equals(matching._id) : !endorsement.candidateId.equals(targetId)
    )
    .map((endorsement) => endorsement._id);
  if (staleIds.length > 0) {
    await endorsementsCol.updateMany(
      { _id: { $in: staleIds }, isActive: true },
      {
        $set: {
          isActive: false,
          withdrawnAt: input.now,
          withdrawnReason: "switched",
        },
      },
      input.session ? { session: input.session } : undefined
    );
  }
}

export function getArrangedEndorsementHoldBonus(source: NPPEndorsementSource | undefined): number {
  return source === "arranged" ? 8 : 4;
}

export function getCandidateIdentity(
  candidate: ElectionCandidate,
  charactersById: Map<string, Character>,
  nppsById: Map<string, NPP>
): {
  economicPosition: number;
  socialPosition: number;
  favorability: number;
  politicalInfluence: number;
  homeState: string | null;
} | null {
  if (candidate.isNPP && candidate.nppId) {
    const npp = nppsById.get(candidate.nppId.toString());
    if (!npp) return null;
    return {
      economicPosition: npp.policies.economic,
      socialPosition: npp.policies.social,
      favorability: npp.favorability,
      politicalInfluence: npp.politicalInfluence,
      homeState: npp.homeState,
    };
  }

  const character = charactersById.get(candidate.characterId.toString());
  if (!character) return null;

  return {
    economicPosition: character.policies.economic,
    socialPosition: character.policies.social,
    favorability: character.favorability,
    politicalInfluence: character.politicalInfluence,
    homeState: character.homeState,
  };
}
