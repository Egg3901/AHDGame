import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { executeNationalPartyInfluence, INFLUENCE_ACTIONS } from "@/lib/influence";
import { getNationalPartyLeadershipRole } from "@/lib/parties/access";
import type { InfluenceType, PoliticalParty } from "@/lib/db/types";

const NATIONAL_PARTY_MANAGEMENT_ACTIONS: InfluenceType[] = [
  "boost_favorability",
  "boost_influence",
  "boost_loyalty",
  "reduce_stubbornness",
  "relocate_state",
];

/**
 * Defense-in-depth: NPP Move stays chair / vice-chair / admin even if a
 * campaigner somehow reaches this queue. Route auth already excludes
 * campaigners from the whole national influence surface (ticket #1028).
 */
const CAMPAIGNER_EXCLUDED_ACTIONS: InfluenceType[] = ["relocate_state"];

function canRelocate(party: PoliticalParty, actor: AuthUserWithCharacter): boolean {
  if (actor.isAdmin) return true;
  const role = getNationalPartyLeadershipRole(party, actor.character?._id ?? null);
  return role === "chair" || role === "viceChair";
}

export interface NationalPartyInfluenceQueueItem {
  nppId: string;
  influenceType: InfluenceType;
  fundAmount: number;
  context: { electionId?: string; candidateId?: string; targetStateId?: string };
}

export async function executeNationalPartyInfluenceQueue(
  db: Db,
  {
    party,
    actor,
    queueItems,
  }: {
    party: PoliticalParty;
    actor: AuthUserWithCharacter;
    queueItems: NationalPartyInfluenceQueueItem[];
  }
) {
  const unsupportedItem = queueItems.find(
    (item) => !NATIONAL_PARTY_MANAGEMENT_ACTIONS.includes(item.influenceType)
  );
  if (unsupportedItem) {
    return {
      error: `${INFLUENCE_ACTIONS[unsupportedItem.influenceType].name} is not available in NPP Management.`,
      status: 400,
    } as const;
  }

  // Per-action gate: NPP Move stays chair / vice / admin.
  // Route-level `canUseNationalPartyInfluence` already excludes campaigners.
  const blockedItem = queueItems.find(
    (item) => CAMPAIGNER_EXCLUDED_ACTIONS.includes(item.influenceType) && !canRelocate(party, actor)
  );
  if (blockedItem) {
    return {
      error: `${INFLUENCE_ACTIONS[blockedItem.influenceType].name} requires the chair, vice chair, or admin (campaigners excluded).`,
      status: 403,
    } as const;
  }

  const partyId = String(party.sequentialId);
  const results: Array<{
    success: boolean;
    outcome: string;
    message: string;
    nppId: string;
    influenceType: string;
  }> = [];

  for (const item of queueItems) {
    if (!actor.character) {
      return {
        error: "A character is required to use party influence.",
        status: 400,
      } as const;
    }

    const result = await executeNationalPartyInfluence({
      partyId,
      partyObjectId: party._id,
      countryId: party.countryId,
      nppId: new ObjectId(item.nppId),
      influenceType: item.influenceType,
      fundAmount: Math.max(0, Math.floor(item.fundAmount || 0)),
      actorCharacterId: actor.character._id,
      context: item.context || {},
    });

    results.push({
      success: result.success,
      outcome: result.outcome,
      message: result.error ? result.error : result.message,
      nppId: item.nppId,
      influenceType: item.influenceType,
    });

    if (result.error) {
      results[results.length - 1].success = false;
      results[results.length - 1].outcome = "error";
      break;
    }
  }

  const updatedParty = await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ _id: party._id });

  return {
    results,
    party: updatedParty
      ? {
          politicalStrength: updatedParty.politicalStrength || 0,
          treasury: updatedParty.treasury,
        }
      : null,
  } as const;
}
