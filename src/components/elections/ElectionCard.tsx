"use client";

import { memo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getPartyColor } from "@/lib/utils/politics";
import { useGameClock } from "@/contexts/useGameClock";
import type { ElectionDisplay } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { lightenHex, electionRaceTitle, buildElectionHref } from "./electionHelpers";
import {
  isElectionTypeEntryBlocked,
  isNationwideDirectExecutiveElection,
} from "@/lib/elections/nationwideExecutive";
import { PartyLogo } from "@/components/PartyLogo";
import { Avatar } from "@/components/Avatar";
import { GeneralPieChart } from "./ElectionDonut";
import { PrimaryCardGrid } from "./PrimaryCard";
import { partyUrl } from "@/lib/urls";
import { ElectionPhaseStatusStrip } from "./ElectionPhaseStatusStrip";
import { buildElectionPhaseStatusSummary } from "@/lib/elections/electionPhaseStatus";

const SEAT_ELECTION_TYPES = new Set([
  "house",
  "stateSenate",
  "commons",
  "snap_commons",
  "regionalCouncil",
  "npcDelegate",
  "peoplesCongress",
]);

function formatVotesCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

interface ElectionCardProps {
  election: ElectionDisplay;
  gameYear: number | null;
  getPartyColorHex: (partyId: string) => string | null;
  getPartyName: (partyId: string) => string;
  isCustomParty: (partyId: string) => boolean;
  isInRace: (election: ElectionDisplay) => boolean;
  isInAnyRace: () => boolean;
  actionLoading: string | null;
  character: { homeState: string; countryId?: string } | null;
  stateId: string;
  onEnterRace: (electionId: string) => void;
  onWithdraw: (electionId: string) => void;
  /** Live results page gate (from useWorldFlags, fetched once by the parent). */
  liveResultsEnabled?: boolean;
}

type PrimaryGroup = {
  partyId: string;
  partyName: string;
  baseColor: string;
  candidates: {
    id: string;
    name: string;
    pct: number;
    color: string;
    inPolling: boolean;
    avatarUrl?: string;
    characterId?: string;
    nppId?: string | null;
    isNPP?: boolean;
  }[];
};

// Memoized: the parent elections list re-renders every 60s (countdown tick) and
// on every action/filter state change — with stable props, unchanged cards skip
// re-rendering. The card still re-renders itself each minute via its own
// useGameClock subscription, which the countdown display needs.
export const ElectionCard = memo(function ElectionCard({
  election,
  gameYear,
  getPartyColorHex,
  getPartyName,
  isCustomParty,
  isInRace,
  isInAnyRace,
  actionLoading,
  character,
  stateId,
  onEnterRace,
  onWithdraw,
  liveResultsEnabled = false,
}: ElectionCardProps) {
  const t = useTranslations("elections");
  const clock = useGameClock();
  const inThisRace = isInRace(election);
  const inAnyRace = isInAnyRace();
  const isLoading = actionLoading === election.id;
  const isUpcoming = election.status === "upcoming";
  // Turn-first countdown (freeze on pause, no wall-clock drift); timestamp
  // fallback only for legacy rows without the turn field.
  const primaryTimer =
    election.primaryEndTurn != null
      ? clock.formatRemainingTurns(election.primaryEndTurn)
      : clock.formatRemaining(election.primaryEndTime);
  const primaryEnded = primaryTimer.urgency === "ended";
  const phaseStatus = buildElectionPhaseStatusSummary(election);

  // Override server-side inPrimary with the client-side timer so the badge
  // never shows "Primary Phase" when the primary countdown has already ended
  // (the elections API and game-state API are fetched separately and can diverge
  // for up to 5 s after a turn due to the getGameTime() cache).
  const effectiveInPrimary = !!election.inPrimary && !primaryEnded;

  const isHomeState = character?.homeState === stateId;
  // Nationwide executive races (president, uachtaran) live under state=countryId
  // and aren't tied to any single home region — let any character from the
  // matching country enter.
  const isEligibleNationwideExecutive =
    !!character?.countryId &&
    isNationwideDirectExecutiveElection(election.electionType, election.state, character.countryId);
  // If a future race ships its spawner before its resolver, hide entry actions
  // so the empty race finalizes vacant.
  const isEntryBlocked = isElectionTypeEntryBlocked(election.electionType);
  const canShowEnterButton = !isEntryBlocked && (isHomeState || isEligibleNationwideExecutive);

  const statusColor = isUpcoming
    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
    : election.status === "active" && effectiveInPrimary
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : election.status === "active"
        ? "bg-green-500/15 text-green-400 border-green-500/30"
        : "bg-muted/15 text-muted border-card-border";

  const statusLabel = isUpcoming
    ? t("status.upcoming")
    : election.status === "completed"
      ? t("status.completed")
      : effectiveInPrimary
        ? t("status.primaryPhase")
        : t("status.generalPhase");

  // Build polling donut entries
  const isPrimaryPolling = election.polling?.source === "primary";
  const hasPolling = election.polling && Object.keys(election.polling.sharesPct).length > 0;

  // For primary: group candidates by party
  const primaryGroups: PrimaryGroup[] = [];
  if (isPrimaryPolling || effectiveInPrimary) {
    const groupMap: Record<string, PrimaryGroup> = {};
    const seenCandidateIds = new Set<string>();

    // Add candidates from polling data
    if (hasPolling && isPrimaryPolling) {
      const entries = Object.entries(election.polling!.sharesPct)
        .filter(([, p]) => p > 0)
        .sort(([, a], [, b]) => b - a);
      for (const [candidateId, pct] of entries) {
        const partyId = election.polling!.candidateParties[candidateId] ?? "independent";
        const name = election.polling!.candidateNames[candidateId] ?? t("card.unknownCandidate");
        const baseColor =
          election.polling!.candidatePartyColors?.[candidateId] ??
          getPartyColorHex(partyId) ??
          "#9CA3AF";
        const cd = election.candidates.find((c) => c.id === candidateId);
        if (!groupMap[partyId]) {
          const resolvedName = cd?.partyName ?? getPartyName(partyId);
          groupMap[partyId] = { partyId, partyName: resolvedName, baseColor, candidates: [] };
        }
        groupMap[partyId].candidates.push({
          id: candidateId,
          name,
          pct,
          color: baseColor,
          inPolling: true,
          avatarUrl: cd?.avatarUrl,
          characterId: cd?.characterId,
          nppId: cd?.nppId,
          isNPP: cd?.isNPP,
        });
        seenCandidateIds.add(candidateId);
      }
    }

    // Add candidates from election.candidates who aren't in polling yet (e.g. just joined)
    for (const candidate of election.candidates) {
      if (!seenCandidateIds.has(candidate.id)) {
        const partyId = candidate.party ?? "independent";
        const baseColor = getPartyColorHex(partyId) ?? "#9CA3AF";
        if (!groupMap[partyId]) {
          const resolvedName = candidate.partyName ?? getPartyName(partyId);
          groupMap[partyId] = { partyId, partyName: resolvedName, baseColor, candidates: [] };
        }
        groupMap[partyId].candidates.push({
          id: candidate.id,
          name: candidate.characterName,
          pct: 0,
          color: baseColor,
          inPolling: false,
          avatarUrl: candidate.avatarUrl,
          characterId: candidate.characterId,
          nppId: candidate.nppId,
          isNPP: candidate.isNPP,
        });
      }
    }

    // Assign shifted colors within each party group
    for (const group of Object.values(groupMap)) {
      group.candidates.forEach((c, i) => {
        c.color = lightenHex(group.baseColor, i === 0 ? 0 : Math.min(0.55, i * 0.22));
      });
      primaryGroups.push(group);
    }
    // Sort major parties first (US: democrat/republican, UK: uk_labour/uk_conservative)
    const MAJOR_PARTIES = new Set(["democrat", "republican", "uk_labour", "uk_conservative"]);
    primaryGroups.sort((a, b) => {
      const aM = MAJOR_PARTIES.has(a.partyId);
      const bM = MAJOR_PARTIES.has(b.partyId);
      return aM === bM ? 0 : aM ? -1 : 1;
    });
  }

  // For general: flat sorted list
  // When generalTally is available, compute percentages from cumulative totalVotes
  // to match the election detail page calculation (not per-turn snapshot sharesPct)
  const generalEntries = (() => {
    if (!hasPolling || isPrimaryPolling) return null;

    // If we have generalTally, compute percentages from cumulative votes
    if (election.generalTally && Object.keys(election.generalTally.totalVotes).length > 0) {
      const grandTotal = Math.max(
        1,
        Object.values(election.generalTally.totalVotes).reduce((s, v) => s + v, 0)
      );
      return Object.entries(election.generalTally.totalVotes)
        .filter(([, v]) => v > 0)
        .map(
          ([candidateId, votes]) => [candidateId, (votes / grandTotal) * 100] as [string, number]
        )
        .sort(([, a], [, b]) => b - a);
    }

    // Fallback to polling sharesPct if no tally
    return Object.entries(election.polling!.sharesPct)
      .filter(([, p]) => p > 0)
      .sort(([, a], [, b]) => b - a);
  })();

  return (
    <div className="rounded-xl border border-card-border bg-card/40 overflow-hidden shadow-sm transition-all hover:border-card-border/80">
      {/* ── Title bar ── */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-card-border/60 bg-card/60">
        <div className="flex-1 min-w-0">
          <Link
            href={buildElectionHref(election)}
            className="font-semibold text-base hover:text-primary transition-colors flex items-center gap-2"
          >
            {electionRaceTitle(election, gameYear, t)}
            <svg
              className="w-4 h-4 text-muted/50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
          {election.incumbent && (
            <p className="mt-0.5 text-xs text-muted leading-tight">
              {t("card.incumbent")}{" "}
              <span
                className="font-medium"
                style={{ color: election.incumbent.partyColor ?? undefined }}
              >
                {election.incumbent.name}
              </span>{" "}
              <span className="opacity-60">({election.incumbent.party})</span>
            </p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide uppercase ${statusColor}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* ── Timers Grid ── */}
        <ElectionPhaseStatusStrip phaseStatus={phaseStatus} />

        {/* ── General Phase: Live Vote Tally ── */}
        {hasPolling && !isPrimaryPolling && generalEntries && election.generalTally && (
          <div className="rounded-lg border border-card-border/60 overflow-hidden">
            <div className="px-3 py-1.5 flex items-center justify-between text-[10px] font-medium bg-blue-500/10 border-b border-blue-500/20 text-blue-400">
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                {election.electionType === "president"
                  ? t("card.popularVote")
                  : t("card.liveVoteTally")}
              </span>
              {election.generalTally.turnSnapshots.length > 0 && (
                <span className="text-muted font-normal">
                  {t("card.votesTurns", {
                    votes: formatVotesCompact(
                      Object.values(election.generalTally.totalVotes).reduce((s, v) => s + v, 0)
                    ),
                    turnCount: election.generalTally.turnSnapshots.length,
                  })}
                </span>
              )}
            </div>
            <div className="px-3 py-3">
              {(() => {
                const showSeats =
                  SEAT_ELECTION_TYPES.has(election.electionType) && !!election.seatsEstimate;
                const pieSlices = generalEntries.map(([candidateId, pct]) => {
                  const party = election.polling!.candidateParties[candidateId] ?? "independent";
                  return {
                    pct,
                    color:
                      election.polling!.candidatePartyColors?.[candidateId] ??
                      getPartyColorHex(party) ??
                      "#9CA3AF",
                    label:
                      election.polling!.candidateNames[candidateId] ?? t("card.unknownCandidate"),
                  };
                });
                return (
                  <div className="flex gap-3">
                    <div className="shrink-0 self-center">
                      <GeneralPieChart slices={pieSlices} size={80} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Column headers */}
                      <div className="flex items-center gap-2 mb-1.5 text-[9px] uppercase tracking-wider text-muted/50 font-medium select-none">
                        <div className="w-5 shrink-0" />
                        <div className="w-36 shrink-0">{t("card.candidateHeader")}</div>
                        <div className="w-32 shrink-0">{t("card.partyHeader")}</div>
                        <div className="flex-1 min-w-0" />
                        <div className="shrink-0 w-8 text-right">{t("card.votesHeader")}</div>
                        {showSeats && (
                          <div className="shrink-0 w-8 text-right">{t("card.seatsHeader")}</div>
                        )}
                        <div className="shrink-0 w-10 text-right">%</div>
                      </div>
                      <div className="space-y-1.5">
                        {generalEntries.map(([candidateId, pct], i) => {
                          const party =
                            election.polling!.candidateParties[candidateId] ?? "independent";
                          const name =
                            election.polling!.candidateNames[candidateId] ??
                            t("card.unknownCandidate");
                          const partyDisplayName =
                            election.polling!.candidatePartyNames?.[candidateId] ?? "";
                          const color =
                            election.polling!.candidatePartyColors?.[candidateId] ??
                            getPartyColorHex(party) ??
                            "#9CA3AF";
                          const votes = election.generalTally!.totalVotes[candidateId] ?? 0;
                          const isLeader = i === 0;
                          const candidate = election.candidates.find((c) => c.id === candidateId);
                          const href = candidate?.isNPP
                            ? `/politicians/npp/${candidate.nppId}`
                            : candidate
                              ? `/character/${candidate.characterId}`
                              : null;
                          const seats = showSeats
                            ? (election.seatsEstimate?.[candidateId] ?? 0)
                            : null;
                          return (
                            <div key={candidateId} className="flex items-center gap-2">
                              <Avatar url={candidate?.avatarUrl} name={name} size="h-5 w-5" />
                              <div className="w-36 shrink-0">
                                {href ? (
                                  <Link
                                    href={href}
                                    className={`text-xs font-medium hover:text-primary transition-colors truncate block ${isLeader ? "text-foreground" : "text-muted"}`}
                                  >
                                    {name}
                                  </Link>
                                ) : (
                                  <span
                                    className={`text-xs font-medium truncate block ${isLeader ? "text-foreground" : "text-muted"}`}
                                  >
                                    {name}
                                  </span>
                                )}
                              </div>
                              <Link
                                href={partyUrl(election.countryId as CountryId, party)}
                                className="flex items-center gap-1 w-32 shrink-0 hover:opacity-80 transition-opacity min-w-0"
                              >
                                <PartyLogo
                                  partyId={party}
                                  partyColor={color}
                                  size="h-3 w-3"
                                  countryId={election.countryId as CountryId}
                                />
                                <span className="text-[10px] text-muted">{partyDisplayName}</span>
                              </Link>
                              <div className="flex-1 min-w-0 h-1.5 rounded-full bg-card-border overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, pct))}%`,
                                    backgroundColor: color,
                                  }}
                                />
                              </div>
                              <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
                                <span className="text-muted w-8 text-right">
                                  {formatVotesCompact(votes)}
                                </span>
                                {seats !== null && (
                                  <span className="text-muted w-8 text-right">{seats}</span>
                                )}
                                <span
                                  className="font-bold w-10 text-right"
                                  style={{ color: isLeader ? color : "var(--muted)" }}
                                >
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Primary Phase Display ── */}
        {primaryGroups.length > 0 && effectiveInPrimary && (
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
              {t("card.primaryResults")}
            </div>
            <PrimaryCardGrid
              primaries={primaryGroups.map((group) => ({
                partyId: group.partyId,
                partyName: t("card.partyPrimary", { party: group.partyName }),
                partyColor: group.baseColor,
                isUncontested: group.candidates.length === 1,
                candidates: group.candidates.map((c, i) => ({
                  id: c.id,
                  name: c.name,
                  avatarUrl: c.avatarUrl,
                  characterId: c.characterId,
                  nppId: c.nppId,
                  isNPP: c.isNPP,
                  percentage: group.candidates.length === 1 ? 100 : c.pct,
                  isLeader: i === 0,
                })),
              }))}
              countryId={election.countryId as CountryId}
            />
          </div>
        )}

        {/* ── General Polling: Fallback (no tally data) ── */}
        {hasPolling && !isPrimaryPolling && generalEntries && !election.generalTally && (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
              {t("card.polling")}
            </div>
            <div className="rounded-lg border border-card-border/60 px-3 py-3">
              {(() => {
                const showSeats =
                  SEAT_ELECTION_TYPES.has(election.electionType) && !!election.seatsEstimate;
                const pieSlices = generalEntries.map(([candidateId, pct]) => {
                  const party = election.polling!.candidateParties[candidateId] ?? "independent";
                  return {
                    pct,
                    color:
                      election.polling!.candidatePartyColors?.[candidateId] ??
                      getPartyColorHex(party) ??
                      "#9CA3AF",
                    label:
                      election.polling!.candidateNames[candidateId] ?? t("card.unknownCandidate"),
                  };
                });
                return (
                  <div className="flex gap-3">
                    <div className="shrink-0 self-center">
                      <GeneralPieChart slices={pieSlices} size={80} />
                    </div>
                    <div className="flex-1 min-w-0">
                      {/* Column headers */}
                      <div className="flex items-center gap-2 mb-1.5 text-[9px] uppercase tracking-wider text-muted/50 font-medium select-none">
                        <div className="w-5 shrink-0" />
                        <div className="w-36 shrink-0">{t("card.candidateHeader")}</div>
                        <div className="w-32 shrink-0">{t("card.partyHeader")}</div>
                        <div className="flex-1 min-w-0" />
                        {showSeats && (
                          <div className="shrink-0 w-8 text-right">{t("card.seatsHeader")}</div>
                        )}
                        <div className="shrink-0 w-10 text-right">%</div>
                      </div>
                      <div className="space-y-1.5">
                        {generalEntries.map(([candidateId, pct], i) => {
                          const party =
                            election.polling!.candidateParties[candidateId] ?? "independent";
                          const name =
                            election.polling!.candidateNames[candidateId] ??
                            t("card.unknownCandidate");
                          const partyDisplayName =
                            election.polling!.candidatePartyNames?.[candidateId] ?? "";
                          const color =
                            election.polling!.candidatePartyColors?.[candidateId] ??
                            getPartyColorHex(party) ??
                            "#9CA3AF";
                          const isLeader = i === 0;
                          const candidate = election.candidates.find((c) => c.id === candidateId);
                          const href = candidate?.isNPP
                            ? `/politicians/npp/${candidate.nppId}`
                            : candidate
                              ? `/character/${candidate.characterId}`
                              : null;
                          const seats = showSeats
                            ? (election.seatsEstimate?.[candidateId] ?? 0)
                            : null;
                          return (
                            <div key={candidateId} className="flex items-center gap-2">
                              <Avatar url={candidate?.avatarUrl} name={name} size="h-5 w-5" />
                              <div className="w-36 shrink-0">
                                {href ? (
                                  <Link
                                    href={href}
                                    className={`text-xs font-medium hover:text-primary transition-colors truncate block ${isLeader ? "text-foreground" : "text-muted"}`}
                                  >
                                    {name}
                                  </Link>
                                ) : (
                                  <span
                                    className={`text-xs font-medium truncate block ${isLeader ? "text-foreground" : "text-muted"}`}
                                  >
                                    {name}
                                  </span>
                                )}
                              </div>
                              <Link
                                href={partyUrl(election.countryId as CountryId, party)}
                                className="flex items-center gap-1 w-32 shrink-0 hover:opacity-80 transition-opacity"
                              >
                                <PartyLogo
                                  partyId={party}
                                  partyColor={color}
                                  size="h-3 w-3"
                                  countryId={election.countryId as CountryId}
                                />
                                <span className="text-[10px] text-muted">{partyDisplayName}</span>
                              </Link>
                              <div className="flex-1 min-w-0 h-1.5 rounded-full bg-card-border overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, pct))}%`,
                                    backgroundColor: color,
                                  }}
                                />
                              </div>
                              <div className="flex items-center gap-2 shrink-0 text-xs tabular-nums">
                                {seats !== null && (
                                  <span className="text-muted w-8 text-right">{seats}</span>
                                )}
                                <span
                                  className="font-bold w-10 text-right"
                                  style={{ color: isLeader ? color : "var(--muted)" }}
                                >
                                  {pct.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Candidates + action ── */}
        <div className="flex items-end justify-between gap-3 pt-1">
          {/* Hide candidate badges when already shown in polling/tally rows above */}
          {!effectiveInPrimary && !(hasPolling && !isPrimaryPolling) && (
            <div className="flex-1 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
                {t("card.candidates")}
              </div>
              {election.candidates.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {election.candidates.map((candidate) => (
                    <div key={candidate.id} className="group relative">
                      <Link
                        href={
                          candidate.isNPP
                            ? `/politicians/npp/${candidate.nppId}`
                            : `/character/${candidate.characterId}`
                        }
                        className={`
                          inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all
                          hover:ring-2 hover:ring-offset-1 hover:ring-offset-card hover:ring-primary/20
                          ${isCustomParty(candidate.party) ? "" : getPartyColor(candidate.party)}
                        `}
                        style={
                          isCustomParty(candidate.party)
                            ? {
                                backgroundColor: `${getPartyColorHex(candidate.party)}15`,
                                color: getPartyColorHex(candidate.party) || "#888",
                                borderColor: `${getPartyColorHex(candidate.party)}40`,
                              }
                            : undefined
                        }
                      >
                        <PartyLogo
                          partyId={candidate.party}
                          partyColor={getPartyColorHex(candidate.party) ?? "#9CA3AF"}
                          size="h-3.5 w-3.5"
                          countryId={election.countryId as CountryId}
                          className="rounded-full"
                        />
                        {candidate.characterName}
                        {candidate.isNPP && (
                          <span className="opacity-60 text-[10px] uppercase tracking-wide ml-0.5">
                            NPP
                          </span>
                        )}
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted italic">{t("card.noRegisteredCandidates")}</p>
              )}
            </div>
          )}

          {character && (
            <div className={effectiveInPrimary ? "ml-auto" : "shrink-0"}>
              {inThisRace ? (
                <button
                  onClick={() => onWithdraw(election.id)}
                  disabled={isLoading}
                  className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                >
                  {isLoading ? t("card.processing") : t("card.withdraw")}
                </button>
              ) : isEntryBlocked ? (
                <span className="text-xs italic text-muted" title={t("card.filingClosedTitle")}>
                  {t("card.filingClosed")}
                </span>
              ) : (
                canShowEnterButton &&
                !inAnyRace &&
                !primaryEnded && (
                  <button
                    onClick={() => onEnterRace(election.id)}
                    disabled={isLoading}
                    className="rounded-lg bg-primary px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-primary-dark hover:shadow-md disabled:opacity-50 disabled:shadow-none"
                  >
                    {isLoading ? t("card.joining") : t("card.enterRace")}
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {liveResultsEnabled && election.status !== "upcoming" && (
          <div className="pt-1">
            <Link
              href={`/elections/${election.id}/results`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            >
              {election.status === "active" && (
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              )}
              {t("card.liveResults")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
});
