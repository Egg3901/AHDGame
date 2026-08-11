import { CDN_LOGO_URL } from "@/lib/images/staticCdnAssets";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/mongodb";
import BackButton from "@/components/BackButton";
import { PartyRegimeBadge } from "@/components/parties/PartyRegimeBadge";
import type { PoliticalParty } from "@/lib/db/types";
import { getPartyHex } from "@/lib/utils/politics";
import { buildCandidateColorMap } from "@/lib/campaigns/candidateColor";
import { getSiteUrl } from "@/lib/siteMetadata";
import {
  loadTierPrimaryAggregate,
  type LowerTier,
  type TierPrimaryAggregateCandidate,
} from "@/lib/elections/tierPrimaryAggregator";
import { type PrimaryStateData } from "@/components/PrimaryElectoralMap";
import { ELECTORAL_VOTE_UNITS } from "@/lib/constants/states";
import { LowerTierPrimaryShell } from "./LowerTierPrimaryShell";
import { HousePrimaryDistrictDrilldown } from "./HousePrimaryDistrictDrilldown";

// Per-party primary tier surfaces share the presidential primary's "live
// numbers may change every turn" property, so disable per-request caching.
export const dynamic = "force-dynamic";

const VALID_TIERS: ReadonlySet<string> = new Set(["senate", "stateSenate", "governor", "house"]);
const US_STATE_IDS = [...new Set(ELECTORAL_VOTE_UNITS.map((u) => u.stateId))];

interface PageProps {
  params: Promise<{ tier: string; partyId: string }>;
  searchParams?: Promise<{ state?: string }>;
}

const TIER_LABEL: Record<LowerTier, string> = {
  senate: "Senate",
  stateSenate: "State Senate",
  governor: "Gubernatorial",
  house: "House",
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { tier, partyId } = await params;
  if (!VALID_TIERS.has(tier)) return {};
  const tierLabel = TIER_LABEL[tier as LowerTier];

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

  const title = `${party.name} ${tierLabel} Primary | A House Divided`;
  const description = `State-by-state ${tierLabel.toLowerCase()} primary leaders for the ${party.name}.`;
  const url = `${getSiteUrl()}/elections/primary/${tier}/${partyId}`;
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

export default async function TierPrimaryPage({ params, searchParams }: PageProps) {
  const { tier, partyId } = await params;
  if (!VALID_TIERS.has(tier)) notFound();
  const lowerTier = tier as LowerTier;

  const sp = (await searchParams) ?? {};
  const requestedState = sp.state?.toUpperCase();

  const db = await getDb();
  const sequentialId = Number(partyId);
  let party: PoliticalParty | null = null;
  if (Number.isFinite(sequentialId)) {
    party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId: "US", sequentialId });
  }
  if (!party) {
    party = await db
      .collection<PoliticalParty>("politicalParties")
      .findOne({ countryId: "US", abbreviation: partyId });
  }
  if (!party) notFound();

  const partyKey = party.sequentialId.toString();
  const partyColor = getPartyHex(party.abbreviation ?? partyKey, party.color);

  const aggregate = await loadTierPrimaryAggregate(db, "US", lowerTier, partyKey);

  // Build a **per-state** candidate-color map. Candidates only run in one
  // state's primary, and the state primary detail page (/elections/<seatId>)
  // builds its own per-state color map from that state's candidates only.
  // Building one tier-wide color map instead would assign different slots
  // based on whichever sorted neighbour set was passed in — so a candidate
  // would get color A on the state page and color B on this aggregator
  // page. Matching the state-page logic state-by-state keeps colors
  // consistent across both surfaces.
  const colorByCandidate: Record<string, string> = {};
  for (const [stateId, contest] of Object.entries(aggregate.byState)) {
    void stateId;
    const stateColorMap = buildCandidateColorMap(
      contest.candidates.map((c) => ({ candidateId: c.candidateId, campaignColor: null })),
      party.abbreviation ?? partyKey,
      party.color
    );
    for (const [cid, color] of Object.entries(stateColorMap)) {
      colorByCandidate[cid] = color;
    }
  }
  const colorForCandidate = (candidateId: string | null): string =>
    candidateId ? (colorByCandidate[candidateId] ?? partyColor) : "#2a2a2a";

  // Map fill: states with no party-candidate filings render neutral grey.
  // States with filings but no votes yet (primary hasn't started) render in
  // the party color at reduced contrast — "contest exists, no leader yet"
  // is a real third state distinct from both "no contest" and "leader
  // resolved". Only states with at least one vote cast paint the actual
  // leader's per-candidate color.
  const stateMapData: Record<string, PrimaryStateData> = {};
  for (const stateId of US_STATE_IDS) {
    const contest = aggregate.byState[stateId];
    if (!contest || contest.candidates.length === 0) {
      stateMapData[stateId] = {
        color: "#2a2a2a",
        label: stateId,
        tooltip: ["No active primary in this state."],
      };
      continue;
    }
    // Use the contest's leader (sorted by sharePct desc in the aggregator),
    // and surface each candidate's projected/live sharePct in the tooltip —
    // matches what the state primary detail page renders on its progress
    // bars. No more NaN when there are no votes; the projection drives the
    // display.
    const leader = contest.candidates[0]!;
    const tooltip = [
      contest.hasResults ? "Live primary tally:" : "Projected primary share:",
      ...contest.candidates.slice(0, 4).map((c) => {
        return `${c.candidateName} — ${c.sharePct.toFixed(1)}%`;
      }),
    ];
    stateMapData[stateId] = {
      color: colorForCandidate(leader.candidateId),
      phase: contest.hasResults ? "actual" : "projected",
      label: stateId,
      tooltip,
    };
  }

  // Per-state contest summary with stable colors applied per candidate.
  const contestsByState: Record<
    string,
    {
      stateId: string;
      electionId: string;
      hasResults: boolean;
      totalSeats: number;
      candidates: Array<{
        candidateId: string;
        candidateName: string;
        votes: number;
        sharePct: number;
        color: string;
        isNPP: boolean;
        characterId: string | null;
        nppId: string | null;
      }>;
    }
  > = {};
  for (const [stateId, contest] of Object.entries(aggregate.byState)) {
    contestsByState[stateId] = {
      stateId,
      electionId: contest.electionId,
      hasResults: contest.hasResults,
      totalSeats: contest.totalSeats,
      candidates: contest.candidates.map((c: TierPrimaryAggregateCandidate) => ({
        candidateId: c.candidateId,
        candidateName: c.candidateName,
        votes: c.votes,
        sharePct: c.sharePct,
        color: colorForCandidate(c.candidateId),
        isNPP: c.isNPP,
        characterId: c.characterId,
        nppId: c.nppId,
      })),
    };
  }

  // Per-state leader rows — what the side table actually wants to show.
  // Aggregating votes across every state's primary (the old "standings"
  // table) was meaningless because each candidate only runs in their own
  // state — totals just listed every filed candidate at their state's vote
  // count with no comparison context.
  const stateLeaderRows = Object.entries(contestsByState)
    .map(([stateId, contest]) => {
      const leader = contest.candidates[0] ?? null;
      return {
        stateId,
        leader,
        totalVotes: contest.candidates.reduce((s, c) => s + c.votes, 0),
        hasResults: contest.hasResults,
        totalSeats: contest.totalSeats,
      };
    })
    .sort((a, b) => a.stateId.localeCompare(b.stateId));

  // Default selection: honor `?state=` when valid; otherwise pick the first
  // state alphabetically that has at least one party candidate. Falls back
  // to null when no active contests exist, which the shell renders as the
  // "no contests" empty-state message.
  const activeStateIds = Object.keys(contestsByState).sort();
  const selectedStateId =
    requestedState && contestsByState[requestedState]
      ? requestedState
      : (activeStateIds[0] ?? null);

  const tierLabel = TIER_LABEL[lowerTier];
  const totalActiveContests = Object.keys(contestsByState).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <BackButton
            fallbackLabel="Back to presidential primary"
            fallbackHref={`/president/primary/${partyId}`}
          />
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold" style={{ color: partyColor }}>
              {party.name} {tierLabel} Primary
            </h1>
            <PartyRegimeBadge regimeStatus={party.regimeStatus} />
          </div>
          <p className="text-sm text-muted">
            {totalActiveContests === 0
              ? `No active ${tierLabel.toLowerCase()} primaries for this party right now.`
              : `${totalActiveContests} state${totalActiveContests === 1 ? "" : "s"} with active ${tierLabel.toLowerCase()} primary contests.`}
          </p>
        </div>
      </div>

      <LowerTierPrimaryShell
        tier={lowerTier}
        partyId={partyId}
        partyColor={partyColor}
        countryId="US"
        stateMapData={stateMapData}
        contestsByState={contestsByState}
        selectedStateId={selectedStateId}
        stateLeaderRows={stateLeaderRows}
        emptyMessage={
          totalActiveContests === 0
            ? `No active ${tierLabel.toLowerCase()} primaries to show. Check back when the next ${tierLabel.toLowerCase()} cycle opens.`
            : "Click a state on the map to see its primary leaders."
        }
        districtSlot={
          lowerTier === "house" && selectedStateId ? (
            <HousePrimaryDistrictDrilldown
              key={`house-drilldown-${selectedStateId}`}
              stateId={selectedStateId}
              electionId={contestsByState[selectedStateId]?.electionId ?? null}
              candidateColors={Object.fromEntries(
                (contestsByState[selectedStateId]?.candidates ?? []).map((c) => [
                  c.candidateId,
                  c.color,
                ])
              )}
              candidateNames={Object.fromEntries(
                (contestsByState[selectedStateId]?.candidates ?? []).map((c) => [
                  c.candidateId,
                  c.candidateName,
                ])
              )}
              leaderCandidateId={
                contestsByState[selectedStateId]?.candidates[0]?.candidateId ?? null
              }
              leaderMargin={
                (contestsByState[selectedStateId]?.candidates[0]?.sharePct ?? 0) -
                (contestsByState[selectedStateId]?.candidates[1]?.sharePct ?? 0)
              }
            />
          ) : null
        }
      />
    </div>
  );
}
