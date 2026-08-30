"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { getMessageStyle, resolveElectionYear } from "@/lib/utils/formatters";
import { useElectionActions } from "@/hooks/useElectionActions";
import type { ElectionDisplay, CharacterBasic, GameStateDisplay } from "@/lib/db/types";
import type { ElectionResponse } from "@/lib/elections/resolveElection";
import { partiesApiUrl, countryElectionsUrl } from "@/lib/urls";
import {
  COUNTRY_CONFIGS,
  isParliamentarySystem,
  getRegionalExecutiveOfficeKey,
  type CountryId,
} from "@/lib/constants/countries";
import {
  getLowerChamberOfficeType,
  getUpperChamberOfficeType,
  getOfficeTypeForChamber,
} from "@/lib/legislature/chamberOfficeType";
import {
  buildElectionStateHref,
  buildElectionHref,
  electionRaceTitle,
  STATE_EV,
} from "./elections/electionHelpers";
import { logError } from "@/lib/utils/errorLog";
import { mapElectionResponseToDisplay } from "@/lib/elections/mapElectionResponseToDisplay";
import { BlendBallotSection } from "./elections/blend/BlendBallotSection";
import { WireTicker } from "./elections/blend/WireTicker";
import {
  buildBlendRegionCards,
  buildBlendWire,
  hareQuota,
  type PartyLookup,
  type RegionElectorate,
} from "@/lib/elections/blendRegionViewModel";

function toElectionDisplay(e: ElectionResponse): ElectionDisplay {
  return mapElectionResponseToDisplay(e);
}

interface StateElectionsProps {
  stateId: string;
  stateName: string;
  countryId?: string;
  /**
   * Region electorate for the turnout figures, carrying the basis it was
   * measured on. Worlds seeded without cohort vectors have no eligible count at
   * all and fall back to total population, which is a materially different
   * number — so the basis travels with it and the card says which one it is.
   */
  electorate?: RegionElectorate;
}

interface PartyInfo {
  id: string;
  name: string;
  /** Ballot abbreviation ("REP") — the Blend card's party column. */
  abbreviation: string;
  color: string;
  countryId: string;
}

interface PresidentialStateData {
  votes: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
}

export function StateElections({
  stateId,
  stateName,
  countryId: propCountryId,
  electorate,
}: StateElectionsProps) {
  const [elections, setElections] = useState<ElectionDisplay[]>([]);
  const [character, setCharacter] = useState<CharacterBasic | null>(null);
  const [_gameState, setGameState] = useState<GameStateDisplay | null>(null);
  const [parties, setParties] = useState<PartyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [presidentialStateData, setPresidentialStateData] = useState<
    Record<string, PresidentialStateData>
  >({});

  const countryId = propCountryId ?? "US";
  const regionLabel = COUNTRY_CONFIGS[countryId as CountryId]?.regionLabel ?? "State";

  /**
   * Party lookup for the Blend cards. The abbreviation is what the card's party
   * column prints, so it falls back to the full name and then the raw id rather
   * than rendering an empty cell for a party seeded without one.
   */
  const partyLookup = useMemo<PartyLookup>(() => {
    const find = (partyId: string) =>
      parties.find((p) => p.id === partyId && p.countryId === countryId);
    return {
      abbr: (partyId) => {
        if (partyId === "independent") return "IND";
        const party = find(partyId);
        return party?.abbreviation || party?.name || partyId;
      },
      name: (partyId) =>
        partyId === "independent" ? "Independent" : (find(partyId)?.name ?? partyId),
      color: (partyId) => find(partyId)?.color || "#9CA3AF",
    };
  }, [parties, countryId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const fetchOpts = { signal: AbortSignal.timeout(15_000) };
      const [electionsRes, presRes, charRes, partiesRes, gameStateRes] = await Promise.all([
        // `view=full` because the Blend cards are a results display: summary
        // mode returns `generalVotes: null`, so vote counts, turnout and the
        // per-turn deltas would all be missing. A region carries a handful of
        // races, unlike the country page which keeps summary for hundreds.
        fetch(
          `/api/elections?country=${countryId}&state=${stateId}&limit=100&view=full`,
          fetchOpts
        ),
        fetch(`/api/elections?country=${countryId}&type=president&limit=10&view=full`, fetchOpts),
        fetch("/api/character/me", fetchOpts),
        fetch(partiesApiUrl(countryId), fetchOpts),
        fetch("/api/game/turn/status", fetchOpts),
      ]);

      if (electionsRes.ok) {
        const electionsData = await electionsRes.json();
        const stateElections: ElectionDisplay[] = (electionsData.elections || []).map(
          toElectionDisplay
        );

        // Merge in presidential elections (deduplicate by id)
        if (presRes.ok) {
          const presData = await presRes.json();
          const existingIds = new Set(stateElections.map((e: ElectionDisplay) => e.id));
          for (const pe of (presData.elections || []).map(toElectionDisplay) as ElectionDisplay[]) {
            if (!existingIds.has(pe.id)) stateElections.push(pe);
          }
        }

        setElections(stateElections);
      }

      if (gameStateRes.ok) {
        const gsData = await gameStateRes.json();
        setGameState({
          isActive: gsData.isActive,
          pausedAt: gsData.pausedAt ?? null,
          lastTurnProcessed: gsData.lastTurnProcessed ?? null,
          currentYear: gsData.currentYear,
          currentTurn: gsData.currentTurn,
        });
      }

      if (charRes.ok) {
        const charData = await charRes.json();
        setCharacter(charData.character);
      }

      if (partiesRes.ok) {
        const partiesData = await partiesRes.json();
        setParties(
          partiesData.parties.map(
            (p: {
              id: string;
              name: string;
              abbreviation?: string;
              color: string;
              countryId?: string;
            }) => ({
              id: p.id,
              name: p.name,
              abbreviation: p.abbreviation ?? "",
              color: p.color,
              countryId: p.countryId ?? "US",
            })
          )
        );
      }
    } catch (err) {
      console.error("Error fetching data:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [stateId, countryId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch state-level PV data for presidential elections.
  //
  // General phase only, and that is load-bearing rather than an optimisation.
  // A presidential tally only carries `totalVotesByUnit` from the general
  // onward; during the primary the subdivision endpoint has no per-state
  // figures to work from and simply spreads the NATIONAL total across this one
  // region's map. Summing that back up returns the national total again, so
  // treating it as "this region's vote" would report the whole country's
  // primary vote as Georgia's, and divide it by Georgia's electorate for
  // turnout. Leaving it unfetched marks the card as nationwide instead, which
  // is what the figures actually are.
  useEffect(() => {
    const presElections = elections.filter((e) => e.electionType === "president" && !e.inPrimary);
    if (presElections.length === 0) return;
    // Fetch all elections' subdivision results in parallel and commit once —
    // one re-render for the list instead of one per completed fetch.
    Promise.all(
      presElections.map(async (pe) => {
        try {
          const r = await fetch(`/api/elections/${pe.id}/state/${stateId}/subdivision-results`, {
            signal: AbortSignal.timeout(15_000),
          });
          const data = r.ok ? await r.json() : null;
          if (!data) return null;
          const votes: Record<string, number> = {};
          for (const county of data.subdivisions ?? []) {
            for (const [cid, v] of Object.entries(county.votes as Record<string, number>)) {
              votes[cid] = (votes[cid] ?? 0) + v;
            }
          }
          return [
            pe.id,
            {
              votes,
              candidateNames: data.candidateNames,
              candidateParties: data.candidateParties,
              partyColors: data.partyColors,
            },
          ] as const;
        } catch (error) {
          logError(error, {
            component: "StateElections",
            action: "fetch presidential election county data",
            metadata: { electionId: pe.id, stateId },
          });
          return null;
        }
      })
    ).then((entries) => {
      const loaded = entries.filter((e): e is NonNullable<typeof e> => e !== null);
      if (loaded.length === 0) return;
      setPresidentialStateData((prev) => ({ ...prev, ...Object.fromEntries(loaded) }));
    });
  }, [elections, stateId]);

  const { actionLoading, message, handleEnterRace, handleWithdraw, isInRace, isInAnyRace } =
    useElectionActions({
      character,
      elections,
      onSuccess: fetchData,
    });

  // Split elections into categories
  const isParliamentary = isParliamentarySystem(COUNTRY_CONFIGS[countryId as CountryId]);

  /** Compute LARP election year from election metadata (matches election detail page). */
  const electionGameYear = (election: ElectionDisplay): number | null => {
    if (!election.cycle) return null;
    return resolveElectionYear(election);
  };

  // National-level chamber elections (federal/parliamentary)
  const config = COUNTRY_CONFIGS[countryId as CountryId];
  const lowerOfficeType = getLowerChamberOfficeType(countryId as CountryId);
  const upperOfficeType = getUpperChamberOfficeType(countryId as CountryId);

  const nationalChamberTypes = new Set<string>([lowerOfficeType]);
  if (upperOfficeType) nationalChamberTypes.add(upperOfficeType);

  // Snap variants for chambers that allow snap elections
  if (config?.lowerElectionSystem?.snapElectionsAllowed) {
    nationalChamberTypes.add(`snap_${lowerOfficeType}`);
  }
  if (config?.upperElectionSystem?.snapElectionsAllowed && upperOfficeType) {
    nationalChamberTypes.add(`snap_${upperOfficeType}`);
  }

  // Devolved parliaments are not reachable from a country-level chamber config,
  // so without these a Scottish or Welsh region would show no Holyrood or Senedd
  // race at all. Safe to add unconditionally: the fetch above already scopes
  // elections to this country and region, so these can never match elsewhere.
  nationalChamberTypes.add("holyrood");
  nationalChamberTypes.add("senedd");

  const federalElections = elections
    .filter((e) => nationalChamberTypes.has(e.electionType))
    .sort((a, b) => {
      // Sort by election type first (group same types together)
      const typeCmp = a.electionType.localeCompare(b.electionType);
      if (typeCmp !== 0) return typeCmp;
      // Within same type, sort by class ascending (Class 1 before Class 2)
      const classA = a.chamberClass ?? a.senateClass ?? 0;
      const classB = b.chamberClass ?? b.senateClass ?? 0;
      return classA - classB;
    });

  // Only show presidential races on state page during general phase (primary is national, not state-relevant)
  // Shown in every phase, primary included. The presidential primary is counted
  // nationally rather than per region, so the card marks its figures as national
  // totals instead of measuring them against this region's electorate.
  const presidentialElections = elections.filter((e) => e.electionType === "president");

  // Sub-national election types derived from country config.
  const subNationalChamberKey = config?.subNationalChamber?.key;
  const stateElectionTypes = new Set<string>();
  if (subNationalChamberKey) {
    stateElectionTypes.add(getOfficeTypeForChamber(countryId as CountryId, subNationalChamberKey));
  }
  stateElectionTypes.add(getRegionalExecutiveOfficeKey(countryId as CountryId));
  stateElectionTypes.add("localCouncil");

  const stateElectionsList = elections.filter((e) => stateElectionTypes.has(e.electionType));

  /**
   * Region-scoped presidential votes, summed from the subdivision results the
   * tab already fetches. The election's own `generalTally` is the NATIONAL
   * count, which would be the wrong figure to print on a region page.
   */
  const presidentialRegionVotes = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const [electionId, data] of Object.entries(presidentialStateData)) {
      out[electionId] = data.votes;
    }
    return out;
  }, [presidentialStateData]);

  /**
   * Ballots across the region's whole ballot. Computed once here and handed to
   * every section: each section only sees its own races, so letting them each
   * compute it would make federal, presidential and regional all report their
   * own leading race as ~100% of the region's voting.
   *
   * A nationwide race counted nationally is excluded — it is not part of this
   * region's day of voting.
   */
  const regionBallots = useMemo(() => {
    const ballot = [...federalElections, ...presidentialElections, ...stateElectionsList];
    return ballot.reduce((sum, e) => {
      const scoped =
        !!presidentialRegionVotes[e.id] || e.state?.toUpperCase() === stateId.toUpperCase();
      if (!scoped) return sum;
      const totals = presidentialRegionVotes[e.id] ?? e.generalTally?.totalVotes ?? {};
      return sum + e.candidates.reduce((s, c) => s + (totals[c.id] ?? 0), 0);
    }, 0);
  }, [
    federalElections,
    presidentialElections,
    stateElectionsList,
    presidentialRegionVotes,
    stateId,
  ]);

  /**
   * The wire ticker reads the whole ballot, not one section, so its "x% of
   * <region> ballots" denominator and its headline race are the region's, the
   * way a results desk would carry them.
   */
  const wireItems = useMemo(() => {
    const ballot = [...federalElections, ...presidentialElections, ...stateElectionsList];
    if (ballot.length === 0) return [];
    const titleById: Record<string, string> = {};
    const hrefById: Record<string, string> = {};
    const quotaByElectionId: Record<string, number | null> = {};
    for (const election of ballot) {
      titleById[election.id] = electionRaceTitle(election, electionGameYear(election));
      hrefById[election.id] = buildElectionHref(election);
      quotaByElectionId[election.id] = hareQuota(election, countryId as CountryId);
    }
    const cards = buildBlendRegionCards({
      elections: ballot,
      countryId: countryId as CountryId,
      regionName: stateName,
      regionCode: stateId,
      parties: partyLookup,
      viewerCharacterId: character?._id ?? null,
      viewerPartyId: character?.party ?? null,
      electorate,
      titleById,
      hrefById,
      regionVotesByElectionId: presidentialRegionVotes,
      regionElectoralVotes: STATE_EV[stateId],
    });
    return buildBlendWire(cards, { regionName: stateName, electorate, quotaByElectionId });
  }, [
    federalElections,
    presidentialElections,
    stateElectionsList,
    countryId,
    stateName,
    stateId,
    partyLookup,
    character,
    electorate,
    presidentialRegionVotes,
  ]);

  const federalLabel = isParliamentary ? "Parliamentary Elections" : "Upcoming Federal Elections";
  // Sub-national section header. This section groups several race tiers
  // (executive + sub-national chamber + local council), so it uses the generic
  // tier label rather than any single chamber's name (e.g. not "State Senate"
  // or "Landtag"): "Regional" for parliamentary systems, "State" otherwise.
  const stateLabel = isParliamentary ? "Regional Elections" : `${regionLabel} Elections`;
  const federalEmpty = isParliamentary
    ? `No upcoming parliamentary elections in ${stateName}`
    : `No upcoming federal elections in ${stateName}`;
  const stateEmpty = isParliamentary
    ? `No upcoming regional elections in ${stateName}`
    : `No upcoming ${regionLabel.toLowerCase()} elections in ${stateName}`;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="mb-4 text-xl font-semibold">{federalLabel}</h2>
          <p className="text-muted">Loading elections...</p>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="mb-4 text-xl font-semibold">{stateLabel}</h2>
          <p className="text-muted">Loading elections...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <p className="text-muted">Failed to load elections.</p>
        <button
          onClick={fetchData}
          className="mt-2 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (elections.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="mb-4 text-xl font-semibold">{federalLabel}</h2>
          <p className="text-muted">{federalEmpty}</p>
          <p className="mt-2 text-sm text-muted">
            Elections will appear here once an admin creates an election cycle.
          </p>
        </div>
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="mb-4 text-xl font-semibold">{stateLabel}</h2>
          <p className="text-muted">{stateEmpty}</p>
          <p className="mt-2 text-sm text-muted">
            Elections will appear here once an election cycle is created.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Federal Elections Section */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 data-coach="nav-races" className="text-xl font-semibold">
            {federalLabel}
          </h2>
          {federalElections.length > 0 && (
            <Link
              href={`${countryElectionsUrl(countryId)}?state=${stateId}`}
              className="text-xs text-muted hover:text-primary transition-colors"
            >
              View all →
            </Link>
          )}
        </div>

        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
        )}

        {character && character.homeState !== stateId && (
          <div className="mb-4 rounded-lg bg-yellow-500/10 p-3 text-sm text-yellow-400">
            You can only enter races in your home{" "}
            {isParliamentary ? "region" : regionLabel.toLowerCase()} ({character.homeState})
          </div>
        )}

        {federalElections.length > 0 ? (
          <BlendBallotSection
            elections={federalElections}
            countryId={countryId as CountryId}
            regionName={stateName}
            regionCode={stateId}
            regionBallots={regionBallots}
            tier="federal"
            parties={partyLookup}
            character={character}
            electorate={electorate}
            gameYearFor={electionGameYear}
            isInRace={isInRace}
            isInAnyRace={isInAnyRace}
            actionLoading={actionLoading}
            onEnterRace={handleEnterRace}
            onWithdraw={handleWithdraw}
          />
        ) : (
          <p className="text-muted">{federalEmpty}</p>
        )}

        {/* Presidential races sit under federal. From the general onward they
            are counted on this region's own popular vote; during the primary
            the count is national and the card says so (US only). */}
        {!isParliamentary && presidentialElections.length > 0 && (
          <div className="mt-4 pt-4 border-t border-card-border/60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">
                Presidential Race
              </h3>
              {/* There is no per-county presidential breakdown until the
                  general, so the link would open a map of redistributed
                  national numbers. */}
              {!presidentialElections[0].inPrimary && (
                <Link
                  href={buildElectionStateHref(presidentialElections[0], countryId, stateId)}
                  className="text-xs text-muted hover:text-primary transition-colors"
                >
                  County results →
                </Link>
              )}
            </div>
            <BlendBallotSection
              elections={presidentialElections}
              countryId={countryId as CountryId}
              regionName={stateName}
              regionCode={stateId}
              regionBallots={regionBallots}
              tier="presidential"
              parties={partyLookup}
              character={character}
              electorate={electorate}
              gameYearFor={electionGameYear}
              isInRace={isInRace}
              isInAnyRace={isInAnyRace}
              actionLoading={actionLoading}
              onEnterRace={handleEnterRace}
              onWithdraw={handleWithdraw}
              // The presidency stores a NATIONAL tally; on a region page the
              // region's own subdivision totals are the count that matters, and
              // they are what decides which way its electoral votes go.
              regionVotesByElectionId={presidentialRegionVotes}
              regionElectoralVotes={STATE_EV[stateId]}
            />
          </div>
        )}
      </div>

      {/* State/Regional Elections Section */}
      {
        <div className="rounded-xl border border-card-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">{stateLabel}</h2>
            {stateElectionsList.length > 0 && (
              <Link
                href={`${countryElectionsUrl(countryId)}?state=${stateId}`}
                className="text-xs text-muted hover:text-primary transition-colors"
              >
                View all →
              </Link>
            )}
          </div>

          {stateElectionsList.length > 0 ? (
            <BlendBallotSection
              elections={stateElectionsList}
              countryId={countryId as CountryId}
              regionName={stateName}
              regionCode={stateId}
              regionBallots={regionBallots}
              tier="regional"
              parties={partyLookup}
              character={character}
              electorate={electorate}
              gameYearFor={electionGameYear}
              isInRace={isInRace}
              isInAnyRace={isInAnyRace}
              actionLoading={actionLoading}
              onEnterRace={handleEnterRace}
              onWithdraw={handleWithdraw}
            />
          ) : (
            <p className="text-muted">{stateEmpty}</p>
          )}
        </div>
      }

      {/* The wire carries the whole ballot, so it sits below both sections. */}
      <WireTicker items={wireItems} />
    </div>
  );
}
