"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { getMessageStyle, resolveElectionYear } from "@/lib/utils/formatters";
import { useCountdownTimer } from "@/hooks/useCountdownTimer";
import { useElectionActions } from "@/hooks/useElectionActions";
import type { ElectionDisplay, CharacterBasic, GameStateDisplay } from "@/lib/db/types";
import type { ElectionResponse } from "@/lib/elections/resolveElection";
import { ElectionCard } from "./elections/ElectionCard";
import { PresidentialElectionCard } from "./elections/PresidentialElectionCard";
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
import { buildElectionStateHref } from "./elections/electionHelpers";
import { logError } from "@/lib/utils/errorLog";
import { mapElectionResponseToDisplay } from "@/lib/elections/mapElectionResponseToDisplay";

function toElectionDisplay(e: ElectionResponse): ElectionDisplay {
  return mapElectionResponseToDisplay(e);
}

interface StateElectionsProps {
  stateId: string;
  stateName: string;
  countryId?: string;
}

interface PartyInfo {
  id: string;
  name: string;
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

  useCountdownTimer(); // Force re-render every minute

  const countryId = propCountryId ?? "US";
  const regionLabel = COUNTRY_CONFIGS[countryId as CountryId]?.regionLabel ?? "State";

  // Helper to get party color from fetched parties (country-scoped)
  const getPartyColorHex = (partyId: string): string | null => {
    const party = parties.find((p) => p.id === partyId && p.countryId === countryId);
    return party?.color || null;
  };

  // Get party display name from fetched parties (country-scoped)
  const getPartyName = (partyId: string): string => {
    if (partyId === "independent") return "Independent";
    const party = parties.find((p) => p.id === partyId && p.countryId === countryId);
    return party?.name || partyId;
  };

  // Check if party is a custom party (not a major or independent)
  const isCustomParty = (partyId: string): boolean => {
    return partyId !== "independent" && !["1", "2"].includes(partyId);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const fetchOpts = { signal: AbortSignal.timeout(15_000) };
      const [electionsRes, presRes, charRes, partiesRes, gameStateRes] = await Promise.all([
        fetch(
          `/api/elections?country=${countryId}&state=${stateId}&limit=100&view=summary`,
          fetchOpts
        ),
        fetch(
          `/api/elections?country=${countryId}&type=president&limit=10&view=summary`,
          fetchOpts
        ),
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
            (p: { id: string; name: string; color: string; countryId?: string }) => ({
              id: p.id,
              name: p.name,
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

  // Fetch state-level PV data for presidential elections
  useEffect(() => {
    const presElections = elections.filter((e) => e.electionType === "president");
    if (presElections.length === 0) return;
    for (const pe of presElections) {
      fetch(`/api/elections/${pe.id}/state/${stateId}/subdivision-results`, {
        signal: AbortSignal.timeout(15_000),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          const votes: Record<string, number> = {};
          for (const county of data.subdivisions ?? []) {
            for (const [cid, v] of Object.entries(county.votes as Record<string, number>)) {
              votes[cid] = (votes[cid] ?? 0) + v;
            }
          }
          setPresidentialStateData((prev) => ({
            ...prev,
            [pe.id]: {
              votes,
              candidateNames: data.candidateNames,
              candidateParties: data.candidateParties,
              partyColors: data.partyColors,
            },
          }));
        })
        .catch((error) => {
          logError(error, {
            component: "StateElections",
            action: "fetch presidential election county data",
            metadata: { electionId: pe.id, stateId },
          });
        });
    }
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
  const presidentialElections = elections.filter(
    (e) => e.electionType === "president" && !e.inPrimary
  );

  // Sub-national election types derived from country config.
  const subNationalChamberKey = config?.subNationalChamber?.key;
  const stateElectionTypes = new Set<string>();
  if (subNationalChamberKey) {
    stateElectionTypes.add(getOfficeTypeForChamber(countryId as CountryId, subNationalChamberKey));
  }
  stateElectionTypes.add(getRegionalExecutiveOfficeKey(countryId as CountryId));
  stateElectionTypes.add("localCouncil");

  const stateElectionsList = elections.filter((e) => stateElectionTypes.has(e.electionType));

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

  const sharedCardProps = {
    getPartyColorHex,
    getPartyName,
    isCustomParty,
    isInRace,
    isInAnyRace,
    actionLoading,
    character,
    stateId,
    onEnterRace: handleEnterRace,
    onWithdraw: handleWithdraw,
  };

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
          <div className="space-y-3">
            {federalElections.map((election) => (
              <ElectionCard
                key={election.id}
                election={election}
                gameYear={electionGameYear(election)}
                {...sharedCardProps}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted">{federalEmpty}</p>
        )}

        {/* Presidential races shown inline under federal — with state-level PV donut (US only) */}
        {!isParliamentary && presidentialElections.length > 0 && (
          <div className="mt-4 pt-4 border-t border-card-border/60">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">
                Presidential Race
              </h3>
              <Link
                href={buildElectionStateHref(presidentialElections[0], countryId, stateId)}
                className="text-xs text-muted hover:text-primary transition-colors"
              >
                County results →
              </Link>
            </div>
            <div className="space-y-3">
              {presidentialElections.map((election) => (
                <PresidentialElectionCard
                  key={election.id}
                  election={election}
                  gameYear={electionGameYear(election)}
                  stateId={stateId}
                  stateData={presidentialStateData[election.id]}
                  getPartyColorHex={getPartyColorHex}
                  isCustomParty={isCustomParty}
                />
              ))}
            </div>
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
            <div className="space-y-3">
              {stateElectionsList.map((election) => (
                <ElectionCard
                  key={election.id}
                  election={election}
                  gameYear={electionGameYear(election)}
                  {...sharedCardProps}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted">{stateEmpty}</p>
          )}
        </div>
      }
    </div>
  );
}
