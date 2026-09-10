/**
 * Campaign-room briefing builders — pure, READ-ONLY composers.
 *
 * Every function here reads data the election engine / vote tally already
 * produced and folds it into the `CampaignBriefing` DTO shape. None of them
 * recompute vote math: the delegate counts, per-unit vote totals, and factor
 * ledger are all stored on the tally, and this module only aggregates and
 * ranks them. Server-only (imports the EV allocator, which pulls in Node
 * `crypto` for deterministic tie-breaks) — the client consumes the DTO types
 * from `campaignView.ts`, never these builders.
 */

import type {
  BriefingCoalitionBucket,
  BriefingDelegatePath,
  BriefingTippingPath,
  CampaignBriefing,
} from "@/lib/campaigns/dto/campaignView";
import type { CandidateNationalLedger } from "@/lib/electionEngine/factorLedger";
import { buildGeneralElectionViewModel } from "@/lib/elections/generalViewModel";
import { allocateElectoralVotes } from "@/lib/turn/electionCalculations";
import { electoralMajorityFor } from "@/lib/elections/presidentialResolutionDisplay";
import type { ElectoralVoteUnit } from "@/lib/constants/states";

const DEFAULT_TOP_BUCKETS = 5;
const DEFAULT_TOP_LEADERS = 5;
const DEFAULT_TOP_TIPPING = 5;

/**
 * The census buckets the owner is losing, worst first.
 *
 * Ranked on the owner's share of each bucket across the whole field, not on the
 * bucket's share of the owner's own appeal. Those are different questions, and
 * the second one is not the one the card asks: `appealShare` is normalised per
 * candidate, so a small demographic always sits near the bottom even when the
 * owner is dominating it, and a large one sits near the top even when the owner
 * is being beaten there.
 *
 * A candidate's absolute pull in a bucket is their share of their own appeal
 * scaled by the votes that appeal actually won them, so the field's totals per
 * bucket come from the same ledger without any new engine work.
 */
export function buildCoalitionWeakness(
  field: CandidateNationalLedger[] | undefined,
  ownerTallyId: string | null,
  topN: number = DEFAULT_TOP_BUCKETS
): BriefingCoalitionBucket[] {
  if (!field || field.length === 0 || !ownerTallyId) return [];
  const owner = field.find((c) => c.candidateId === ownerTallyId);
  if (!owner?.bucketAppeal || owner.bucketAppeal.length === 0) return [];

  // The field's total pull per bucket, owner included.
  const fieldByBucket = new Map<string, number>();
  for (const candidate of field) {
    for (const b of candidate.bucketAppeal ?? []) {
      fieldByBucket.set(
        b.bucket,
        (fieldByBucket.get(b.bucket) ?? 0) + b.appealShare * candidate.finalVotes
      );
    }
  }

  return owner.bucketAppeal
    .map((b) => {
      const total = fieldByBucket.get(b.bucket) ?? 0;
      return {
        bucket: b.bucket,
        appealShare: b.appealShare,
        // An uncontested bucket reads as fully held rather than as a divide by
        // zero, which is what a one-candidate race genuinely is.
        bucketShare: total > 0 ? (b.appealShare * owner.finalVotes) / total : 1,
        demoEP: b.demoEP,
        demoSP: b.demoSP,
      };
    })
    .sort((a, b) => a.bucketShare - b.bucketShare)
    .slice(0, topN);
}

/**
 * Treasury runway. When the campaign is not burning (net income >= 0) the
 * runway is unbounded, reported as `null` rather than a misleading large number.
 */
export function buildCashRunway(funds: number, netPerTurn: number): CampaignBriefing["cashRunway"] {
  const turnsOfRunway = netPerTurn < 0 ? Math.floor(funds / -netPerTurn) : null;
  return { funds, netPerTurn, turnsOfRunway };
}

/**
 * Presidential-primary delegate path. Reads the stored per-party delegate map
 * (candidateId -> delegates) for the owner's party plus the majority threshold
 * the delegate helpers computed; nothing is recomputed.
 */
export function buildDelegatePath(
  partyDelegates: Record<string, number> | undefined,
  ownerTallyId: string | null,
  needed: number,
  candidateNames: Record<string, string>,
  topN: number = DEFAULT_TOP_LEADERS
): BriefingDelegatePath {
  const won = (ownerTallyId ? partyDelegates?.[ownerTallyId] : 0) ?? 0;
  const remaining = Math.max(0, needed - won);
  const leaders = Object.entries(partyDelegates ?? {})
    .map(([candidateId, delegates]) => ({
      candidateId,
      name: candidateNames[candidateId] ?? "Unknown",
      delegates,
    }))
    .sort((a, b) => b.delegates - a.delegates)
    .slice(0, topN);
  return { kind: "delegate", won, needed, remaining, leaders };
}

/**
 * Presidential-general tipping path. Aggregates the tally's per-unit vote
 * totals to the state level, then reuses the general-election view model to
 * pick the closest states, and the EV allocator for the owner's current EV
 * standing. Colours / names on the view-model candidates are irrelevant here
 * (we consume only margins + the five-closest list), so they are stubbed.
 */
export function buildTippingPath(input: {
  totalVotesByUnit: Record<string, Record<string, number>>;
  evUnits: ElectoralVoteUnit[];
  ownerTallyId: string | null;
  candidateIds: string[];
  stateNameById: Record<string, string>;
  topN?: number;
}): BriefingTippingPath {
  const { totalVotesByUnit, evUnits, ownerTallyId, candidateIds, stateNameById } = input;
  const topN = input.topN ?? DEFAULT_TOP_TIPPING;

  // Fold per-unit votes up to the state level (sums ME/NE district splits).
  const stateVoteData: Record<string, Record<string, number>> = {};
  for (const unit of evUnits) {
    const unitVotes = totalVotesByUnit[unit.unitId];
    if (!unitVotes) continue;
    const stateVotes = stateVoteData[unit.stateId] ?? (stateVoteData[unit.stateId] = {});
    for (const [candidateId, votes] of Object.entries(unitVotes)) {
      if (votes > 0) stateVotes[candidateId] = (stateVotes[candidateId] ?? 0) + votes;
    }
  }

  const vm = buildGeneralElectionViewModel({
    candidates: candidateIds.map((id) => ({ id, name: "", color: "#000000", partyAbbr: "" })),
    stateVoteData,
    stateNameById,
  });

  const evByCandidate = allocateElectoralVotes(totalVotesByUnit, evUnits);
  const evHave = ownerTallyId ? (evByCandidate[ownerTallyId] ?? 0) : 0;
  const totalEv = evUnits.reduce((sum, u) => sum + u.ev, 0);
  const evNeeded = electoralMajorityFor(totalEv);

  const tippingStates = vm.fiveClosestStates.slice(0, topN).map((stateId) => ({
    stateId,
    name: stateNameById[stateId] ?? stateId,
    marginPp: vm.marginByState[stateId]?.margin ?? 0,
  }));

  return { kind: "tipping", evHave, evNeeded, tippingStates };
}
