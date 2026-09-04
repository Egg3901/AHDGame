import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/lib/mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectionVoteTally,
  PoliticalParty,
  Character,
  NPP,
  StatePartyOrg,
} from "@/lib/db/types";
import { type PrimaryStateData } from "@/components/PrimaryElectoralMap";
import { PrimaryMapWithLinks } from "./PrimaryMapWithLinks";
import { projectPrimaryByState } from "@/lib/primaryProjection";
import { loadRegionalBonusMaps } from "@/lib/primaryRegionalBonusLoader";
import { fetchEnrichedCandidates } from "@/lib/electionEngine";
import type { Campaign, DemographicCategory, State, StateDemographics } from "@/lib/db/types";
import {
  getPrimaryWaveSchedule,
  resolvePartyFamily,
  getTotalDelegatesForFamily,
  getDelegateMajority,
  type PrimaryCalendarFamily,
} from "@/lib/constants/primaryCalendar";
import { presidentialRulesetFor } from "@/lib/elections/presidentialRuleset";
import { ELECTORAL_VOTE_UNITS, getTravelActionCost } from "@/lib/constants/states";
import { getPartyHex } from "@/lib/utils/politics";
import { getGameClock } from "@/lib/time/gameClock.server";
import { getSiteUrl } from "@/lib/siteMetadata";
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import { getAuthUser } from "@/lib/auth";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { ObjectId } from "mongodb";
import { summarizePrimaryProjection } from "@/lib/elections/presidentialPrimaryDisplay";
import { PrimaryCampaignControls } from "./PrimaryCampaignControls";
import { EndorseButton } from "./EndorseButton";
import { PrimaryShellClient } from "./PrimaryShellClient";
import {
  buildPrimaryViewModel,
  isInStaggerWindow,
  resolvePrimaryTurnsToEnd,
} from "@/lib/elections/primaryViewModel";
import {
  PRIMARY_CAMPAIGN_TICK_CAP,
  PRIMARY_HOME_SURGE_COST_ACTIONS,
  PRIMARY_HOME_SURGE_COST_FUNDS,
  PRIMARY_HOME_SURGE_PCT,
} from "@/lib/electionEngine/constants";
import type { PlayerEndorsement } from "@/lib/db/types";

// Presidential primary standings can change every turn and after live player
// actions (endorsements, surge, in-state campaigning), so cached route output
// can drift from the election detail and state pages. Force fresh rendering.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ partyId: string }>;
  /** `?state=CA` selects which state's carve-up to show in the new shell. */
  searchParams?: Promise<{ state?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { partyId } = await params;

  const db = await getDb();
  const sequentialId = Number(partyId);
  let party: PoliticalParty | null = null;
  if (Number.isFinite(sequentialId)) {
    party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne(
        { countryId: "US", sequentialId },
        { projection: { name: 1, abbreviation: 1, logoUrl: 1 } }
      );
  }
  if (!party) {
    party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne(
        { countryId: "US", abbreviation: partyId },
        { projection: { name: 1, abbreviation: 1, logoUrl: 1 } }
      );
  }
  if (!party) return {};

  const title = `${party.name} Presidential Primary | A House Divided`;
  const description = `Live delegate count, state-by-state results, and projections for the ${party.name} presidential primary.`;
  const url = `${getSiteUrl()}/president/primary/${partyId}`;
  const image = party.logoUrl || CDN_LOGO_URL;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      images: [{ url: image, width: 512, height: 512, alt: party.name }],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}

const STATE_IDS = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];
async function loadPrimaryData(partySlug: string) {
  const db = await getDb();

  const [election, party] = await Promise.all([
    db.collection<Election>("elections").findOne({
      electionType: "president",
      countryId: "US",
      status: "active",
    }),
    db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId: "US", sequentialId: Number(partySlug) }),
  ]);
  if (!election) return null;
  // Fall back to slug-based lookup if sequentialId doesn't match
  const partyDoc =
    party ??
    (await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId: "US", abbreviation: partySlug }));
  if (!partyDoc) return null;

  // Load this party's candidate roster. An empty roster is no longer fatal —
  // we still render the page (calendar, map, standings) with zeroed-out
  // numbers and a "no candidates have filed yet" call-to-action so the
  // primary surface remains navigable before anyone enters the race.
  const [candidates, tally] = await Promise.all([
    db
      .collection<ElectionCandidate>("electionCandidates")
      .find({
        electionId: election._id,
        party: partyDoc.sequentialId.toString(),
        status: "active",
      })
      .toArray(),
    db.collection<ElectionVoteTally>("electionVoteTallies").findOne({ electionId: election._id }),
  ]);

  // Fetch each candidate's campaign to read their chosen display color.
  // Campaign.color is optional; falls back to a palette in buildCandidateColorMap.
  const candidateKeys = candidates
    .map((c) => (c.isNPP ? c.nppId : c.characterId))
    .filter((id): id is NonNullable<typeof id> => id != null);
  const campaigns = candidateKeys.length
    ? await db
        .collection<Campaign>("campaigns")
        .find({ electionId: election._id, candidateId: { $in: candidateKeys } })
        .project<{ candidateId: (typeof candidateKeys)[number]; color?: string | null }>({
          candidateId: 1,
          color: 1,
        })
        .toArray()
    : [];
  const campaignColorByCandidateKey = new Map<string, string | null>();
  for (const camp of campaigns) {
    campaignColorByCandidateKey.set(camp.candidateId.toString(), camp.color ?? null);
  }

  const characterIds = candidates.filter((c) => !c.isNPP).map((c) => c.characterId);
  const nppIds = candidates.filter((c) => c.isNPP && c.nppId).map((c) => c.nppId!);
  const [chars, npps] = await Promise.all([
    characterIds.length > 0
      ? db
          .collection<Character>("characters")
          .find(
            { _id: { $in: characterIds } },
            { projection: { homeState: 1, nationalInfluence: 1, favorability: 1 } }
          )
          .toArray()
      : [],
    nppIds.length > 0
      ? db
          .collection<NPP>("npps")
          .find({ _id: { $in: nppIds } }, { projection: { homeState: 1, favorability: 1 } })
          .toArray()
      : [],
  ]);
  const charMap = new Map(chars.map((c) => [c._id.toString(), c]));
  const nppMap = new Map(npps.map((n) => [n._id.toString(), n]));

  const partyOrgs = await db
    .collection<StatePartyOrg>("statePartyOrg")
    .find({
      countryId: "US",
      partyId: partyDoc.sequentialId.toString(),
    })
    .toArray();
  const orgMap = new Map<string, number>();
  const allocationByState: Record<string, "PR" | "WTA"> = {};
  for (const po of partyOrgs) {
    // Include active home-state surge bumps so the projection reflects them.
    orgMap.set(`${po.stateId}_${po.partyId}`, po.organization + (po.primarySurge ?? 0));
    if (po.primaryAllocation) allocationByState[po.stateId] = po.primaryAllocation;
  }

  // Build candidate meta for the projection (home state + campaign state + ticks).
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
      support: c.support,
    };
  });

  // Fetch shared demographics / state meta / categories once for the GE-style
  // per-state projection.
  const [categoriesDocs, statesDocs, demographicsDocs, enriched] = await Promise.all([
    loadDemographicCategories(db),
    db
      .collection<State>("states")
      .find({ _id: { $in: STATE_IDS } })
      .toArray(),
    db
      .collection<StateDemographics>("stateDemographics")
      .find({ _id: { $in: STATE_IDS } })
      .toArray(),
    fetchEnrichedCandidates(candidates, { includePartyPositions: true, countryId: "US" }),
  ]);
  const stateMap = new Map(statesDocs.map((s) => [s._id as string, s]));
  const demographicsMap = new Map(demographicsDocs.map((d) => [d._id as string, d]));

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
    stateIds: STATE_IDS,
    stateMap,
    demographicsMap,
    categories: categoriesDocs,
    statePartyOrgs: orgMap,
    partyPosition: {
      economicPosition: partyDoc.economicPosition,
      socialPosition: partyDoc.socialPosition,
    },
    // Mirror primaryStaggerPhase wiring so projection matches what the wave
    // actually produces — otherwise regionally-funded wins surface as upsets.
    stateOrgByStateAndCandidate: regionalBonuses.stateOrgByStateAndCandidate,
    homeStateByCandidate: regionalBonuses.homeStateByCandidate,
    countryId: "US",
  });

  const allEndorsements = await db
    .collection<PlayerEndorsement>("playerEndorsements")
    .find({ electionId: election._id, isActive: true })
    .project<{ candidateId: ObjectId }>({ candidateId: 1 })
    .toArray();
  const endorsementCounts = new Map<string, number>();
  for (const e of allEndorsements) {
    const cid = e.candidateId.toString();
    endorsementCounts.set(cid, (endorsementCounts.get(cid) ?? 0) + 1);
  }

  return {
    election,
    party: partyDoc,
    candidates,
    tally,
    projection,
    charMap,
    nppMap,
    campaignColorByCandidateKey,
    endorsementCounts,
    allocationByState,
  };
}

export default async function PartyPrimaryPage({ params, searchParams }: PageProps) {
  const { partyId } = await params;
  const sp = (await searchParams) ?? {};
  const requestedState = sp.state?.toUpperCase();
  const data = await loadPrimaryData(partyId);
  if (!data) notFound();

  const {
    election,
    party,
    candidates,
    tally,
    projection,
    charMap,
    nppMap,
    campaignColorByCandidateKey,
    endorsementCounts,
    allocationByState,
  } = data;
  const partyKey = party.sequentialId.toString();

  // Active preset drives travel action cost (scaled by 1990-census EV in a 1991 game).
  const apportionmentPreset = (
    await (
      await getDb()
    )
      .collection<{ _id: string; preset?: string }>("gameState")
      .findOne({ _id: "current" })
  )?.preset;

  // Resolve the viewer's active character + funds for rendering the
  // primary-campaign / home-state-surge control panel when they're a candidate
  // in this party's primary. Multi-profile aware via activeCharacterId.
  const viewer = await getAuthUser();
  let viewerCandidate: (typeof candidates)[number] | null = null;
  let viewerChar: Character | null = null;
  let viewerEndorsedCandidateId: string | null = null;
  if (viewer?.userId) {
    const db2 = await getDb();
    const viewerCharId = viewer.activeCharacterId
      ? new ObjectId(viewer.activeCharacterId)
      : ((await getCharacterByUserId(db2, viewer.userId))?._id ?? null);
    if (viewerCharId) {
      viewerCandidate =
        candidates.find(
          (c) => !c.isNPP && c.characterId && c.characterId.toString() === viewerCharId.toString()
        ) ?? null;
      viewerChar = await db2.collection<Character>("characters").findOne({ _id: viewerCharId });

      // Current active endorsement for this election (if any)
      const activeEnd = await db2.collection<PlayerEndorsement>("playerEndorsements").findOne({
        characterId: viewerCharId,
        electionId: election._id,
        isActive: true,
      });
      if (activeEnd) {
        viewerEndorsedCandidateId = activeEnd.candidateId.toString();
      }
    }
  }
  const viewerIsLoggedInWithCharacter = viewerChar !== null;

  const family: PrimaryCalendarFamily = resolvePartyFamily(partyKey, {
    primaryCalendar: party.primaryCalendar ?? null,
    economicPosition: party.economicPosition,
  });
  const totalDelegates = getTotalDelegatesForFamily(family);
  const majorityThreshold = getDelegateMajority(family);

  const clock = await getGameClock();
  // Turns until the final (T-0) closing wave fires, computed turn-first to match
  // the stagger engine (`runPrimaryStaggerWaveIfDue`). The turn counter is the
  // source of truth: it freezes on pause and does not drift when the cron falls
  // behind wall-clock. Reading `primaryEndTime` here instead would push the
  // calendar ahead of the engine — the UI would show "Super Tuesday now" while
  // the engine, correctly, has not yet reached its stagger window. `null` when
  // no deadline is set; negative once the primary has closed.
  const turnsToEnd = resolvePrimaryTurnsToEnd({
    primaryEndTurn: election.primaryEndTurn,
    primaryEndTime: election.primaryEndTime,
    currentTurn: clock.currentTurn,
    now: clock.now,
  });
  // Non-negative value for the calendar's "fires in N turns" labels.
  const displayTurnsToEnd = turnsToEnd != null ? Math.max(0, turnsToEnd) : null;
  const primaryEnded = turnsToEnd != null && turnsToEnd < 0;
  // Wave schedule the race actually runs (compressed for the live 1960 race,
  // stretched for v3+ spawns) so the calendar rows and stagger label match the
  // engine's spacing rather than assuming compressed.
  const primaryWaveSchedule = getPrimaryWaveSchedule(presidentialRulesetFor(election));
  const inStaggerWindow = isInStaggerWindow(turnsToEnd, primaryWaveSchedule);
  const wavesRun = tally?.primaryWaveHistory?.length ?? 0;

  const votedStates = new Set<string>();
  for (const entry of tally?.primaryWaveHistory ?? []) {
    for (const s of entry.statesVoted) votedStates.add(s);
  }

  const partyStateVotes: Record<string, Record<string, number>> = tally?.primaryStateVotes?.[
    partyKey
  ] ?? {};
  const awardedDelegatesByState = tally?.primaryDelegatesByState?.[partyKey] ?? {};
  const awardedDelegates = tally?.primaryDelegates?.[partyKey] ?? {};
  // Single canonical reconciliation: same state-by-state source feeds the
  // delegate share AND the national vote share. Every display number on this
  // overview is derived from `summary` so per-state pages and the overview can
  // never disagree about what was projected.
  const summary = summarizePrimaryProjection({
    stateIds: STATE_IDS,
    family,
    candidateIds: candidates.map((candidate) => candidate._id.toString()),
    totalDelegates: getTotalDelegatesForFamily(family),
    projectedVotesByState: projection.byState,
    actualVotesByState: partyStateVotes,
    awardedDelegatesByState,
    allocationByState: {
      ...allocationByState,
      ...(tally?.primaryAllocationByState?.[partyKey] ?? {}),
    },
    preset: apportionmentPreset,
  });
  const projectedDelegates = summary.delegatesByCandidate;

  const candidateMap = new Map(candidates.map((c) => [c._id.toString(), c]));
  const partyColor = getPartyHex(party.abbreviation ?? party.sequentialId.toString(), party.color);

  // Per-candidate display colors — each intra-party candidate gets a distinct
  // color so the map visibly differentiates winners. Campaign.color wins if set;
  // otherwise we assign palette colors deterministically (see candidateColor.ts).
  const candidateColorMap = buildCandidateColorMap(
    candidates.map((c) => {
      const candKey = c.isNPP ? c.nppId?.toString() : c.characterId.toString();
      return {
        candidateId: c._id.toString(),
        campaignColor: candKey ? (campaignColorByCandidateKey.get(candKey) ?? null) : null,
      };
    }),
    party.abbreviation ?? partyKey,
    party.color
  );
  const colorForCandidate = (candidateId: string | null): string =>
    candidateId ? (candidateColorMap[candidateId] ?? partyColor) : "#2a2a2a";

  // Build state colors. For voted states, color by actual winner's party (same color
  // for all candidates of this party — differentiated only in tooltips). For
  // unvoted states, color by projected intra-party winner (semi-transparent).
  // States not on the calendar are grey.
  const summaryByState = new Map(summary.perState.map((s) => [s.stateId, s]));
  const stateData: Record<string, PrimaryStateData> = {};
  for (const stateId of STATE_IDS) {
    const hasVoted = votedStates.has(stateId);
    const stateVotes = partyStateVotes[stateId] ?? {};
    let winnerId: string | null = null;
    const tooltip: string[] = [];
    if (hasVoted) {
      // Scope to live candidates for the same reason the per-state page does
      // (#974): the tally keeps rows for withdrawn candidates, which otherwise
      // surface as an "Unknown — x%" line and skew every other share.
      const ranked = Object.entries(stateVotes)
        .filter(([cid, v]) => v > 0 && candidateMap.has(cid))
        .sort(([, a], [, b]) => b - a);
      winnerId = ranked[0]?.[0] ?? null;
      if (winnerId) {
        const winner = candidateMap.get(winnerId);
        const total = ranked.reduce((s, [, v]) => s + v, 0);
        tooltip.push(`Actual results:`);
        for (const [cid, v] of ranked) {
          const c = candidateMap.get(cid);
          const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
          tooltip.push(`${c?.characterName ?? "Unknown"} — ${pct}%`);
        }
        const del = awardedDelegatesByState[stateId] ?? {};
        const winDelegates = del[winnerId] ?? 0;
        if (winDelegates > 0) {
          tooltip.push(`${winDelegates} delegates to ${winner?.characterName ?? "winner"}`);
        }
      }
    } else {
      winnerId = projection.stateWinners[stateId] ?? null;
      const projectedStateVotes = Object.entries(projection.byState[stateId] ?? {})
        .filter(([, score]) => score > 0)
        .sort(([, a], [, b]) => b - a);
      if (winnerId && projectedStateVotes.length > 0) {
        const total = projectedStateVotes.reduce((sum, [, score]) => sum + score, 0);
        tooltip.push(`Projected results:`);
        for (const [cid, score] of projectedStateVotes) {
          const projected = candidateMap.get(cid);
          const pct = total > 0 ? ((score / total) * 100).toFixed(1) : "0";
          tooltip.push(`${projected?.characterName ?? "Unknown"} — ${pct}%`);
        }
      } else {
        tooltip.push("No projection available");
      }
    }

    const candColor = colorForCandidate(winnerId);

    // Build the delegate-mode overlay for this state: total delegates plus a
    // per-candidate breakdown. Voted states use the actual awarded delegates;
    // upcoming states use the projected delegate allocation from the same
    // canonical summary that feeds the standings table.
    const stateSummary = summaryByState.get(stateId);
    let delegateLabel: string | undefined;
    const delegateTooltip: string[] = [];
    if (stateSummary) {
      delegateLabel =
        stateSummary.delegatesAvailable > 0 ? String(stateSummary.delegatesAvailable) : undefined;
      const delegateSource = hasVoted
        ? (stateSummary.awardedDelegatesByCandidate ?? {})
        : stateSummary.projectedDelegatesByCandidate;
      const rankedDelegates = Object.entries(delegateSource)
        .filter(([, d]) => d > 0)
        .sort(([, a], [, b]) => b - a);
      delegateTooltip.push(
        `${stateSummary.delegatesAvailable} delegate${stateSummary.delegatesAvailable === 1 ? "" : "s"}${
          hasVoted ? " awarded" : " available"
        }`
      );
      if (rankedDelegates.length > 0) {
        for (const [cid, d] of rankedDelegates) {
          const c = candidateMap.get(cid);
          delegateTooltip.push(`${c?.characterName ?? "Unknown"}: ${d}`);
        }
      } else if (stateSummary.delegatesAvailable > 0) {
        delegateTooltip.push("No delegate projection");
      }
    }

    stateData[stateId] = {
      color: winnerId ? candColor : "#2a2a2a",
      phase: hasVoted ? "actual" : winnerId ? "projected" : undefined,
      label: stateId,
      tooltip,
      delegateLabel,
      delegateTooltip,
    };
  }

  const standings = candidates
    .map((c) => {
      const cid = c._id.toString();
      const charId = c.isNPP ? null : (c.characterId?.toString() ?? null);
      const nppId = c.isNPP ? (c.nppId?.toString() ?? null) : null;
      const charDoc = charId ? charMap.get(charId) : null;
      const nppDoc = nppId ? nppMap.get(nppId) : null;
      return {
        candidate: c,
        projectedDelegates: projectedDelegates[cid] ?? 0,
        awardedDelegates: awardedDelegates[cid] ?? 0,
        nationalVoteSharePct: summary.nationalVoteSharePct[cid] ?? 0,
        nationalDelegateSharePct: summary.nationalDelegateSharePct[cid] ?? 0,
        isCamped: Boolean(c.primaryCampaignState),
        campaignState: c.primaryCampaignState ?? null,
        campaignTicks: c.primaryCampaignTicks ?? 0,
        nationalInfluence: charDoc?.nationalInfluence ?? null,
        favorability: charDoc?.favorability ?? nppDoc?.favorability ?? null,
        endorsements: endorsementCounts.get(cid) ?? 0,
      };
    })
    .sort((a, b) => b.projectedDelegates - a.projectedDelegates);

  // Party membership check — only characters in this party's primary can endorse
  const viewerInParty = viewerChar?.party === partyKey;

  const nextWave =
    inStaggerWindow && wavesRun < primaryWaveSchedule.waves.length
      ? primaryWaveSchedule.waves[wavesRun]
      : null;

  // Phase 4 — build the view-model that feeds TierSelector + PrimaryCalendar +
  // CarveUpPanel. The projection.byState shape is reused from the existing data
  // load above; the calendar isPast flags use the live tally's votedStates set.
  const primaryViewModel = buildPrimaryViewModel({
    candidates: candidates.map((c) => ({
      id: c._id.toString(),
      name: c.characterName ?? "Unknown",
      color: colorForCandidate(c._id.toString()),
      archetype: undefined,
    })),
    byState: projection.byState,
    votedStateIds: votedStates,
    // Pass the current turn + the election's real `primaryEndTurn` so the
    // view-model's `isPast` flag tracks the turn counter (matching the engine).
    // Falls back to the wall-clock-derived end turn only when `primaryEndTurn`
    // is absent. Both inputs are optional on the view-model; omitting them is a
    // no-op.
    currentTurn: clock.currentTurn,
    primaryEndTurn:
      election.primaryEndTurn ?? (turnsToEnd != null ? clock.currentTurn + turnsToEnd : undefined),
    // Calendar rows follow the race's actual wave spacing.
    schedule: primaryWaveSchedule,
    // State display names — fall back to the 2-letter id; the view-model
    // does the same defaulting if no entry is present.
  });

  // Default selection — URL param wins; otherwise pick the first upcoming
  // wave's first state via the view-model.
  const selectedStateId =
    requestedState && primaryViewModel.stateNameById[requestedState]
      ? requestedState
      : primaryViewModel.defaultSelectedStateId;

  // Build winner-color map for the calendar — uses the existing stateData
  // map's `color` field for past contests.
  const winnerColorByState: Record<string, string | undefined> = {};
  for (const [stateId, info] of Object.entries(stateData)) {
    if (info.phase === "actual") {
      winnerColorByState[stateId] = info.color;
    }
  }
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href={`/elections/${election._id.toString()}`}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            ← Back to presidential election
          </Link>
          <h1 className="text-2xl font-bold mt-1" style={{ color: partyColor }}>
            {party.name} Primary
          </h1>
          <p className="text-sm text-muted">
            {family === "dem" ? "Democratic-family calendar" : "Republican-family calendar"} —{" "}
            {totalDelegates.toLocaleString()} total delegates, {majorityThreshold.toLocaleString()}{" "}
            to win outright
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted uppercase tracking-wider">Phase</div>
          <div className="text-sm font-semibold">
            {inStaggerWindow ? (
              <span className="text-amber-400">
                Stagger — Wave {wavesRun}/{primaryWaveSchedule.waves.length}
              </span>
            ) : primaryEnded ? (
              <span className="text-muted">Primary ended</span>
            ) : (
              <span className="text-blue-400">Pre-Stagger Projection</span>
            )}
          </div>
        </div>
      </div>

      {/* Phase 4 — TierSelector chip strip at the top of the content area
          (US-only per D2; Senate/Gov/House are non-clickable placeholders
          per D3). The Calendar + CarveUpPanel grid sits below the tier strip;
          map clicks update the same selection via the shared `?state=` URL
          param so map and calendar stay in sync per the §"Acceptance" rule. */}
      <div className="mb-4">
        <PrimaryShellClient
          viewModel={primaryViewModel}
          selectedStateId={selectedStateId}
          partyColor={partyColor}
          countryId="US"
          winnerColorByState={winnerColorByState}
          partyIdForDetailLinks={partyId}
          turnsToEnd={displayTurnsToEnd}
        />
      </div>

      {nextWave && (
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
          <span className="font-semibold text-amber-400">Next wave:</span> {nextWave.label} —{" "}
          {nextWave.states.join(", ")}
        </div>
      )}

      {candidates.length === 0 && (
        <div className="mb-4 rounded-xl border border-dashed border-card-border p-6 sm:p-8 text-center">
          <p className="text-sm font-medium text-foreground">
            No candidates have entered this primary yet.
          </p>
          <p className="mt-2 text-xs text-muted">
            The calendar, map, and standings will populate once candidates file into the race.
          </p>
          <Link
            href={`/elections/${election._id.toString()}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Open the race page to enter →
          </Link>
        </div>
      )}

      {viewerCandidate && viewerChar && (
        <div className="mb-4">
          <PrimaryCampaignControls
            electionId={election._id.toString()}
            currentCampaignState={viewerCandidate.primaryCampaignState ?? null}
            currentTicks={viewerCandidate.primaryCampaignTicks ?? 0}
            tickCap={PRIMARY_CAMPAIGN_TICK_CAP}
            homeState={viewerChar.homeState ?? null}
            surgeUsed={viewerCandidate.primarySurgeUsed ?? false}
            playerActions={viewerChar.actions ?? 0}
            playerFunds={viewerChar.funds ?? 0}
            surgeCostFunds={PRIMARY_HOME_SURGE_COST_FUNDS}
            surgeCostActions={PRIMARY_HOME_SURGE_COST_ACTIONS}
            surgeBoost={PRIMARY_HOME_SURGE_PCT}
            states={STATE_IDS.map((id) => ({
              id,
              name: id,
              actionCost: getTravelActionCost(id, apportionmentPreset),
            }))}
          />
        </div>
      )}

      {viewerChar?.countryId === "US" && (
        <div className="mb-4 rounded-xl border border-card-border bg-card p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Campaign Presence</h3>
              <p className="mt-1 text-xs text-muted">
                Per-state infrastructure you build across cycles. Maxing a state is +25% primary
                vote weight there, independent of party-wide org.
              </p>
            </div>
            <Link
              href={`/elections/${election._id.toString()}#state-org`}
              className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
            >
              Open builder
            </Link>
          </div>
        </div>
      )}

      <PrimaryMapWithLinks
        partyId={partyId}
        stateData={stateData}
        waveHighlight={nextWave?.states}
        header={
          <div className="flex flex-wrap items-center gap-4 px-2">
            <span className="text-xs text-muted uppercase tracking-wider">Delegate leaders:</span>
            {standings.slice(0, 4).map((s, i) => (
              <div key={s.candidate._id.toString()} className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: colorForCandidate(s.candidate._id.toString()) }}
                />
                <span
                  className={`text-sm font-medium ${i === 0 ? "text-foreground" : "text-muted"}`}
                >
                  {s.candidate.characterName}:{" "}
                  <span className="tabular-nums">{s.projectedDelegates.toLocaleString()}</span>
                  {s.awardedDelegates > 0 && (
                    <span className="ml-1 text-xs text-muted">
                      ({s.awardedDelegates.toLocaleString()} awarded)
                    </span>
                  )}
                  {i === 0 && standings.length > 1 && (
                    <span className="ml-1 text-xs text-green-500 font-normal">(leading)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        }
        footer={
          <div className="rounded-xl border border-card-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold text-foreground">Map legend</h3>
            <div className="mb-2 flex flex-wrap gap-3 text-xs">
              {standings.map((s) => (
                <span key={s.candidate._id.toString()} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: colorForCandidate(s.candidate._id.toString()) }}
                  />
                  <span className="text-muted">{s.candidate.characterName}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-muted">
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-foreground/70" />
                Solid — state voted
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-foreground/70 opacity-70" />
                Translucent — projected leader (state has not voted yet)
              </span>
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-[#2a2a2a]" />
                No projection available
              </span>
            </div>
            <p className="mt-3 text-[11px] text-muted/70">
              Use the <strong>Leader</strong>/<strong>Delegates</strong> toggle above to switch
              between projected/actual winners and per-state delegate counts. Delegates mode uses
              the same state-by-state allocation math shown above; once a state votes, its awarded
              delegates lock in while the remaining states keep projecting forward through the final{" "}
              {primaryWaveSchedule.windowTurns} turns.
            </p>
          </div>
        }
      />

      {candidates.length > 0 && (
        <div className="mt-6 rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-card-border bg-background text-xs font-medium uppercase tracking-wider text-muted">
            Standings
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-card-border bg-background text-left text-xs font-medium uppercase tracking-wider text-muted">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Candidate</th>
                  <th className="px-3 py-2 text-right">Proj. Del.</th>
                  <th className="px-3 py-2 text-right">Awarded</th>
                  <th
                    className="px-3 py-2 text-right"
                    title="National vote share — sum of projected/actual votes across every state, divided by the total. This is what every state-level vote percentage aggregates to."
                  >
                    Vote %
                  </th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Delegate share — projected delegates divided by total delegates. Diverges from vote share when winner-take-all states sweep all delegates to a narrow leader."
                  >
                    Del. Share
                  </th>
                  <th className="px-3 py-2 text-right">Fav.</th>
                  <th className="px-3 py-2 text-right">NI</th>
                  <th className="px-3 py-2 text-right">Endorsed</th>
                  <th className="px-3 py-2">Campaigning In</th>
                  {viewerIsLoggedInWithCharacter && viewerInParty && (
                    <th className="px-3 py-2 text-right">Endorse</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {standings.map((s, i) => {
                  const delegateShare = s.nationalDelegateSharePct.toFixed(1);
                  const voteShare = s.nationalVoteSharePct.toFixed(1);
                  return (
                    <tr key={s.candidate._id.toString()}>
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
                            s.candidate.isNPP
                              ? `/politicians/npp/${s.candidate.nppId}`
                              : `/character/${s.candidate.characterId}`
                          }
                          className="font-semibold hover:text-primary transition-colors"
                        >
                          {s.candidate.characterName}
                        </Link>
                        {s.candidate.isNPP && (
                          <span className="ml-2 rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                            NPP
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                        {s.projectedDelegates.toLocaleString()}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {s.awardedDelegates > 0 ? s.awardedDelegates.toLocaleString() : "0"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {voteShare}%
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {delegateShare}%
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {s.favorability != null ? `${s.favorability.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {s.nationalInfluence != null ? s.nationalInfluence.toFixed(0) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                        {s.endorsements > 0 ? (
                          <span style={{ color: partyColor }} className="font-medium">
                            {s.endorsements}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {s.campaignState ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
                            📍 {s.campaignState}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      {viewerIsLoggedInWithCharacter && viewerInParty && (
                        <td className="px-3 py-2.5 text-right">
                          <EndorseButton
                            electionId={election._id.toString()}
                            candidateId={s.candidate._id.toString()}
                            alreadyEndorsed={
                              viewerEndorsedCandidateId === s.candidate._id.toString()
                            }
                            viewerEndorsedCandidateId={viewerEndorsedCandidateId}
                            partyColor={partyColor}
                            canEndorse={
                              viewerChar !== null &&
                              // Can't endorse yourself
                              !(
                                !s.candidate.isNPP &&
                                s.candidate.characterId &&
                                viewerChar._id.toString() === s.candidate.characterId.toString()
                              )
                            }
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Projected delegate race — stacked bar. Only shown when there's an
          active candidate roster; the bar is meaningless on an empty
          primary and would render as just the threshold marker on a black
          background. */}
      {candidates.length > 0 && (
        <div className="mt-6 rounded-xl border border-card-border bg-card p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Projected delegate race</h3>
            <span className="text-xs text-muted">
              {majorityThreshold.toLocaleString()} to clinch · {totalDelegates.toLocaleString()}{" "}
              total
            </span>
          </div>
          <div className="relative h-10 rounded-lg overflow-hidden border border-card-border bg-background flex">
            {standings.map((s) => {
              const pct = totalDelegates > 0 ? (s.projectedDelegates / totalDelegates) * 100 : 0;
              if (pct === 0) return null;
              const color = colorForCandidate(s.candidate._id.toString());
              return (
                <div
                  key={s.candidate._id.toString()}
                  className="h-full flex items-center justify-center"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                  title={`${s.candidate.characterName}: ${s.projectedDelegates.toLocaleString()} projected delegates`}
                >
                  {pct > 6 && (
                    <span className="text-white font-bold text-xs tabular-nums drop-shadow">
                      {s.projectedDelegates.toLocaleString()}
                    </span>
                  )}
                </div>
              );
            })}
            {/* Majority threshold marker */}
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
            {standings.map((s) => (
              <div key={s.candidate._id.toString()} className="flex items-center gap-1.5">
                <div
                  className="h-3 w-3 rounded-sm shrink-0"
                  style={{ backgroundColor: colorForCandidate(s.candidate._id.toString()) }}
                />
                <span className="text-xs font-medium text-foreground">
                  {s.candidate.characterName}
                </span>
                <span
                  className="text-xs tabular-nums font-bold"
                  style={{ color: colorForCandidate(s.candidate._id.toString()) }}
                >
                  {s.projectedDelegates.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The old "Primary schedule" panel was removed — the PrimaryCalendar
          at the top of the page (rendered by PrimaryShellClient) covers
          the same data with the per-wave T-X label, voted/upcoming chips,
          and party-color accent. Keeping both surfaces in sync was just
          duplication. */}
    </div>
  );
}
