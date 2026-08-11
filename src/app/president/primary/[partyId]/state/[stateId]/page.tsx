import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/mongodb";
import type {
  Campaign,
  DemographicCategory,
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
  Character,
  NPP,
  State,
  StateDemographics,
  StatePartyOrg,
} from "@/lib/db/types";
import { projectPrimaryByState } from "@/lib/primaryProjection";
import { fetchEnrichedCandidates } from "@/lib/electionEngine";
import {
  PRIMARY_WAVES,
  resolvePartyFamily,
  getDelegatesForState,
  getDefaultPrimaryAllocation,
  getTotalDelegatesForFamily,
  getDelegateMajority,
  type PrimaryCalendarFamily,
} from "@/lib/constants/primaryCalendar";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import { getPartyHex } from "@/lib/utils/politics";
import { getGameClock } from "@/lib/time/gameClock.server";
import { getSiteUrl } from "@/lib/siteMetadata";
import { projectPrimaryDelegateTotals } from "@/lib/elections/presidentialPrimaryDisplay";
import { resolvePrimaryTurnsToEnd } from "@/lib/elections/primaryViewModel";
import { allocateDelegates } from "@/lib/primaryDelegateAllocation";
import { loadRegionalBonusMaps } from "@/lib/primaryRegionalBonusLoader";
import { StateOrganizationPanel } from "./StateOrganizationPanel";

// This page is a live view over turn-processed delegate awards and per-state
// projections. It must render from current DB state every request so its
// standings stay aligned with the overall primary page and election detail.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ partyId: string; stateId: string }>;
}

const ALL_STATE_IDS = [...new Set(ELECTORAL_VOTE_UNITS.map((unit) => unit.stateId))];

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { partyId, stateId } = await params;
  const db = await getDb();
  const party = await findParty(db, partyId);
  const state = await db
    .collection<State>("states")
    .findOne({ _id: stateId.toUpperCase() }, { projection: { name: 1 } });
  if (!party || !state) return {};
  const title = `${state.name} — ${party.name} Presidential Primary | A House Divided`;
  const description = `${state.name} results, delegate allocation, and projection for the ${party.name} presidential primary.`;
  const url = `${getSiteUrl()}/president/primary/${partyId}/state/${stateId}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, type: "website", url },
    twitter: { card: "summary", title, description },
  };
}

async function findParty(
  db: Awaited<ReturnType<typeof getDb>>,
  partyId: string
): Promise<PoliticalParty | null> {
  const seqId = Number(partyId);
  if (Number.isFinite(seqId)) {
    const byId = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId: "US", sequentialId: seqId });
    if (byId) return byId;
  }
  return await db
    .collection<PoliticalParty>("politicalParties")
    .findOne({ countryId: "US", abbreviation: partyId });
}

export default async function PartyPrimaryStatePage({ params }: PageProps) {
  const { partyId, stateId: rawStateId } = await params;
  const stateId = rawStateId.toUpperCase();
  const db = await getDb();

  const [party, state, election] = await Promise.all([
    findParty(db, partyId),
    // Presidential primaries are US-only.
    db.collection<State>("states").findOne({ _id: stateId, countryId: "US" }),
    db.collection<Election>("elections").findOne({
      electionType: "president",
      countryId: "US",
      status: "active",
    }),
  ]);
  if (!party || !state || !election) notFound();

  const partyKey = party.sequentialId.toString();
  const family: PrimaryCalendarFamily = resolvePartyFamily(partyKey, {
    primaryCalendar: party.primaryCalendar ?? null,
    economicPosition: party.economicPosition,
  });

  const [candidates, tally] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({ electionId: election._id, party: partyKey, status: "active" })
      .toArray(),
    db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId: election._id }),
  ]);

  const candidateKeys = candidates
    .map((c) => (c.isNPP ? c.nppId : c.characterId))
    .filter((id): id is NonNullable<typeof id> => id != null);

  const enrichedPromise = fetchEnrichedCandidates(candidates, {
    includePartyPositions: true,
    countryId: "US",
  });

  const [chars, npps, partyOrgs, campaigns] = await Promise.all([
    db
      .collection<Character>("characters")
      .find({ _id: { $in: candidates.filter((c) => !c.isNPP).map((c) => c.characterId) } })
      .toArray(),
    db
      .collection<NPP>("npps")
      .find({
        _id: { $in: candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!) },
      })
      .toArray(),
    db
      .collection<StatePartyOrg>("statePartyOrg")
      .find({ countryId: "US", partyId: partyKey })
      .toArray(),
    candidateKeys.length
      ? db
          .collection<Campaign>("campaigns")
          .find({ electionId: election._id, candidateId: { $in: candidateKeys } })
          .project<{ candidateId: (typeof candidateKeys)[number]; color?: string | null }>({
            candidateId: 1,
            color: 1,
          })
          .toArray()
      : Promise.resolve(
          [] as { candidateId: (typeof candidateKeys)[number]; color?: string | null }[]
        ),
  ]);
  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

  const campaignColorByCandidateKey = new Map<string, string | null>();
  for (const camp of campaigns) {
    campaignColorByCandidateKey.set(camp.candidateId.toString(), camp.color ?? null);
  }

  // Party-org map is still passed to the allocator because the underlying math
  // expects it, but it's a shared mobilization scalar — every same-party candidate
  // sees the same value. It affects total primary turnout volume in the state,
  // not any one candidate's share. We deliberately don't surface it in the UI.
  const orgMap = new Map<string, number>();
  const allocationByState: Record<string, "PR" | "WTA"> = {};
  for (const po of partyOrgs) {
    orgMap.set(`${po.stateId}_${po.partyId}`, po.organization + (po.primarySurge ?? 0));
    if (po.primaryAllocation) allocationByState[po.stateId] = po.primaryAllocation;
  }

  const candidateMeta = candidates.map((c) => {
    const homeState = c.isNPP
      ? c.nppId
        ? (nppMap.get(c.nppId.toString())?.homeState ?? null)
        : null
      : (charMap.get(c.characterId.toString())?.homeState ?? null);
    return {
      candidateId: c._id.toString(),
      isNPP: Boolean(c.isNPP),
      homeState,
      primaryCampaignState: c.primaryCampaignState ?? null,
      primaryCampaignTicks: c.primaryCampaignTicks ?? 0,
    };
  });

  const [categoriesDocs, stateDoc, demographicsDoc, enriched, apportionmentPreset] =
    await Promise.all([
      db.collection<DemographicCategory>("demographicCategories").find({}).toArray(),
      db
        .collection<State>("states")
        .find({ _id: { $in: ALL_STATE_IDS } })
        .toArray(),
      db
        .collection<StateDemographics>("stateDemographics")
        .find({ _id: { $in: ALL_STATE_IDS } })
        .toArray(),
      enrichedPromise,
      db
        .collection<{ _id: string; preset?: string }>("gameState")
        .findOne({ _id: "current" })
        .then((gs) => gs?.preset),
    ]);
  const stateMap = new Map(stateDoc.map((doc) => [doc._id as string, doc]));
  if (!stateMap.has(stateId)) stateMap.set(stateId, state);
  const demographicsMap = new Map(demographicsDoc.map((doc) => [doc._id as string, doc]));

  const homeStateByCharacterIdProj = new Map(
    [...charMap.values()].map((c) => [c._id.toString(), c.homeState ?? null])
  );
  const homeStateByNppIdProj = new Map(
    [...nppMap.values()].map((n) => [n._id.toString(), n.homeState ?? null])
  );
  const regionalBonuses = await loadRegionalBonusMaps(db, {
    candidates,
    homeStateByCharacterId: homeStateByCharacterIdProj,
    homeStateByNppId: homeStateByNppIdProj,
  });

  const projection = projectPrimaryByState({
    candidates: enriched,
    candidateMeta,
    stateIds: ALL_STATE_IDS,
    stateMap,
    demographicsMap,
    categories: categoriesDocs,
    statePartyOrgs: orgMap,
    partyPosition: {
      economicPosition: party.economicPosition,
      socialPosition: party.socialPosition,
    },
    // Mirror primaryStaggerPhase wiring so projection matches what the wave
    // actually produces — otherwise regionally-funded wins surface as upsets.
    stateOrgByStateAndCandidate: regionalBonuses.stateOrgByStateAndCandidate,
    homeStateByCandidate: regionalBonuses.homeStateByCandidate,
    countryId: "US",
  });

  // Percentage denominators must cover exactly the candidates we render a row
  // for. `tally.primaryStateVotes` is an append-only historical record that
  // keeps entries for candidates who have since withdrawn or been vacated from
  // the primary, while `rows` below is built from the LIVE `candidates` list.
  // Summing the raw map therefore inflated the denominator and the visible
  // percentages added up to less than 100% (ticket #974: "some of the primaries
  // are not showing a 100% total"). Scope both totals to the live candidate set
  // so the column always reconciles to 100%.
  const liveCandidateIds = new Set(candidates.map((c) => c._id.toString()));
  const sumForLiveCandidates = (scores: Record<string, number>): number =>
    Object.entries(scores).reduce((s, [cid, v]) => (liveCandidateIds.has(cid) ? s + v : s), 0);

  const projectionScores = projection.byState[stateId] ?? {};
  const projectedTotal = sumForLiveCandidates(projectionScores);

  const accruedVotes = tally?.primaryStateVotes?.[partyKey]?.[stateId] ?? {};
  const accruedTotal = sumForLiveCandidates(accruedVotes);
  const accruedDelegates = tally?.primaryDelegatesByState?.[partyKey]?.[stateId] ?? {};
  const allocationMethod =
    tally?.primaryAllocationByState?.[partyKey]?.[stateId] ??
    allocationByState[stateId] ??
    getDefaultPrimaryAllocation(stateId, family);

  const hasVoted = Object.keys(accruedVotes).length > 0 && accruedTotal > 0;

  // Wave info for this state
  const waveIndex = PRIMARY_WAVES.findIndex((w) => w.states.includes(stateId));
  const wave = waveIndex >= 0 ? PRIMARY_WAVES[waveIndex] : null;
  const wavesRun = tally?.primaryWaveHistory?.length ?? 0;
  const waveFired = waveIndex >= 0 && waveIndex < wavesRun;

  const clock = await getGameClock();
  // Turn-first turns-to-end, matching the stagger engine. Reading wall-clock
  // `primaryEndTime` here would drift ahead of the turn counter when the cron
  // falls behind, so this state's "fires in N turns" countdown is driven off
  // the turn field (with a wall-clock fallback only when it is absent).
  const turnsToEnd = resolvePrimaryTurnsToEnd({
    primaryEndTurn: election.primaryEndTurn,
    primaryEndTime: election.primaryEndTime,
    currentTurn: clock.currentTurn,
    now: clock.now,
  });
  const turnsUntilWave =
    waveIndex >= 0 && !waveFired && turnsToEnd != null
      ? Math.max(0, turnsToEnd - (wave?.turnsRemaining ?? 0))
      : null;

  const partyColor = getPartyHex(party.abbreviation ?? partyKey, party.color);
  const stateDelegates = getDelegatesForState(stateId, family, apportionmentPreset);
  const totalDelegates = getTotalDelegatesForFamily(family, apportionmentPreset);
  const majorityThreshold = getDelegateMajority(family, apportionmentPreset);

  const candidateColorMap = buildCandidateColorMap(
    candidates.map((c) => {
      const candKey = c.isNPP ? c.nppId?.toString() : c.characterId?.toString();
      return {
        candidateId: c._id.toString(),
        campaignColor: candKey ? (campaignColorByCandidateKey.get(candKey) ?? null) : null,
      };
    }),
    party.abbreviation ?? partyKey,
    party.color
  );
  const colorForCandidate = (candidateId: string): string =>
    candidateColorMap[candidateId] ?? partyColor;

  // Primary-wide delegate totals (all states combined)
  const projectedPrimaryDelegates = projectPrimaryDelegateTotals({
    stateIds: ALL_STATE_IDS,
    family,
    candidateIds: candidates.map((candidate) => candidate._id.toString()),
    projectedVotesByState: projection.byState,
    actualVotesByState: tally?.primaryStateVotes?.[partyKey] ?? {},
    awardedDelegatesByState: tally?.primaryDelegatesByState?.[partyKey] ?? {},
    allocationByState: {
      ...allocationByState,
      ...(tally?.primaryAllocationByState?.[partyKey] ?? {}),
    },
    // Must match the overview page — otherwise 1991-preset EV rescale flips
    // WTA projections between `/president/primary/[partyId]` and this page.
    preset: apportionmentPreset,
  });
  const partyWideDelegates = tally?.primaryDelegates?.[partyKey] ?? {};

  // Per-state delegate projection: feed THIS state's projection (or accrued
  // votes, when available) through the same allocator the overview uses, so
  // users can see how a small per-state vote-share lead maps to delegates
  // under the state's allocation rule. Without this, a 50.3 / 49.7 projection
  // looks like a coin flip — but under WTA it's a 40 / 0 sweep.
  const stateVoteSourceForDelegates = hasVoted ? accruedVotes : projectionScores;
  const projectedStateDelegateAllocation =
    stateDelegates > 0 && Object.values(stateVoteSourceForDelegates).some((v) => v > 0)
      ? allocateDelegates(allocationMethod, stateVoteSourceForDelegates, stateDelegates).byCandidate
      : ({} as Record<string, number>);

  // Build unified rows: projection + accrued side-by-side
  const rows = candidates
    .map((c) => {
      const cid = c._id.toString();
      const projectionScore = projectionScores[cid] ?? 0;
      const votes = accruedVotes[cid] ?? 0;
      const delegates = accruedDelegates[cid] ?? 0;
      return {
        candidate: c,
        projectionScore,
        projectionPct: projectedTotal > 0 ? (projectionScore / projectedTotal) * 100 : 0,
        votes,
        votePct: accruedTotal > 0 ? (votes / accruedTotal) * 100 : 0,
        delegates,
        projectedStateDelegates: projectedStateDelegateAllocation[cid] ?? 0,
        totalDelegates: partyWideDelegates[cid] ?? 0,
        projectedTotalDelegates: projectedPrimaryDelegates[cid] ?? 0,
      };
    })
    .sort((a, b) => (hasVoted ? b.votes - a.votes : b.projectionScore - a.projectionScore));

  const maxProjectionPct = rows.length > 0 ? Math.max(...rows.map((r) => r.projectionPct)) : 1;

  // Polling history for this state/party, sorted oldest → newest
  const pollingHistory =
    (tally?.primaryStatePollingHistory?.length ?? 0) > 1
      ? tally!
          .primaryStatePollingHistory!.filter(
            (snap) => snap.byParty[partyKey]?.[stateId] !== undefined
          )
          .sort((a, b) => a.turn - b.turn)
      : [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-16 pt-6">
      <div className="mb-6">
        <Link
          href={`/president/primary/${partyId}`}
          className="text-xs text-muted hover:text-foreground transition-colors"
        >
          ← Back to {party.name} Primary
        </Link>
        <h1 className="text-2xl font-bold mt-1" style={{ color: partyColor }}>
          {state.name} — {party.name} Primary
        </h1>
        <p className="text-sm text-muted">
          {stateDelegates} delegates ·{" "}
          {allocationMethod === "PR" ? "Proportional (15% viability)" : "Winner-take-all"}
          {wave ? ` · ${wave.label}` : " · Not on primary calendar"}
        </p>
      </div>

      {/* Status tiles */}
      <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-card-border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Status</div>
          {waveFired ? (
            <div className="text-sm font-semibold text-green-400">Voted</div>
          ) : turnsUntilWave !== null ? (
            <div className="text-sm font-semibold text-amber-400">
              ~{Math.ceil(turnsUntilWave)} turn{Math.ceil(turnsUntilWave) === 1 ? "" : "s"}
            </div>
          ) : (
            <div className="text-sm text-muted">Not on calendar</div>
          )}
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Delegates</div>
          <div className="text-sm font-semibold" style={{ color: partyColor }}>
            {stateDelegates}
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Allocation</div>
          <div className="text-sm font-semibold">
            {allocationMethod === "PR" ? "Proportional" : "Winner-take-all"}
          </div>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-3">
          <div className="text-xs uppercase tracking-wider text-muted mb-1">Wave</div>
          <div className="text-sm font-semibold">{wave ? wave.label : "—"}</div>
        </div>
      </div>

      {/* Projection trend */}
      {pollingHistory.length > 1 && (
        <div className="mb-6 rounded-xl border border-card-border bg-card p-4">
          <div className="text-sm font-semibold mb-3">Projection trend</div>
          <div className="flex gap-0.5 h-16 items-end">
            {pollingHistory.map((snap, si) => {
              const scores = snap.byParty[partyKey]?.[stateId] ?? {};
              const total = Object.values(scores).reduce((s, v) => s + v, 0);
              if (total === 0) return <div key={si} className="flex-1" />;
              return (
                <div key={si} className="flex-1 flex flex-col-reverse" title={`Turn ${snap.turn}`}>
                  {rows.map((r) => {
                    const score = scores[r.candidate._id.toString()] ?? 0;
                    const pct = (score / total) * 100;
                    return (
                      <div
                        key={r.candidate._id.toString()}
                        style={{
                          height: `${pct}%`,
                          backgroundColor: colorForCandidate(r.candidate._id.toString()),
                        }}
                        title={`${r.candidate.characterName}: ${pct.toFixed(1)}%`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            {rows.map((r) => (
              <span key={r.candidate._id.toString()} className="flex items-center gap-1.5 text-xs">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: colorForCandidate(r.candidate._id.toString()) }}
                />
                <span className="text-muted">{r.candidate.characterName}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <StateOrganizationPanel stateId={stateId} />

      {/* Candidate breakdown */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-card-border bg-background text-xs font-medium uppercase tracking-wider text-muted flex items-center justify-between">
          <span>Candidate breakdown</span>
          <span className="text-xs normal-case text-muted/80">
            {hasVoted ? "Actual votes + delegates" : "Pre-vote projection"}
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-background text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Projection</th>
              <th className="px-3 py-2 text-right">Votes</th>
              <th className="px-3 py-2 text-right">Vote %</th>
              <th
                className="px-3 py-2 text-right"
                title={`If this state voted right now, ${
                  allocationMethod === "WTA"
                    ? "winner-take-all gives the leader every delegate"
                    : "proportional allocation splits delegates above the 15% viability threshold"
                }.`}
              >
                {hasVoted ? "Delegates" : "Proj. Del."}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-card-border">
            {rows.map((r, i) => {
              const barPct = maxProjectionPct > 0 ? (r.projectionPct / maxProjectionPct) * 100 : 0;
              const color = colorForCandidate(r.candidate._id.toString());
              const stateDelegateCell = hasVoted
                ? r.delegates > 0
                  ? r.delegates
                  : "—"
                : r.projectedStateDelegates > 0
                  ? r.projectedStateDelegates
                  : "—";
              return (
                <tr key={r.candidate._id.toString()}>
                  <td className="px-3 py-2.5">
                    <span
                      className={`tabular-nums font-medium ${i === 0 ? "text-yellow-400" : "text-muted"}`}
                    >
                      {i + 1}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={
                        r.candidate.isNPP
                          ? `/politicians/npp/${r.candidate.nppId}`
                          : `/character/${r.candidate.characterId}`
                      }
                      className="font-semibold hover:text-primary transition-colors"
                    >
                      {r.candidate.characterName}
                    </Link>
                    {r.candidate.isNPP && (
                      <span className="ml-2 rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                        NPP
                      </span>
                    )}
                    {r.candidate.primaryCampaignState === stateId && (
                      <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
                        📍 camped
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-card-border overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${barPct}%`, backgroundColor: color }}
                        />
                      </div>
                      <span
                        className="tabular-nums text-xs w-10 text-right shrink-0"
                        style={{ color }}
                        title={`Projected: ~${Math.round(r.projectionScore).toLocaleString()} votes`}
                      >
                        {r.projectionPct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs">
                    {r.votes > 0 ? r.votes.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {r.votes > 0 ? `${r.votePct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    {stateDelegateCell}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!hasVoted && stateDelegates > 0 && (
          <div className="border-t border-card-border bg-background/40 px-4 py-2 text-[11px] text-muted/80">
            <strong className="text-foreground/80">Proj. Del.</strong> applies this state&apos;s
            allocation rule (
            {allocationMethod === "WTA"
              ? "winner-take-all — even a 50.3% vote share sweeps all delegates"
              : "proportional, with a 15% viability floor"}
            ) to the projected vote share above. That&apos;s why a near-50/50 projection here can
            still map to a lopsided national delegate share on the overview.
          </div>
        )}
      </div>

      {/* Primary-wide projected delegate standings */}
      <div className="mt-6 rounded-xl border border-card-border bg-card p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Projected primary standings</h3>
          <span className="text-xs text-muted">
            {majorityThreshold.toLocaleString()} to clinch · {totalDelegates.toLocaleString()} total
          </span>
        </div>
        <div className="relative h-8 rounded-lg overflow-hidden border border-card-border bg-background flex">
          {rows
            .slice()
            .sort((a, b) => b.projectedTotalDelegates - a.projectedTotalDelegates)
            .map((r) => {
              const pct =
                totalDelegates > 0 ? (r.projectedTotalDelegates / totalDelegates) * 100 : 0;
              if (pct === 0) return null;
              const color = colorForCandidate(r.candidate._id.toString());
              return (
                <div
                  key={r.candidate._id.toString()}
                  className="h-full flex items-center justify-center"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                  title={`${r.candidate.characterName}: ${r.projectedTotalDelegates.toLocaleString()} projected delegates`}
                >
                  {pct > 6 && (
                    <span className="text-white font-bold text-xs tabular-nums drop-shadow">
                      {r.projectedTotalDelegates.toLocaleString()}
                    </span>
                  )}
                </div>
              );
            })}
          {totalDelegates > 0 && (
            <div
              className="absolute top-0 bottom-0 w-px bg-white/50 pointer-events-none"
              style={{ left: `${(majorityThreshold / totalDelegates) * 100}%` }}
            >
              <div className="absolute top-0.5 left-1 text-[9px] font-bold text-white/70 whitespace-nowrap">
                {majorityThreshold.toLocaleString()}
              </div>
            </div>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
          {rows
            .slice()
            .sort((a, b) => b.projectedTotalDelegates - a.projectedTotalDelegates)
            .map((r) => (
              <div key={r.candidate._id.toString()} className="flex items-center gap-1.5">
                <div
                  className="h-3 w-3 rounded-sm shrink-0"
                  style={{ backgroundColor: colorForCandidate(r.candidate._id.toString()) }}
                />
                <span className="text-xs font-medium text-foreground">
                  {r.candidate.characterName}
                </span>
                <span
                  className="text-xs tabular-nums font-bold"
                  style={{ color: colorForCandidate(r.candidate._id.toString()) }}
                >
                  {r.projectedTotalDelegates.toLocaleString()}
                </span>
                {r.totalDelegates > 0 && (
                  <span className="text-[11px] text-muted">
                    ({r.totalDelegates.toLocaleString()} awarded)
                  </span>
                )}
              </div>
            ))}
        </div>
      </div>

      <div className="mt-4 text-[11px] text-muted/80">
        <p>
          <strong className="text-foreground">Projection</strong> is the pre-vote share implied by
          candidate stats (policy alignment, national influence, favorability, home-state org, and
          any in-state campaigning). Primary-wide delegate standings lock in awarded delegates from
          completed states while the remaining states continue to project forward.
        </p>
      </div>
    </div>
  );
}
