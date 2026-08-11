import { ObjectId, type Db } from "mongodb";
import type { AuthUserWithCharacter } from "@/lib/auth";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import type { PoliticalParty } from "@/lib/db/types/party";
import type { Character } from "@/lib/db/types/character";
import type { Bill } from "@/lib/db/types/legislation";
import type { Coalition, CoalitionPriority } from "@/lib/db/types/coalition";
import type { CoalitionPrioritiesPayload } from "@/lib/coalitions/types";
import {
  calculateCoalitionCohesion,
  COALITION_LEADERSHIP_GOAL_OPTIONS,
  COALITION_POLICY_THEME_OPTIONS,
  getPriorityVoteTally,
  normalizeCoalitionPriorities,
} from "./priorities";

const LIVE_PRIORITY_BILL_STATUSES: ReadonlySet<Bill["status"]> = new Set([
  "active",
  "active_other",
  "veto_override",
  "filibustered",
  "cabinet_review",
]);

export interface CoalitionPriorityViewer {
  isAdmin: boolean;
  isCoalitionChair: boolean;
  isMemberParty: boolean;
  isMemberPartyChair: boolean;
  canPropose: boolean;
  canVote: boolean;
  canViewInternal: boolean;
  partySequentialId: number | null;
  partyObjectId: string | null;
  characterObjectId: string | null;
}

export interface CoalitionPriorityContext {
  coalition: Coalition;
  memberParties: PoliticalParty[];
  partiesByObjectId: Map<string, PoliticalParty>;
  characterNamesById: Map<string, string>;
  liveBills: Bill[];
  billsById: Map<string, Bill>;
}

export function parseCoalitionCountry(code: string): CountryId | null {
  const countryId = code.toUpperCase() as CountryId;
  return COUNTRY_CONFIGS[countryId] ? countryId : null;
}

export async function loadCoalitionPriorityContext(
  db: Db,
  countryId: CountryId,
  sequentialId: number
): Promise<CoalitionPriorityContext | null> {
  const coalition = await db
    .collection<Coalition>("coalitions")
    .findOne({ countryId, sequentialId });
  if (!coalition) return null;

  const memberPartyObjectIds = coalition.members.map((member) => member.partyId);
  const memberParties = memberPartyObjectIds.length
    ? await db
        .collection<PoliticalParty>("politicalParties")
        .find({ _id: { $in: memberPartyObjectIds }, countryId })
        .toArray()
    : [];

  const characterIds = new Set<string>();
  if (coalition.chairCharacterId) characterIds.add(coalition.chairCharacterId.toString());
  for (const party of memberParties) {
    if (party.chairId) {
      characterIds.add(party.chairId.toString());
    }
  }
  for (const priority of coalition.priorities ?? []) {
    characterIds.add(priority.createdBy.toString());
    if (priority.resolvedBy) {
      characterIds.add(priority.resolvedBy.toString());
    }
    for (const vote of priority.votes) {
      characterIds.add(vote.chairCharacterId.toString());
    }
  }

  const characters = characterIds.size
    ? await db
        .collection<Character>("characters")
        .find(
          { _id: { $in: [...characterIds].map((id) => new ObjectId(id)) } },
          { projection: { _id: 1, name: 1 } }
        )
        .toArray()
    : [];

  const liveBills = await db
    .collection<Bill>("legislation")
    .find(
      { countryId, status: { $in: [...LIVE_PRIORITY_BILL_STATUSES] } },
      {
        projection: {
          _id: 1,
          title: 1,
          currentChamber: 1,
          status: 1,
          votingEndsAt: 1,
          otherChamberVotingEndsAt: 1,
          overrideVotingEndsAt: 1,
        },
      }
    )
    .toArray();

  return {
    coalition,
    memberParties,
    partiesByObjectId: new Map(memberParties.map((party) => [party._id.toString(), party])),
    characterNamesById: new Map(
      characters.map((character) => [character._id.toString(), character.name])
    ),
    liveBills,
    billsById: new Map(liveBills.map((bill) => [bill._id.toString(), bill])),
  };
}

export function resolveCoalitionPriorityViewer(
  viewer: AuthUserWithCharacter | null,
  context: CoalitionPriorityContext
): CoalitionPriorityViewer {
  const partySequentialId = viewer?.character?.party ? Number(viewer.character.party) : null;
  const memberParty =
    partySequentialId === null
      ? null
      : (context.memberParties.find((party) => party.sequentialId === partySequentialId) ?? null);
  const partyObjectId = memberParty?._id.toString() ?? null;
  const characterObjectId = viewer?.character?._id?.toString() ?? null;
  const isCoalitionChair =
    !!characterObjectId && characterObjectId === context.coalition.chairCharacterId?.toString();
  const isMemberParty = !!memberParty;
  const isMemberPartyChair =
    !!characterObjectId &&
    !!memberParty?.chairId &&
    memberParty.chairId.toString() === characterObjectId;
  const isAdmin = viewer?.isAdmin === true;

  return {
    isAdmin,
    isCoalitionChair,
    isMemberParty,
    isMemberPartyChair,
    canPropose: isCoalitionChair,
    canVote: isMemberPartyChair,
    canViewInternal: isAdmin || isMemberParty,
    partySequentialId,
    partyObjectId,
    characterObjectId,
  };
}

function getPolicyThemeLabel(key: string | null | undefined) {
  return COALITION_POLICY_THEME_OPTIONS.find((option) => option.key === key)?.label ?? null;
}

function getLeadershipGoalLabel(key: string | null | undefined) {
  return COALITION_LEADERSHIP_GOAL_OPTIONS.find((option) => option.key === key)?.label ?? null;
}

export function buildCoalitionPriorityPayload(
  context: CoalitionPriorityContext,
  viewer: CoalitionPriorityViewer,
  now: Date,
  currentTurn?: number
): {
  payload: CoalitionPrioritiesPayload;
  normalizedPriorities: CoalitionPriority[];
  changed: boolean;
} {
  const { priorities: normalizedPriorities, changed } = normalizeCoalitionPriorities(
    context.coalition,
    context.billsById,
    now,
    currentTurn
  );

  const visiblePriorities = normalizedPriorities.filter(
    (priority) => viewer.canViewInternal || priority.visibility === "public"
  );

  const cohesion = calculateCoalitionCohesion(visiblePriorities, context.memberParties.length);

  const serializePriority = (priority: CoalitionPriority) => {
    const tally = getPriorityVoteTally(priority, context.memberParties.length);
    const partyStances = context.memberParties.map((party) => {
      const vote = priority.votes.find(
        (entry) => entry.partyId.toString() === party._id.toString()
      );
      return {
        partyId: party.sequentialId,
        partyObjectId: party._id.toString(),
        partyName: party.name,
        abbreviation: party.abbreviation,
        color: party.color,
        chairName: party.chairId
          ? (context.characterNamesById.get(party.chairId.toString()) ?? null)
          : null,
        vote: vote?.vote ?? null,
        votedAt: vote?.votedAt?.toISOString() ?? null,
      };
    });

    return {
      id: priority.id,
      type: priority.type,
      visibility: priority.visibility,
      status: priority.status,
      stance: priority.stance,
      title: priority.title,
      description: priority.description,
      policyThemeKey: priority.policyThemeKey ?? null,
      policyThemeLabel: getPolicyThemeLabel(priority.policyThemeKey),
      billId: priority.billId?.toString() ?? null,
      billTitle: priority.billTitle ?? null,
      leadershipGoalKey: priority.leadershipGoalKey ?? null,
      leadershipGoalLabel: getLeadershipGoalLabel(priority.leadershipGoalKey),
      targetName: priority.targetName ?? null,
      expiresAt: priority.expiresAt?.toISOString() ?? null,
      createdAt: priority.createdAt.toISOString(),
      updatedAt: priority.updatedAt.toISOString(),
      activatedAt: priority.activatedAt?.toISOString() ?? null,
      resolvedAt: priority.resolvedAt?.toISOString() ?? null,
      createdByName: context.characterNamesById.get(priority.createdBy.toString()) ?? null,
      tally,
      partyStances,
    };
  };

  const active = visiblePriorities
    .filter((priority) => priority.status === "active")
    .map(serializePriority);
  const proposed = visiblePriorities
    .filter((priority) => priority.status === "proposed")
    .map(serializePriority);
  const archived = visiblePriorities
    .filter((priority) => priority.status !== "active" && priority.status !== "proposed")
    .sort((left, right) => (right.resolvedAt?.getTime() ?? 0) - (left.resolvedAt?.getTime() ?? 0))
    .slice(0, 8)
    .map(serializePriority);

  return {
    payload: {
      cohesion,
      viewer: {
        isAdmin: viewer.isAdmin,
        isCoalitionChair: viewer.isCoalitionChair,
        isMemberParty: viewer.isMemberParty,
        isMemberPartyChair: viewer.isMemberPartyChair,
        canPropose: viewer.canPropose,
        canVote: viewer.canVote,
        canViewInternal: viewer.canViewInternal,
        partySequentialId: viewer.partySequentialId,
      },
      priorities: {
        active,
        proposed,
        archived,
      },
      options: {
        policyThemes: COALITION_POLICY_THEME_OPTIONS.map((option) => ({
          key: option.key,
          label: option.label,
        })),
        leadershipGoals: COALITION_LEADERSHIP_GOAL_OPTIONS.map((option) => ({
          key: option.key,
          label: option.label,
        })),
        bills: viewer.canPropose
          ? context.liveBills.map((bill) => ({
              id: bill._id.toString(),
              title: bill.title,
              chamber: bill.currentChamber,
              status: bill.status,
            }))
          : [],
      },
    },
    normalizedPriorities,
    changed,
  };
}
