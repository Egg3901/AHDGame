"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import { GeneralPieChart } from "@/components/elections/ElectionDonut";
import { PrimaryCardGrid } from "@/components/elections/PrimaryCard";
import { partyUrl } from "@/lib/urls";
import type { CountryId } from "@/lib/constants/countries";
import type { ElectionDisplay } from "@/lib/db/types";

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

function buildPrimaryGroups(
  election: ElectionDisplay,
  t: (key: string, values?: Record<string, string | number>) => string
) {
  const isPrimaryPolling = election.polling?.source === "primary";
  if (!isPrimaryPolling || !election.inPrimary) return [];

  const groupMap = new Map<
    string,
    {
      partyId: string;
      partyName: string;
      partyColor: string;
      candidates: {
        id: string;
        name: string;
        avatarUrl?: string;
        characterId?: string;
        nppId?: string | null;
        isNPP?: boolean;
        percentage: number;
        isLeader: boolean;
      }[];
    }
  >();

  const shares = election.polling?.sharesPct ?? {};
  const candidateNames = election.polling?.candidateNames ?? {};
  const candidateParties = election.polling?.candidateParties ?? {};
  const candidatePartyColors = election.polling?.candidatePartyColors ?? {};
  const seenCandidateIds = new Set<string>();

  const sortedEntries = Object.entries(shares)
    .filter(([, pct]) => pct > 0)
    .sort(([, a], [, b]) => b - a);

  for (const [candidateId, pct] of sortedEntries) {
    const candidate = election.candidates.find((entry) => entry.id === candidateId);
    const partyId = candidateParties[candidateId] ?? candidate?.party ?? "independent";
    const partyName = candidate?.partyName ?? partyId;
    const partyColor = candidatePartyColors[candidateId] ?? candidate?.partyColor ?? "var(--muted)";
    if (!groupMap.has(partyId)) {
      groupMap.set(partyId, { partyId, partyName, partyColor, candidates: [] });
    }
    groupMap.get(partyId)!.candidates.push({
      id: candidateId,
      name: candidateNames[candidateId] ?? candidate?.characterName ?? t("card.unknownCandidate"),
      avatarUrl: candidate?.avatarUrl,
      characterId: candidate?.characterId,
      nppId: candidate?.nppId,
      isNPP: candidate?.isNPP,
      percentage: pct,
      isLeader: false,
    });
    seenCandidateIds.add(candidateId);
  }

  for (const candidate of election.candidates) {
    if (seenCandidateIds.has(candidate.id)) continue;
    const partyId = candidate.party;
    if (!groupMap.has(partyId)) {
      groupMap.set(partyId, {
        partyId,
        partyName: candidate.partyName ?? partyId,
        partyColor: candidate.partyColor ?? "var(--muted)",
        candidates: [],
      });
    }
    groupMap.get(partyId)!.candidates.push({
      id: candidate.id,
      name: candidate.characterName,
      avatarUrl: candidate.avatarUrl,
      characterId: candidate.characterId,
      nppId: candidate.nppId,
      isNPP: candidate.isNPP,
      percentage: 0,
      isLeader: false,
    });
  }

  return Array.from(groupMap.values()).map((group) => ({
    ...group,
    partyName: t("card.partyPrimary", { party: group.partyName }),
    isUncontested: group.candidates.length === 1,
    candidates: group.candidates
      .sort((a, b) => b.percentage - a.percentage)
      .map((candidate, index) => ({
        ...candidate,
        percentage: group.candidates.length === 1 ? 100 : candidate.percentage,
        isLeader: index === 0,
      })),
  }));
}

function buildGeneralEntries(election: ElectionDisplay) {
  const isPrimaryPolling = election.polling?.source === "primary";
  if (!election.polling || isPrimaryPolling) return null;

  if (election.generalTally && Object.keys(election.generalTally.totalVotes).length > 0) {
    const totalVotes = Math.max(
      1,
      Object.values(election.generalTally.totalVotes).reduce((sum, votes) => sum + votes, 0)
    );
    return Object.entries(election.generalTally.totalVotes)
      .filter(([, votes]) => votes > 0)
      .map(([candidateId, votes]) => [candidateId, (votes / totalVotes) * 100] as const)
      .sort(([, a], [, b]) => b - a);
  }

  return Object.entries(election.polling.sharesPct)
    .filter(([, pct]) => pct > 0)
    .sort(([, a], [, b]) => b - a);
}

export function SlateElectionResults({ election }: { election: ElectionDisplay }) {
  const t = useTranslations("elections");
  const primaryGroups = buildPrimaryGroups(election, t);
  const generalEntries = buildGeneralEntries(election);
  const showSeats = SEAT_ELECTION_TYPES.has(election.electionType) && !!election.seatsEstimate;

  if (primaryGroups.length === 0 && (!generalEntries || generalEntries.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-3">
      {primaryGroups.length > 0 && (
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
            {t("card.primaryResults")}
          </div>
          <PrimaryCardGrid primaries={primaryGroups} countryId={election.countryId as CountryId} />
        </div>
      )}

      {generalEntries && generalEntries.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
            {t("card.generalResults")}
          </div>
          <div className="rounded-lg border border-card-border/60 px-3 py-3">
            <div className="flex gap-3">
              <div className="shrink-0 self-center">
                <GeneralPieChart
                  slices={generalEntries.map(([candidateId, pct]) => ({
                    pct,
                    color:
                      election.polling?.candidatePartyColors?.[candidateId] ??
                      election.candidates.find((candidate) => candidate.id === candidateId)
                        ?.partyColor ??
                      "#9CA3AF",
                    label:
                      election.polling?.candidateNames[candidateId] ??
                      election.candidates.find((candidate) => candidate.id === candidateId)
                        ?.characterName ??
                      t("card.unknownCandidate"),
                  }))}
                  size={80}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="mb-1.5 flex items-center gap-2 text-[9px] font-medium uppercase tracking-wider text-muted/50 select-none">
                  <div className="w-5 shrink-0" />
                  <div className="w-36 shrink-0">{t("card.candidateHeader")}</div>
                  <div className="w-32 shrink-0">{t("card.partyHeader")}</div>
                  <div className="flex-1 min-w-0" />
                  {election.generalTally && (
                    <div className="w-8 shrink-0 text-right">{t("card.votesHeader")}</div>
                  )}
                  {showSeats && (
                    <div className="w-8 shrink-0 text-right">{t("card.seatsHeader")}</div>
                  )}
                  <div className="w-10 shrink-0 text-right">%</div>
                </div>
                <div className="space-y-1.5">
                  {generalEntries.map(([candidateId, pct], index) => {
                    const candidate = election.candidates.find((entry) => entry.id === candidateId);
                    const party =
                      election.polling?.candidateParties[candidateId] ??
                      candidate?.party ??
                      "independent";
                    const name =
                      election.polling?.candidateNames[candidateId] ??
                      candidate?.characterName ??
                      t("card.unknownCandidate");
                    const partyDisplayName =
                      election.polling?.candidatePartyNames?.[candidateId] ??
                      candidate?.partyName ??
                      party;
                    const color =
                      election.polling?.candidatePartyColors?.[candidateId] ??
                      candidate?.partyColor ??
                      "#9CA3AF";
                    const href = candidate?.isNPP
                      ? `/politicians/npp/${candidate.nppId}`
                      : candidate
                        ? `/character/${candidate.characterId}`
                        : null;
                    const votes = election.generalTally?.totalVotes[candidateId] ?? null;
                    const seats = showSeats ? (election.seatsEstimate?.[candidateId] ?? 0) : null;
                    const isLeader = index === 0;

                    return (
                      <div key={candidateId} className="flex items-center gap-2">
                        <Avatar url={candidate?.avatarUrl} name={name} size="h-5 w-5" />
                        <div className="w-36 shrink-0">
                          {href ? (
                            <Link
                              href={href}
                              className={`block truncate text-xs font-medium transition-colors hover:text-primary ${
                                isLeader ? "text-foreground" : "text-muted"
                              }`}
                            >
                              {name}
                            </Link>
                          ) : (
                            <span
                              className={`block truncate text-xs font-medium ${
                                isLeader ? "text-foreground" : "text-muted"
                              }`}
                            >
                              {name}
                            </span>
                          )}
                        </div>
                        <Link
                          href={partyUrl(election.countryId as CountryId, party)}
                          className="flex w-32 shrink-0 min-w-0 items-center gap-1 transition-opacity hover:opacity-80"
                        >
                          <PartyLogo
                            partyId={party}
                            partyColor={color}
                            size="h-3 w-3"
                            countryId={election.countryId as CountryId}
                          />
                          <span className="text-[10px] text-muted">{partyDisplayName}</span>
                        </Link>
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-card-border">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(0, Math.min(100, pct))}%`,
                              backgroundColor: color,
                            }}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                          {votes !== null && (
                            <span className="w-8 text-right text-muted">
                              {formatVotesCompact(votes)}
                            </span>
                          )}
                          {seats !== null && (
                            <span className="w-8 text-right text-muted">{seats}</span>
                          )}
                          <span
                            className="w-10 text-right font-bold"
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
          </div>
        </div>
      )}
    </div>
  );
}
