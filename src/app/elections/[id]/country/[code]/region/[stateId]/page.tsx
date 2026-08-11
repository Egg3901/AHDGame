"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import { CountyMap } from "@/components/CountyMap";
import { SubdivisionMap } from "@/components/SubdivisionMap";
import { DistrictCardGrid } from "@/components/redistricting/DistrictCardGrid";
import type { DistrictSquareView } from "@/lib/redistricting/districtSquareResponse";
import { resolveElectionYear } from "@/lib/utils/formatters";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { DEFAULT_CYCLE_ANCHOR_CONTEXT } from "@/lib/elections/cycleAnchorContext";
import { UK_REGION_NAMES, RU_REGION_NAMES } from "@/lib/constants/states";

interface Election {
  _id: string;
  /** US union values plus UK types ("commons", "snap_commons", "regionalCouncil", …). */
  electionType: string;
  state?: string;
  cycle: number;
  status: string;
  generalVotes?: {
    electoralMapData?: Record<string, { color: string; label: string; tooltip: string[] }>;
  };
}

interface CountyResult {
  fips: string;
  name: string;
  path: string;
  votes: Record<string, number>;
  margin: number;
  winner: string;
  cookPVI: number;
  population: number;
}

interface CDResult {
  cd: string;
  path: string;
  winner: string;
  party: string;
  margin: number;
  cookPVI: number;
}

interface CountyResultsData {
  viewBox: string;
  counties: CountyResult[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
}

interface CDResultsData {
  viewBox: string;
  districts: CDResult[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
}

interface SubdivisionResultEntry {
  id: string;
  name: string;
  path: string;
  votes: Record<string, number>;
  margin: number;
  winner: string;
  leanScalar?: number;
  electorate?: number;
  /** Seat-ordered (CD) responses only: winner's party key. */
  party?: string;
}

interface SubdivisionResultsData {
  viewBox: string;
  mode: string;
  unitLabel?: string;
  unitLabelPlural?: string;
  subdivisions: SubdivisionResultEntry[];
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
  seatsByCandidate?: Record<string, number>;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

const DEFAULT_PARTY_COLORS: Record<string, string> = {
  democrat: "#3B82F6",
  republican: "#EF4444",
  independent: "#9CA3AF",
};

function getColor(party: string, partyColors?: Record<string, string>): string {
  const key = party.toLowerCase();
  return partyColors?.[key] ?? DEFAULT_PARTY_COLORS[key] ?? DEFAULT_PARTY_COLORS.independent;
}

// Multi-slice donut for vote summary
function VoteDonut({
  candidates,
  totalVotes,
  candidateParties,
  candidateNames,
  partyColors,
}: {
  candidates: [string, number][];
  totalVotes: number;
  candidateParties: Record<string, string>;
  candidateNames: Record<string, string>;
  partyColors?: Record<string, string>;
}) {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const r = 60;
  const innerR = 38;

  let cumAngle = -Math.PI / 2;
  const slices = candidates.map(([cid, votes]) => {
    const frac = totalVotes > 0 ? votes / totalVotes : 0;
    const angle = frac * 2 * Math.PI;
    const start = cumAngle;
    // eslint-disable-next-line react-hooks/immutability
    cumAngle += angle;
    return { cid, votes, frac, startAngle: start, endAngle: cumAngle };
  });

  function arcPath(startAngle: number, endAngle: number, outerR: number, innerR: number) {
    const x1 = cx + outerR * Math.cos(startAngle);
    const y1 = cy + outerR * Math.sin(startAngle);
    const x2 = cx + outerR * Math.cos(endAngle);
    const y2 = cy + outerR * Math.sin(endAngle);
    const ix1 = cx + innerR * Math.cos(endAngle);
    const iy1 = cy + innerR * Math.sin(endAngle);
    const ix2 = cx + innerR * Math.cos(startAngle);
    const iy2 = cy + innerR * Math.sin(startAngle);
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${large} 0 ${ix2} ${iy2} Z`;
  }

  const winner = candidates[0];
  const winnerName = candidateNames[winner[0]] ?? "—";
  const winnerPct = totalVotes > 0 ? ((winner[1] / totalVotes) * 100).toFixed(1) : "0";

  return (
    <div className="flex items-center gap-6">
      <svg width={size} height={size} className="shrink-0">
        {slices.map((s) => {
          const party = (candidateParties[s.cid] ?? "independent").toLowerCase();
          const color = getColor(party, partyColors);
          if (s.frac < 0.001) return null;
          return (
            <path
              key={s.cid}
              d={arcPath(s.startAngle, s.endAngle, r, innerR)}
              fill={color}
              stroke="#0f172a"
              strokeWidth={1}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={innerR - 2} fill="#0f172a" />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize={14} fontWeight={700}>
          {winnerPct}%
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#94a3b8" fontSize={9}>
          {winnerName.split(" ").slice(-1)[0]}
        </text>
      </svg>
      <div className="flex-1 space-y-2 min-w-0">
        {candidates.map(([cid, votes]) => {
          const party = (candidateParties[cid] ?? "independent").toLowerCase();
          const color = getColor(party, partyColors);
          const name = candidateNames[cid] ?? "Unknown";
          const pct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
          return (
            <div key={cid}>
              <div className="flex items-center justify-between mb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-sm font-medium truncate">{name}</span>
                </div>
                <span className="text-sm text-muted ml-2 shrink-0">{pct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-card-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StateElectionResultsPage({
  params,
}: {
  params: Promise<{ id: string; code: string; stateId: string }>;
}) {
  const { id, code, stateId } = use(params);
  const dbStateId = stateId.toUpperCase();
  const stateUpper = dbStateId;
  const { navData } = useAuthMe();
  const viewerPartySeqId = navData?.currentParty?.id;

  const [election, setElection] = useState<Election | null>(null);
  const [countyResults, setCountyResults] = useState<CountyResultsData | null>(null);
  const [subdivisionResults, setSubdivisionResults] = useState<SubdivisionResultsData | null>(null);
  const [cdResults, setCDResults] = useState<CDResultsData | null>(null);
  const [districtSquares, setDistrictSquares] = useState<DistrictSquareView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Preset-aware year — pulls from live turn status so 1991 games show
  // 1992-era election labels and 2019 games show 2024 GE. MUST sit above
  // the `loading` / `error` early-returns below, otherwise React reports a
  // "rendered more hooks than during the previous render" violation when
  // the loading state flips.
  const turnStatus = useGameTurnStatus();
  const cycleCtx = {
    startingYear: turnStatus?.startingYear ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.startingYear,
    preset: turnStatus?.preset ?? DEFAULT_CYCLE_ANCHOR_CONTEXT.preset,
  };

  useEffect(() => {
    async function fetchData() {
      try {
        const electionRes = await fetch(`/api/elections?id=${encodeURIComponent(id)}&view=full`);
        if (!electionRes.ok) {
          setError("Election not found");
          setLoading(false);
          return;
        }
        const wrapper = await electionRes.json();
        const electionData: Election = wrapper.election;
        setElection(electionData);

        const isUS = code.toUpperCase() === "US";
        if (!isUS) {
          // Non-US: the subdivision registry decides which election types are
          // supported — an unsupported type just 404s into the error state.
          const subRes = await fetch(
            `/api/elections/${id}/state/${stateUpper}/subdivision-results`
          );
          if (subRes.ok) {
            setSubdivisionResults(await subRes.json());
          } else {
            setError("Subdivision data not available");
          }
          setLoading(false);
          return;
        }

        const useCountyMap = ["president", "governor", "senate"].includes(
          electionData.electionType
        );
        if (useCountyMap) {
          const countyRes = await fetch(
            `/api/elections/${id}/state/${stateUpper}/subdivision-results`
          );
          if (countyRes.ok) {
            // Adapt the generic subdivision shape to the legacy county shape the
            // US rendering below consumes (fips/population/cookPVI naming).
            const sub: SubdivisionResultsData = await countyRes.json();
            setCountyResults({
              viewBox: sub.viewBox,
              counties: sub.subdivisions.map((s) => ({
                fips: s.id,
                name: s.name,
                path: s.path,
                votes: s.votes,
                margin: s.margin,
                winner: s.winner,
                cookPVI: s.leanScalar ?? 0,
                population: s.electorate ?? 0,
              })),
              candidateNames: sub.candidateNames,
              candidateParties: sub.candidateParties,
              partyColors: sub.partyColors,
            });
          } else {
            setError("County data not available");
          }
        } else {
          const cdRes = await fetch(`/api/elections/${id}/state/${stateUpper}/subdivision-results`);
          if (cdRes.ok) {
            // Adapt the generic seat-ordered shape to the legacy CD shape the
            // rendering below consumes (cd/cookPVI naming).
            const sub: SubdivisionResultsData = await cdRes.json();
            setCDResults({
              viewBox: sub.viewBox,
              districts: sub.subdivisions.map((s) => ({
                cd: s.id,
                path: s.path,
                winner: s.winner,
                party: s.party ?? "independent",
                margin: s.margin,
                cookPVI: s.leanScalar ?? 0,
              })),
              candidateNames: sub.candidateNames,
              candidateParties: sub.candidateParties,
              partyColors: sub.partyColors,
            });
          } else {
            setError("Congressional district data not available");
          }
          // Live square overlay (present only when redistrictingEnabled). Failure
          // is non-fatal — the page falls back to the legacy district map.
          try {
            const sqRes = await fetch(`/api/congressional-districts/${stateUpper}`);
            if (sqRes.ok) {
              const sqData = (await sqRes.json()) as {
                redistricting?: { enabled: boolean; districts: DistrictSquareView[] };
              };
              if (sqData.redistricting?.enabled) {
                setDistrictSquares(sqData.redistricting.districts);
              }
            }
          } catch {
            // ignore — legacy map remains
          }
        }
      } catch {
        setError("Failed to load election data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id, stateUpper, code]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="h-8 w-64 bg-card-border animate-pulse rounded" />
          <div className="h-72 bg-card-border animate-pulse rounded" />
          <div className="h-48 bg-card-border animate-pulse rounded" />
        </div>
      </div>
    );
  }

  if (error || !election) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4">
            <p className="text-red-500">{error || "Election not found"}</p>
          </div>
          <Link
            href={`/elections/${id}`}
            className="mt-4 inline-block text-primary hover:underline"
          >
            ← Back to Election
          </Link>
        </div>
      </div>
    );
  }

  const stateName =
    STATE_NAMES[stateUpper] ||
    UK_REGION_NAMES[stateUpper] ||
    RU_REGION_NAMES[stateUpper] ||
    stateUpper;
  const electionYear = resolveElectionYear(election, cycleCtx);
  const electionTypeLabel: Record<string, string> = {
    president: "Presidential Election",
    governor: "Gubernatorial Election",
    senate: "Senate Election",
    house: "House Election",
    commons: "General Election",
    snap_commons: "Snap General Election",
    regionalCouncil: "Regional Council Election",
    supremeSovietDeputy: "Supreme Soviet Election",
    nationalitiesDeputy: "Soviet of Nationalities Election",
    republicSupremeSoviet: "Republic Supreme Soviet Election",
  };
  const electionTypeTitle = electionTypeLabel[election.electionType] ?? election.electionType;
  const unitLabel = subdivisionResults?.unitLabel ?? "Subdivision";
  const unitLabelPlural = subdivisionResults?.unitLabelPlural ?? "Subdivisions";
  const resultScopeLabel = subdivisionResults
    ? `${unitLabel}-Level Results`
    : election.electionType === "house"
      ? "Congressional District Results"
      : "County-Level Results";
  const isPresidential = election.electionType === "president";

  const backgroundStateColors: Record<string, string> | undefined =
    isPresidential && election.generalVotes?.electoralMapData
      ? Object.fromEntries(
          Object.entries(election.generalVotes.electoralMapData)
            .filter(([, data]) => data.color && data.color !== "#1e293b")
            .map(([sId, data]) => [sId, data.color])
        )
      : undefined;

  // Aggregate candidate vote totals
  const candidateVotes: Record<string, number> = {};
  if (countyResults) {
    for (const county of countyResults.counties) {
      for (const [cid, votes] of Object.entries(county.votes)) {
        candidateVotes[cid] = (candidateVotes[cid] || 0) + votes;
      }
    }
  }
  if (subdivisionResults) {
    for (const sub of subdivisionResults.subdivisions) {
      for (const [cid, votes] of Object.entries(sub.votes)) {
        candidateVotes[cid] = (candidateVotes[cid] || 0) + votes;
      }
    }
  }
  const totalVotes = Object.values(candidateVotes).reduce((s, v) => s + v, 0);
  const sortedCandidates = Object.entries(candidateVotes).sort(([, a], [, b]) => b - a);

  // Subdivision (constituency) table — sorted by total votes desc
  const subdivisionTableRows = subdivisionResults
    ? [...subdivisionResults.subdivisions]
        .map((s) => ({ ...s, subTotal: Object.values(s.votes).reduce((a, v) => a + v, 0) }))
        .sort((a, b) => b.subTotal - a.subTotal)
    : [];
  const seatChips = subdivisionResults?.seatsByCandidate
    ? Object.entries(subdivisionResults.seatsByCandidate)
        .filter(([, seats]) => seats > 0)
        .sort(([, a], [, b]) => b - a)
    : [];
  const vacantCount = subdivisionResults
    ? subdivisionResults.subdivisions.filter((s) => !s.winner).length
    : 0;

  // County table — sorted by total votes desc
  const countyTableRows = countyResults
    ? [...countyResults.counties]
        .map((c) => {
          const countyTotal = Object.values(c.votes).reduce((s, v) => s + v, 0);
          const turnoutPct = c.population > 0 ? (countyTotal / c.population) * 100 : 0;
          return { ...c, countyTotal, turnoutPct };
        })
        .sort((a, b) => b.countyTotal - a.countyTotal)
    : [];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        {/* Header */}
        <div>
          <Link
            href={`/elections/${id}`}
            className="text-sm text-primary hover:underline mb-2 inline-block"
          >
            ← Back to Election
          </Link>
          <h1 className="text-3xl font-bold">
            {electionYear} {electionTypeTitle} in {stateName}
          </h1>
          <p className="text-muted mt-1">
            {resultScopeLabel} · {election.status === "completed" ? "Final" : "In Progress"}
          </p>
        </div>

        {/* Map + Vote Summary side by side */}
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* Map */}
          <div className="rounded-lg border border-card-border bg-card p-4">
            <h2 className="text-base font-semibold mb-3">
              {countyResults
                ? "County Results"
                : subdivisionResults
                  ? `${unitLabel} Results`
                  : "Congressional District Results"}
            </h2>
            <div className="h-[min(70vh,640px)] min-h-[320px] w-full">
              {subdivisionResults && (
                <SubdivisionMap
                  viewBox={subdivisionResults.viewBox}
                  subdivisions={subdivisionResults.subdivisions}
                  candidateNames={subdivisionResults.candidateNames}
                  candidateParties={subdivisionResults.candidateParties}
                  partyColors={subdivisionResults.partyColors}
                />
              )}
              {countyResults && (
                <CountyMap
                  viewBox={countyResults.viewBox}
                  counties={countyResults.counties}
                  candidateNames={countyResults.candidateNames}
                  candidateParties={countyResults.candidateParties}
                  partyColors={countyResults.partyColors}
                  showBackgroundMap={true}
                  backgroundStateColors={backgroundStateColors}
                />
              )}
              {cdResults &&
                (districtSquares ? (
                  <div className="h-full overflow-auto">
                    <DistrictCardGrid
                      districts={districtSquares}
                      redistrictHref={`/country/${code.toLowerCase()}/region/${stateUpper.toLowerCase()}/redistrict`}
                      campaign={
                        viewerPartySeqId
                          ? { countryId: code, stateId: stateUpper, partySeqId: viewerPartySeqId }
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <SubdivisionMap
                    viewBox={cdResults.viewBox}
                    subdivisions={cdResults.districts.map((d) => ({
                      id: d.cd,
                      name: d.cd,
                      path: d.path,
                      winner: d.winner,
                      party: d.party,
                      margin: d.margin,
                      leanScalar: d.cookPVI,
                    }))}
                    candidateNames={cdResults.candidateNames}
                    candidateParties={cdResults.candidateParties}
                    partyColors={cdResults.partyColors}
                    showBackgroundMap={true}
                    fitToParent={true}
                  />
                ))}
            </div>
          </div>

          {/* Vote Summary with donut */}
          {(countyResults || subdivisionResults) && sortedCandidates.length > 0 && (
            <div className="rounded-lg border border-card-border bg-card p-4">
              <h2 className="text-base font-semibold mb-4">Vote Summary</h2>
              <VoteDonut
                candidates={sortedCandidates}
                totalVotes={totalVotes}
                candidateParties={(countyResults ?? subdivisionResults)!.candidateParties}
                candidateNames={(countyResults ?? subdivisionResults)!.candidateNames}
                partyColors={(countyResults ?? subdivisionResults)!.partyColors}
              />
              <div className="mt-4 pt-4 border-t border-card-border text-xs text-muted space-y-1">
                <div className="flex justify-between">
                  <span>Total votes cast</span>
                  <span className="font-medium text-foreground">
                    {totalVotes.toLocaleString("en-US")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{countyResults ? "Counties reporting" : unitLabelPlural}</span>
                  <span className="font-medium text-foreground">
                    {countyResults
                      ? countyResults.counties.length
                      : subdivisionResults!.subdivisions.length}
                  </span>
                </div>
                {subdivisionResults && seatChips.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-card-border space-y-1">
                    {seatChips.map(([cid, seats]) => {
                      const party = (
                        subdivisionResults.candidateParties[cid] ?? "independent"
                      ).toLowerCase();
                      const color = getColor(party, subdivisionResults.partyColors);
                      return (
                        <div key={cid} className="flex items-center gap-1.5">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="truncate">
                            {subdivisionResults.candidateNames[cid] ?? "Unknown"}
                          </span>
                          <span className="ml-auto font-medium text-foreground">
                            {seats} seat{seats !== 1 ? "s" : ""}
                          </span>
                        </div>
                      );
                    })}
                    {vacantCount > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: "#4b5563" }}
                        />
                        <span>Vacant</span>
                        <span className="ml-auto font-medium text-foreground">{vacantCount}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CD seat distribution */}
          {cdResults && (
            <div className="rounded-lg border border-card-border bg-card p-4">
              <h2 className="text-base font-semibold mb-3">Seat Distribution</h2>
              <div className="space-y-2">
                {Object.entries(
                  cdResults.districts.reduce(
                    (acc, d) => {
                      acc[d.party] = (acc[d.party] || 0) + 1;
                      return acc;
                    },
                    {} as Record<string, number>
                  )
                ).map(([party, seats]) => {
                  const color = getColor(party, cdResults.partyColors);
                  return (
                    <div key={party} className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ backgroundColor: color }}
                      />
                      <span className="capitalize font-medium">{party}:</span>
                      <span>
                        {seats} seat{seats !== 1 ? "s" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Constituency breakdown table */}
        {subdivisionResults && subdivisionTableRows.length > 0 && (
          <div className="rounded-lg border border-card-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-card-border">
              <h2 className="text-base font-semibold">{unitLabel} Breakdown</h2>
              <p className="text-xs text-muted mt-0.5">
                Votes distributed by electorate &amp; local party strength · winners match the seat
                allocation · sorted by total votes
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border text-xs text-muted">
                    <th className="text-left px-5 py-2.5 font-medium">{unitLabel}</th>
                    <th className="text-left px-3 py-2.5 font-medium">Winner</th>
                    <th className="text-right px-3 py-2.5 font-medium">Margin</th>
                    <th className="text-right px-3 py-2.5 font-medium">Total Votes</th>
                    {sortedCandidates.slice(0, 3).map(([cid]) => (
                      <th
                        key={cid}
                        className="text-right px-3 py-2.5 font-medium truncate max-w-[80px]"
                      >
                        {(subdivisionResults.candidateNames[cid] ?? "").split(" ").slice(-1)[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/50">
                  {subdivisionTableRows.map((sub) => {
                    const winnerParty = (
                      subdivisionResults.candidateParties[sub.winner] ?? "independent"
                    ).toLowerCase();
                    const winnerColor = sub.winner
                      ? getColor(winnerParty, subdivisionResults.partyColors)
                      : "#4b5563";
                    const winnerName = sub.winner
                      ? (subdivisionResults.candidateNames[sub.winner] ?? "Unknown")
                      : "Vacant";
                    return (
                      <tr key={sub.id} className="hover:bg-card-elevated/40 transition-colors">
                        <td className="px-5 py-2.5 font-medium">{sub.name}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: winnerColor }}
                            />
                            <span className="text-xs">{winnerName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {sub.winner ? (
                            <span style={{ color: winnerColor }} className="font-medium">
                              {sub.margin >= 0 ? "+" : ""}
                              {sub.margin.toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted">
                          {sub.subTotal.toLocaleString("en-US")}
                        </td>
                        {sortedCandidates.slice(0, 3).map(([cid]) => {
                          const v = sub.votes[cid] ?? 0;
                          const pct = sub.subTotal > 0 ? (v / sub.subTotal) * 100 : 0;
                          const party = (
                            subdivisionResults.candidateParties[cid] ?? "independent"
                          ).toLowerCase();
                          const color = getColor(party, subdivisionResults.partyColors);
                          return (
                            <td key={cid} className="px-3 py-2.5 text-right">
                              <span style={{ color }} className="text-xs font-medium">
                                {pct.toFixed(1)}%
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* County breakdown table */}
        {countyTableRows.length > 0 && (
          <div className="rounded-lg border border-card-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-card-border">
              <h2 className="text-base font-semibold">County Breakdown</h2>
              <p className="text-xs text-muted mt-0.5">
                Votes distributed by county population &amp; Cook PVI lean · sorted by total votes
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border text-xs text-muted">
                    <th className="text-left px-5 py-2.5 font-medium">County</th>
                    <th className="text-left px-3 py-2.5 font-medium">Winner</th>
                    <th className="text-right px-3 py-2.5 font-medium">Margin</th>
                    <th className="text-right px-3 py-2.5 font-medium">Total Votes</th>
                    <th className="text-right px-5 py-2.5 font-medium">Turnout</th>
                    {sortedCandidates.slice(0, 3).map(([cid]) => (
                      <th
                        key={cid}
                        className="text-right px-3 py-2.5 font-medium truncate max-w-[80px]"
                      >
                        {(countyResults!.candidateNames[cid] ?? "").split(" ").slice(-1)[0]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-card-border/50">
                  {countyTableRows.map((county) => {
                    const winnerParty = (
                      countyResults!.candidateParties[county.winner] ?? "independent"
                    ).toLowerCase();
                    const winnerColor = getColor(winnerParty, countyResults!.partyColors);
                    const winnerName = countyResults!.candidateNames[county.winner] ?? "Unknown";
                    return (
                      <tr key={county.fips} className="hover:bg-card-elevated/40 transition-colors">
                        <td className="px-5 py-2.5 font-medium">{county.name}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: winnerColor }}
                            />
                            <span className="text-xs">{winnerName}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span style={{ color: winnerColor }} className="font-medium">
                            +{county.margin.toFixed(1)}%
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted">
                          {county.countyTotal.toLocaleString("en-US")}
                        </td>
                        <td className="px-5 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-16 h-1.5 bg-card-border rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary/70"
                                style={{ width: `${Math.min(100, county.turnoutPct).toFixed(1)}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted w-10 text-right">
                              {county.turnoutPct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        {sortedCandidates.slice(0, 3).map(([cid]) => {
                          const v = county.votes[cid] ?? 0;
                          const pct = county.countyTotal > 0 ? (v / county.countyTotal) * 100 : 0;
                          const party = (
                            countyResults!.candidateParties[cid] ?? "independent"
                          ).toLowerCase();
                          const color = getColor(party, countyResults!.partyColors);
                          return (
                            <td key={cid} className="px-3 py-2.5 text-right">
                              <span style={{ color }} className="text-xs font-medium">
                                {pct.toFixed(1)}%
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
