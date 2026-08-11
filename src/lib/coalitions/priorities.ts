import type { Bill } from "@/lib/db/types/legislation";
import type {
  Coalition,
  CoalitionLeadershipGoalKey,
  CoalitionPriority,
  CoalitionPriorityPartyVote,
  CoalitionPriorityStatus,
  CoalitionPriorityVoteEntry,
} from "@/lib/db/types/coalition";

export const MAX_ACTIVE_COALITION_PRIORITIES = 3;

export const COALITION_POLICY_THEME_OPTIONS = [
  { key: "economic_growth", label: "Economic Growth" },
  { key: "tax_relief", label: "Tax Relief" },
  { key: "labor_rights", label: "Labor Rights" },
  { key: "public_services", label: "Public Services" },
  { key: "immigration", label: "Immigration" },
  { key: "defense", label: "Defense" },
  { key: "climate", label: "Climate" },
  { key: "civil_liberties", label: "Civil Liberties" },
  { key: "industrial_policy", label: "Industrial Policy" },
  { key: "anti_corruption", label: "Anti-Corruption" },
] as const;

export const COALITION_LEADERSHIP_GOAL_OPTIONS: ReadonlyArray<{
  key: CoalitionLeadershipGoalKey;
  label: string;
}> = [
  { key: "speaker", label: "Speaker / Presiding Officer" },
  { key: "lower_chamber_leadership", label: "Lower Chamber Leadership" },
  { key: "upper_chamber_leadership", label: "Upper Chamber Leadership" },
  { key: "government_formation", label: "Government Formation" },
  { key: "cabinet_formation", label: "Cabinet Formation" },
  { key: "no_confidence", label: "No-Confidence Strategy" },
];

const LIVE_BILL_STATUSES = new Set<Bill["status"]>([
  "active",
  "active_other",
  "veto_override",
  "override_shugiin",
  "filibustered",
  "cabinet_review",
]);

export interface CoalitionPriorityTally {
  support: number;
  oppose: number;
  abstain: number;
  requiredToPass: number;
}

export interface CoalitionCohesionSummary {
  score: number;
  label: "Strong" | "Mixed" | "Fractured" | "Unaligned";
  activePriorityCount: number;
  supportVotes: number;
  opposeVotes: number;
  abstainVotes: number;
}

function cloneVote(vote: CoalitionPriorityVoteEntry): CoalitionPriorityVoteEntry {
  return {
    ...vote,
    partyId: vote.partyId,
    chairCharacterId: vote.chairCharacterId,
    votedAt: new Date(vote.votedAt),
  };
}

export function clonePriority(priority: CoalitionPriority): CoalitionPriority {
  return {
    ...priority,
    billId: priority.billId ?? null,
    billTitle: priority.billTitle ?? null,
    leadershipGoalKey: priority.leadershipGoalKey ?? null,
    targetName: priority.targetName ?? null,
    expiresAt: priority.expiresAt ? new Date(priority.expiresAt) : null,
    expiresOnTurn: priority.expiresOnTurn ?? null,
    createdAt: new Date(priority.createdAt),
    updatedAt: new Date(priority.updatedAt),
    activatedAt: priority.activatedAt ? new Date(priority.activatedAt) : null,
    resolvedAt: priority.resolvedAt ? new Date(priority.resolvedAt) : null,
    resolvedBy: priority.resolvedBy ?? null,
    votes: priority.votes.map(cloneVote),
  };
}

export function getPriorityVoteTally(
  priority: Pick<CoalitionPriority, "votes">,
  memberPartyCount: number
): CoalitionPriorityTally {
  const support = priority.votes.filter((vote) => vote.vote === "support").length;
  const oppose = priority.votes.filter((vote) => vote.vote === "oppose").length;
  const abstain = priority.votes.filter((vote) => vote.vote === "abstain").length;
  return {
    support,
    oppose,
    abstain,
    requiredToPass: Math.floor(memberPartyCount / 2) + 1,
  };
}

export function shouldActivatePriority(priority: CoalitionPriority, memberPartyCount: number) {
  return (
    priority.status === "proposed" &&
    getPriorityVoteTally(priority, memberPartyCount).support >= Math.floor(memberPartyCount / 2) + 1
  );
}

export function shouldRejectPriority(priority: CoalitionPriority, memberPartyCount: number) {
  return (
    priority.status === "proposed" &&
    getPriorityVoteTally(priority, memberPartyCount).oppose >= Math.floor(memberPartyCount / 2) + 1
  );
}

export function isBillPriorityExpired(priority: CoalitionPriority, bill: Bill | null | undefined) {
  if (priority.type !== "bill") return false;
  return !bill || !LIVE_BILL_STATUSES.has(bill.status);
}

/**
 * Check whether a leadership-goal priority has expired. Prefer the game-clock
 * turn deadline; fall back to the date for legacy priorities that pre-date
 * the turn-number migration.
 */
export function isLeadershipPriorityExpired(
  priority: CoalitionPriority,
  now: Date,
  currentTurn?: number
) {
  if (priority.type !== "leadership_goal") return false;
  if (typeof priority.expiresOnTurn === "number" && typeof currentTurn === "number") {
    return currentTurn >= priority.expiresOnTurn;
  }
  return !!priority.expiresAt && priority.expiresAt.getTime() <= now.getTime();
}

export function isPriorityExpired(
  priority: CoalitionPriority,
  billsById: Map<string, Bill>,
  now: Date,
  currentTurn?: number
) {
  return (
    isBillPriorityExpired(
      priority,
      priority.billId ? billsById.get(priority.billId.toString()) : null
    ) || isLeadershipPriorityExpired(priority, now, currentTurn)
  );
}

export function normalizeCoalitionPriorities(
  coalition: Pick<Coalition, "priorities">,
  billsById: Map<string, Bill>,
  now: Date,
  currentTurn?: number
) {
  const priorities = (coalition.priorities ?? []).map(clonePriority);
  let changed = false;

  for (const priority of priorities) {
    if (
      (priority.status === "proposed" || priority.status === "active") &&
      isPriorityExpired(priority, billsById, now, currentTurn)
    ) {
      priority.status = "expired";
      priority.resolvedAt = new Date(now);
      priority.updatedAt = new Date(now);
      changed = true;
    }
  }

  return { priorities, changed };
}

export function calculateCoalitionCohesion(
  priorities: CoalitionPriority[],
  memberPartyCount: number
): CoalitionCohesionSummary {
  const active = priorities.filter((priority) => priority.status === "active");
  if (active.length === 0 || memberPartyCount <= 0) {
    return {
      score: 0,
      label: "Unaligned",
      activePriorityCount: active.length,
      supportVotes: 0,
      opposeVotes: 0,
      abstainVotes: 0,
    };
  }

  let supportVotes = 0;
  let opposeVotes = 0;
  let abstainVotes = 0;
  let normalizedScore = 0;

  for (const priority of active) {
    const tally = getPriorityVoteTally(priority, memberPartyCount);
    supportVotes += tally.support;
    opposeVotes += tally.oppose;
    abstainVotes += tally.abstain;
    normalizedScore += (tally.support - tally.oppose + memberPartyCount) / (2 * memberPartyCount);
  }

  const score = Math.round((normalizedScore / active.length) * 100);
  const label: CoalitionCohesionSummary["label"] =
    score >= 70 ? "Strong" : score >= 45 ? "Mixed" : "Fractured";

  return {
    score,
    label,
    activePriorityCount: active.length,
    supportVotes,
    opposeVotes,
    abstainVotes,
  };
}

export function getCoalitionPriorityLabel(status: CoalitionPriorityStatus) {
  switch (status) {
    case "active":
      return "Active";
    case "proposed":
      return "Proposed";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "archived":
    default:
      return "Archived";
  }
}

export function getPriorityVoteForParty(
  priority: CoalitionPriority,
  partyObjectId: string
): CoalitionPriorityPartyVote | null {
  const vote = priority.votes.find((entry) => entry.partyId.toString() === partyObjectId);
  return vote?.vote ?? null;
}

export function upsertCoalitionPriorityVote(
  votes: CoalitionPriorityVoteEntry[],
  nextVote: CoalitionPriorityVoteEntry
) {
  const nextVotes = votes.map(cloneVote);
  const existingIndex = nextVotes.findIndex(
    (vote) => vote.partyId.toString() === nextVote.partyId.toString()
  );
  if (existingIndex >= 0) {
    nextVotes[existingIndex] = cloneVote(nextVote);
  } else {
    nextVotes.push(cloneVote(nextVote));
  }
  return nextVotes;
}
