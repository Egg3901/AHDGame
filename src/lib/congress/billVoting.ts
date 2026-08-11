import { getPartyHex } from "@/lib/utils/politics";
import type { ElectedOfficial, PoliticalParty } from "@/lib/db/types";

export interface VoteByParty {
  party: string;
  partyName: string;
  partyColor: string;
  for: number;
  against: number;
  abstain: number;
  total: number;
}

export type BillVoteValue = "for" | "against" | "abstain";

export interface ScopedVoteInputs {
  votes: Record<string, BillVoteValue> | undefined;
  weightMap: Map<string, number>;
}

export type ScopedVoteOfficial = Pick<
  ElectedOfficial,
  "characterId" | "countryId" | "nppId" | "officeType" | "seatsHeld"
>;

function officialCountryId(official: Pick<ElectedOfficial, "countryId">): string {
  return official.countryId ?? "US";
}

function voteKeyForOfficial(
  official: Pick<ElectedOfficial, "characterId" | "nppId">
): string | null {
  if (official.nppId) return `npp_${official.nppId.toString()}`;
  return official.characterId?.toString() ?? null;
}

/**
 * Filters a bill vote map down to voters who currently hold the chamber seat
 * being tallied, and builds the matching seat-weight map. This prevents stale
 * or cross-country embedded vote keys from corrupting displayed chamber totals.
 */
export function buildScopedVoteInputs(
  votes: Record<string, BillVoteValue> | undefined,
  officials: ScopedVoteOfficial[],
  scope: { countryId: string; officeType: string } | null
): ScopedVoteInputs {
  if (!scope) {
    return { votes, weightMap: new Map() };
  }

  const validWeights = new Map<string, number>();
  for (const official of officials) {
    if (
      officialCountryId(official) !== scope.countryId ||
      official.officeType !== scope.officeType
    ) {
      continue;
    }
    const voteKey = voteKeyForOfficial(official);
    if (!voteKey) continue;
    validWeights.set(voteKey, (validWeights.get(voteKey) ?? 0) + (official.seatsHeld ?? 1));
  }

  if (!votes) {
    return { votes, weightMap: validWeights };
  }

  const scopedVotes = Object.fromEntries(
    Object.entries(votes).filter(([voteKey]) => validWeights.has(voteKey))
  ) as Record<string, BillVoteValue>;

  return { votes: scopedVotes, weightMap: validWeights };
}

/**
 * Tallies votes by party affiliation and returns sorted results.
 * Used for displaying vote breakdowns in the UI.
 *
 * @param weightMap - Optional map of voterId → seat weight. When provided,
 *   each vote is counted by its weight (matching the aggregate totals).
 *   When omitted, each vote counts as 1.
 */
export function buildVotesByParty(
  votes: Record<string, BillVoteValue> | undefined,
  voterPartyMap: Map<string, string>,
  partyMap: Map<string, PoliticalParty>,
  weightMap?: Map<string, number>
): VoteByParty[] {
  const tally = new Map<string, { for: number; against: number; abstain: number }>();

  if (votes) {
    for (const [voterId, vote] of Object.entries(votes)) {
      const party = voterPartyMap.get(voterId) ?? "independent";
      const weight = weightMap?.get(voterId) ?? 1;
      const t = tally.get(party) ?? { for: 0, against: 0, abstain: 0 };
      if (vote === "for") t.for += weight;
      else if (vote === "against") t.against += weight;
      else t.abstain += weight;
      tally.set(party, t);
    }
  }

  return [...tally.entries()]
    .map(([partySlug, v]) => {
      const p = partyMap.get(partySlug);
      return {
        party: partySlug,
        partyName: p?.name ?? (partySlug === "independent" ? "Independent" : partySlug),
        partyColor: getPartyHex(partySlug, p?.color),
        for: v.for,
        against: v.against,
        abstain: v.abstain,
        total: v.for + v.against + v.abstain,
      };
    })
    .sort((a, b) => b.total - a.total);
}
