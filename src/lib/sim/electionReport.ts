/**
 * Election-balance report for the headless worldsim (elections-only runs).
 *
 * Reads the sandbox `elections` + `electionVoteTallies` and produces, per
 * election, the VOTE-OVER-TIME trajectory (from each tally's turnSnapshots) plus
 * the margin / lead-change / closing-surge signals, and an aggregate balance
 * roll-up (margin distribution, dynamism, per-country + per-electionType). This
 * is what the worldsim MCP's `sim_election_report` surfaces.
 *
 * Pure read model over a Db — no writes, so it's unit-testable with a MockDb and
 * reusable by both the collector script and any ad-hoc analysis.
 */
import type { Db } from "mongodb";
import type { Election } from "@/lib/db/types/election";
import type { ElectionVoteTally, VoteTurnSnapshot } from "@/lib/db/types/voteTally";
import type { GameState } from "@/lib/db/types/gameState";

export interface ElectionTrajectoryPoint {
  turn: number;
  /** candidateId -> share % (0-100) at this turn. */
  sharesPct: Record<string, number>;
}

export interface ElectionSummary {
  electionId: string;
  countryId: string;
  electionType: string;
  state?: string;
  status: string;
  candidateCount: number;
  winnerId?: string;
  winnerName?: string;
  winnerParty?: string;
  winnerSharePct?: number;
  /** Final winner share minus runner-up share (competitiveness — small = close). */
  marginPct?: number;
  /** How many times the leader changed across the accumulation turns (dynamism). */
  leadChanges: number;
  /** Signed change in the winner's share over the final 4 turns (closing surge). */
  winnerClosingDeltaPct?: number;
  /** Downsampled vote-over-time trajectory. */
  trajectory: ElectionTrajectoryPoint[];
}

interface GroupStat {
  elections: number;
  resolved: number;
  contested: number;
  marginSum: number;
  marginCount: number;
}

export interface ElectionBalanceReport {
  turn: number;
  scope: string[] | null;
  emptyCandidateSupplyCountries: string[];
  totals: {
    elections: number;
    withTally: number;
    resolved: number;
    contested: number;
    contestedPct: number;
  };
  /** Margin-of-victory distribution over resolved, contested races (percentage points). */
  margin: { mean: number; median: number; p10: number; p90: number } | null;
  dynamism: { meanLeadChanges: number; meanWinnerClosingDeltaPct: number };
  byCountry: Record<
    string,
    { elections: number; resolved: number; contestedPct: number; meanMarginPct: number | null }
  >;
  byElectionType: Record<
    string,
    { elections: number; resolved: number; contestedPct: number; meanMarginPct: number | null }
  >;
  elections: ElectionSummary[];
  collectedAt: Date;
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const out: T[] = [];
  for (let i = 0; i < maxPoints; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function leaderOf(snap: VoteTurnSnapshot): string | null {
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const [cid, votes] of Object.entries(snap.cumulativeVotes ?? {})) {
    if (votes > bestVal) {
      bestVal = votes;
      best = cid;
    }
  }
  return bestVal > 0 ? best : null;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

export async function collectElectionReport(
  db: Db,
  opts: { maxTrajectoryPoints?: number; scope?: string[] | null } = {}
): Promise<ElectionBalanceReport> {
  const maxTrajectoryPoints = opts.maxTrajectoryPoints ?? 60;

  const gameState = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  const turn = gameState?.currentTurn ?? 0;

  // Prefer the scope recorded on the run doc; fall back to the caller's opt.
  const runDoc = await db
    .collection<{
      electionScope?: string[] | null;
      emptyCandidateSupplyCountries?: string[];
    }>("simRuns")
    .findOne({}, { projection: { electionScope: 1, emptyCandidateSupplyCountries: 1 } });
  const scope = runDoc?.electionScope ?? opts.scope ?? null;
  const scopeSet = scope ? new Set(scope) : null;
  const emptyCandidateSupplyCountries = runDoc?.emptyCandidateSupplyCountries ?? [];

  const elections = await db
    .collection<Election>("elections")
    .find({}, { projection: { countryId: 1, electionType: 1, state: 1, status: 1 } })
    .toArray();
  const scoped = scopeSet ? elections.filter((e) => scopeSet.has(e.countryId)) : elections;

  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: scoped.map((e) => e._id) } })
    .toArray();
  const tallyByElection = new Map(tallies.map((t) => [t.electionId.toString(), t]));

  const summaries: ElectionSummary[] = [];
  const margins: number[] = [];
  const leadChangeList: number[] = [];
  const closingDeltas: number[] = [];
  const byCountry: Record<string, GroupStat> = {};
  const byElectionType: Record<string, GroupStat> = {};

  const bump = (map: Record<string, GroupStat>, key: string): GroupStat =>
    (map[key] ??= { elections: 0, resolved: 0, contested: 0, marginSum: 0, marginCount: 0 });

  let withTally = 0;
  let contestedTotal = 0;
  let resolvedTotal = 0;

  for (const e of scoped) {
    const tally = tallyByElection.get(e._id.toString());
    const isResolved = e.status === "resolved";
    if (isResolved) resolvedTotal++;

    const cStat = bump(byCountry, e.countryId);
    const tStat = bump(byElectionType, String(e.electionType));
    cStat.elections++;
    tStat.elections++;
    if (isResolved) {
      cStat.resolved++;
      tStat.resolved++;
    }

    if (!tally) {
      // No tally (e.g. primary-only, upcoming, or empty supply). Still counted.
      summaries.push({
        electionId: e._id.toString(),
        countryId: e.countryId,
        electionType: String(e.electionType),
        state: e.state,
        status: e.status,
        candidateCount: 0,
        leadChanges: 0,
        trajectory: [],
      });
      continue;
    }
    withTally++;

    const candidateIds = Object.keys(tally.totalVotes ?? {});
    const contested = candidateIds.length > 1;
    if (contested) {
      contestedTotal++;
      cStat.contested++;
      tStat.contested++;
    }

    // Final shares: last snapshot if present, else derive from totalVotes.
    const snaps = (tally.turnSnapshots ?? []).filter((s) => s && s.sharesPct);
    const lastSnap = snaps[snaps.length - 1];
    const finalShares: Record<string, number> =
      lastSnap?.sharesPct ??
      (() => {
        const total = Object.values(tally.totalVotes ?? {}).reduce((a, b) => a + b, 0);
        const out: Record<string, number> = {};
        if (total > 0)
          for (const [cid, v] of Object.entries(tally.totalVotes)) out[cid] = (v / total) * 100;
        return out;
      })();

    const ranked = Object.entries(finalShares).sort((a, b) => b[1] - a[1]);
    const winnerId = ranked[0]?.[0];
    const winnerSharePct = ranked[0]?.[1];
    const runnerUpSharePct = ranked[1]?.[1] ?? 0;
    const marginPct = winnerSharePct !== undefined ? winnerSharePct - runnerUpSharePct : undefined;
    if (isResolved && contested && marginPct !== undefined) {
      margins.push(marginPct);
      cStat.marginSum += marginPct;
      cStat.marginCount++;
      tStat.marginSum += marginPct;
      tStat.marginCount++;
    }

    // Lead changes across accumulation turns.
    let leadChanges = 0;
    let prevLeader: string | null = null;
    for (const s of snaps) {
      const leader = leaderOf(s);
      if (leader && prevLeader && leader !== prevLeader) leadChanges++;
      if (leader) prevLeader = leader;
    }
    leadChangeList.push(leadChanges);

    // Closing surge: winner's share shift over the final 4 turns.
    let winnerClosingDeltaPct: number | undefined;
    if (winnerId && snaps.length >= 2) {
      const lastShare = snaps[snaps.length - 1].sharesPct?.[winnerId] ?? 0;
      const priorIdx = Math.max(0, snaps.length - 5);
      const priorShare = snaps[priorIdx].sharesPct?.[winnerId] ?? 0;
      winnerClosingDeltaPct = lastShare - priorShare;
      closingDeltas.push(winnerClosingDeltaPct);
    }

    summaries.push({
      electionId: e._id.toString(),
      countryId: e.countryId,
      electionType: String(e.electionType),
      state: e.state,
      status: e.status,
      candidateCount: candidateIds.length,
      winnerId,
      winnerName: winnerId ? tally.candidateNames?.[winnerId] : undefined,
      winnerParty: winnerId ? tally.candidateParties?.[winnerId] : undefined,
      winnerSharePct,
      marginPct,
      leadChanges,
      winnerClosingDeltaPct,
      trajectory: downsample(
        snaps.map((s) => ({ turn: s.turn, sharesPct: s.sharesPct })),
        maxTrajectoryPoints
      ),
    });
  }

  const sortedMargins = [...margins].sort((a, b) => a - b);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const rollup = (map: Record<string, GroupStat>) =>
    Object.fromEntries(
      Object.entries(map).map(([k, s]) => [
        k,
        {
          elections: s.elections,
          resolved: s.resolved,
          contestedPct: s.elections > 0 ? s.contested / s.elections : 0,
          meanMarginPct: s.marginCount > 0 ? s.marginSum / s.marginCount : null,
        },
      ])
    );

  return {
    turn,
    scope,
    emptyCandidateSupplyCountries,
    totals: {
      elections: scoped.length,
      withTally,
      resolved: resolvedTotal,
      contested: contestedTotal,
      contestedPct: withTally > 0 ? contestedTotal / withTally : 0,
    },
    margin: sortedMargins.length
      ? {
          mean: mean(sortedMargins),
          median: quantile(sortedMargins, 0.5),
          p10: quantile(sortedMargins, 0.1),
          p90: quantile(sortedMargins, 0.9),
        }
      : null,
    dynamism: {
      meanLeadChanges: mean(leadChangeList),
      meanWinnerClosingDeltaPct: mean(closingDeltas),
    },
    byCountry: rollup(byCountry),
    byElectionType: rollup(byElectionType),
    elections: summaries,
    collectedAt: new Date(),
  };
}
