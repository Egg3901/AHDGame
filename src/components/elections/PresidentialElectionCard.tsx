"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { getPartyColor } from "@/lib/utils/politics";
import { useGameClock } from "@/contexts/useGameClock";
import type { ElectionDisplay } from "@/lib/db/types";
import { electionRaceTitle, buildElectionHref } from "./electionHelpers";
import { StatePVDonut } from "./StatePVDonut";
import { LocalTime } from "@/components/time/LocalTime";

interface PresidentialStateData {
  votes: Record<string, number>;
  candidateNames: Record<string, string>;
  candidateParties: Record<string, string>;
  partyColors?: Record<string, string>;
}

interface PresidentialElectionCardProps {
  election: ElectionDisplay;
  gameYear: number | null;
  stateId: string;
  stateData: PresidentialStateData | undefined;
  getPartyColorHex: (partyId: string) => string | null;
  isCustomParty: (partyId: string) => boolean;
}

export function PresidentialElectionCard({
  election,
  gameYear,
  stateId,
  stateData,
  getPartyColorHex,
  isCustomParty,
}: PresidentialElectionCardProps) {
  const t = useTranslations("elections");
  const clock = useGameClock();
  // Absolute deadlines render through <LocalTime> so any SSR pass stays
  // hydration-safe (host-locale toLocaleString caused React #418).
  const absoluteDeadline = (value: string | Date | null | undefined) => {
    const shifted = clock.toAbsoluteWallClock(value ?? null);
    return shifted ? <LocalTime value={shifted} /> : null;
  };
  const isUpcoming = election.status === "upcoming";
  // Turn-first so the "primary ended" flip tracks the turn counter (freezes on
  // pause), not wall-clock; timestamp fallback for legacy rows.
  const primaryEnded =
    (election.primaryEndTurn != null
      ? clock.formatRemainingTurns(election.primaryEndTurn)
      : clock.formatRemaining(election.primaryEndTime)
    ).urgency === "ended";

  const statusColor = isUpcoming
    ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
    : election.status === "active" && election.inPrimary
      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
      : election.status === "active"
        ? "bg-green-500/15 text-green-400 border-green-500/30"
        : "bg-muted/15 text-muted border-card-border";

  const statusLabel = isUpcoming
    ? t("status.upcoming")
    : election.status === "completed"
      ? t("status.completed")
      : election.inPrimary
        ? t("status.primary")
        : t("status.general");

  const stateEntries = stateData
    ? Object.entries(stateData.votes)
        .sort(([, a], [, b]) => b - a)
        .filter(([, v]) => v > 0)
    : null;

  return (
    <div className="rounded-xl border border-card-border bg-card/60 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-card-border/60 bg-card">
        <Link
          href={buildElectionHref(election)}
          className="font-semibold text-sm hover:text-primary transition-colors"
        >
          {electionRaceTitle(election, gameYear, t)}
        </Link>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusColor}`}
        >
          {statusLabel}
        </span>
      </div>
      <div className="px-4 py-3 space-y-3">
        {stateEntries && stateEntries.length > 0 ? (
          <StatePVDonut
            entries={stateEntries}
            candidateNames={stateData!.candidateNames}
            candidateParties={stateData!.candidateParties}
            partyColors={stateData!.partyColors}
            stateId={stateId}
          />
        ) : election.candidates.length > 0 ? (
          <p className="text-xs text-muted italic">{t("presidentialCard.awaitingResults")}</p>
        ) : (
          <p className="text-xs text-muted italic">{t("presidentialCard.noCandidatesYet")}</p>
        )}
        {/* Timers */}
        {election.endTime && (
          <div className="text-xs text-muted/70 space-y-0.5">
            {!primaryEnded && election.primaryEndTime && (
              <div>
                {t.rich("presidentialCard.primaryEnds", {
                  date: () => absoluteDeadline(election.primaryEndTime),
                })}
              </div>
            )}
            <div>
              {t.rich("presidentialCard.generalEnds", {
                date: () => absoluteDeadline(election.endTime),
              })}
            </div>
          </div>
        )}
        {/* Candidates — only show chips when no state vote data is displayed above (avoids redundancy) */}
        {election.candidates.length > 0 && !(stateEntries && stateEntries.length > 0) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {election.candidates.map((candidate) => (
              <Link
                key={candidate.id}
                href={
                  candidate.isNPP
                    ? `/politicians/npp/${candidate.nppId}`
                    : `/character/${candidate.characterId}`
                }
                className={`rounded-full border px-2 py-0.5 text-xs flex items-center gap-1 hover:opacity-80 transition-opacity ${isCustomParty(candidate.party) ? "" : getPartyColor(candidate.party)}`}
                style={
                  isCustomParty(candidate.party)
                    ? {
                        backgroundColor: `${getPartyColorHex(candidate.party)}20`,
                        color: getPartyColorHex(candidate.party) || "#888",
                        borderColor: `${getPartyColorHex(candidate.party)}80`,
                      }
                    : undefined
                }
              >
                {candidate.characterName}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
