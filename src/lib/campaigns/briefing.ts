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
  CampaignUpgrade,
  OpsTreeView,
} from "@/lib/campaigns/dto/campaignView";
import type { UpgradeCategory } from "@/lib/campaigns/upgradeCosts";
import type { CandidateBucketAppeal } from "@/lib/electionEngine/factorLedger";
import { buildGeneralElectionViewModel } from "@/lib/elections/generalViewModel";
import { allocateElectoralVotes } from "@/lib/turn/electionCalculations";
import { electoralMajorityFor } from "@/lib/elections/presidentialResolutionDisplay";
import type { ElectoralVoteUnit } from "@/lib/constants/states";

const DEFAULT_TOP_BUCKETS = 5;
const DEFAULT_TOP_LEADERS = 5;
const DEFAULT_TOP_TIPPING = 5;

/**
 * The owner candidate's weakest census buckets, weakest first. The ledger sorts
 * bucketAppeal strongest-first; we re-sort ascending on appeal share so the
 * card leads with the coalitions the campaign is under-performing.
 */
export function buildCoalitionWeakness(
  bucketAppeal: CandidateBucketAppeal[] | undefined,
  topN: number = DEFAULT_TOP_BUCKETS
): BriefingCoalitionBucket[] {
  if (!bucketAppeal || bucketAppeal.length === 0) return [];
  return [...bucketAppeal]
    .sort((a, b) => a.appealShare - b.appealShare)
    .slice(0, topN)
    .map((b) => ({
      bucket: b.bucket,
      appealShare: b.appealShare,
      demoEP: b.demoEP,
      demoSP: b.demoSP,
    }));
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
 * Per-lever operations saturation: summed invested branch levels against the
 * lever's max (branch count × per-branch cap). Reads the already-built ops-tree
 * view so it matches exactly what the ops modal renders.
 */
export function buildOpsSaturation(
  opsTrees: Record<UpgradeCategory, OpsTreeView>
): CampaignBriefing["opsSaturation"] {
  return (Object.entries(opsTrees) as [UpgradeCategory, OpsTreeView][]).map(([category, tree]) => {
    let level = 0;
    let max = 0;
    for (const branch of tree.branches) {
      level += branch.level;
      max += branch.maxLevel;
    }
    return { category, level, max };
  });
}

/**
 * Action tradeoffs, composed from the already-localized next-upgrade costs. A
 * maxed lever (null cost) is skipped — there is no next tier to weigh.
 */
export function buildTradeoffs(
  sources: { key: string; label: string; cost: CampaignUpgrade | null }[]
): CampaignBriefing["tradeoffs"] {
  const out: CampaignBriefing["tradeoffs"] = [];
  for (const { key, label, cost } of sources) {
    if (!cost) continue;
    out.push({
      actionId: key,
      label,
      cost: { funds: cost.funds, actions: cost.actions },
      expectedEffect: cost.effect,
    });
  }
  return out;
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
