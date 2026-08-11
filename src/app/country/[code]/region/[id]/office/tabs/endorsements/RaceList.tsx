"use client";

import { EndorseButton } from "./EndorseButton";
import { PartyChip } from "@/app/congress/components/CongressShared";
import type { CountryId } from "@/lib/constants/countries";

export interface RaceCandidate {
  id: string;
  name: string;
  party?: string;
  partyName?: string | null;
  partyColor?: string | null;
  partyLogoUrl?: string | null;
  isPartyMatch: boolean;
  alreadyEndorsedByMe: boolean;
}

export interface Race {
  electionId: string;
  title: string;
  /** Election phase. Primary = candidates competing within a party.
   *  General = parties competing for the seat. Computed from primaryEndTime. */
  phase?: "primary" | "general";
  candidates: RaceCandidate[];
}

interface Props {
  races: Race[];
  countryId: string;
  stateId: string;
  viewerIsHolder: boolean;
  onChange: () => void;
  /** Optional endpoint override for the EndorseButton (e.g. point at the
   *  national-leader endorsements route instead of the governor's). */
  endorseEndpoint?: string;
}

export function RaceList({
  races,
  countryId,
  stateId,
  viewerIsHolder,
  onChange,
  endorseEndpoint,
}: Props) {
  if (races.length === 0) {
    return <p className="text-sm text-muted">No active races in this state.</p>;
  }
  const cid = countryId.toUpperCase() as CountryId;
  return (
    <ul className="space-y-3">
      {races.map((race) => (
        <li key={race.electionId} className="rounded-xl border border-card-border bg-card p-4">
          <div className="mb-2 flex items-center gap-2">
            <div className="font-medium">{race.title}</div>
            {race.phase && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  race.phase === "primary" ? "bg-warning/15 text-warning" : "bg-info/15 text-info"
                }`}
              >
                {race.phase}
              </span>
            )}
          </div>
          {race.candidates.length === 0 ? (
            <p className="text-xs text-muted">No active candidates.</p>
          ) : (
            <ul className="space-y-1">
              {race.candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm py-1">
                  <span
                    className={`inline-flex items-center gap-2 ${
                      c.isPartyMatch ? "text-foreground" : "text-muted opacity-60"
                    }`}
                  >
                    <span>{c.name}</span>
                    {c.partyName && c.partyColor ? (
                      <PartyChip
                        partyName={c.partyName}
                        partyColor={c.partyColor}
                        partyId={c.party}
                        countryId={cid}
                        logoUrl={c.partyLogoUrl}
                      />
                    ) : c.party ? (
                      <span className="text-xs text-muted">({c.party})</span>
                    ) : null}
                  </span>
                  <EndorseButton
                    countryId={countryId}
                    stateId={stateId}
                    electionId={race.electionId}
                    candidateId={c.id}
                    disabled={!viewerIsHolder || !c.isPartyMatch || c.alreadyEndorsedByMe}
                    disabledReason={
                      c.alreadyEndorsedByMe
                        ? "You already endorsed this candidate in this race."
                        : !c.isPartyMatch
                          ? "Cross-party endorsements aren't permitted from the office."
                          : !viewerIsHolder
                            ? "You can't endorse from this office right now."
                            : undefined
                    }
                    label={c.alreadyEndorsedByMe ? "Endorsed" : "Endorse"}
                    onSuccess={onChange}
                    endpoint={endorseEndpoint}
                  />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
