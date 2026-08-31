"use client";

/**
 * Non-presidential results, in the "Blend" treatment: broadcast chrome around
 * an editorial count.
 *
 * Layout follows the design — a verdict hero, then a two-column body with the
 * seat allocation and the expandable count on the left, and the clock and the
 * trend chart in a right rail.
 */

import React, { useMemo } from "react";
import { Card } from "@/components/ui";
import { GeneralVoteCharts, type LineSeries } from "./ElectionDetailCharts";
import { BlendDetailHero, BlendClock } from "@/components/elections/blend/BlendDetailHero";
import { BlendSeatAllocation } from "@/components/elections/blend/BlendSeatAllocation";
import { BlendDetailTally } from "@/components/elections/blend/BlendDetailTally";
import { buildBlendDetail, type BlendClockRow } from "@/lib/elections/blendDetailViewModel";
import type { RegionElectorate } from "@/lib/elections/blendRegionViewModel";
import type { CountryId } from "@/lib/constants/countries";
import type { CandidateDetail, GeneralVotes } from "./ElectionDetailTypes";

interface NonPresidentialResultsPanelProps {
  sorted: CandidateDetail[];
  tally: GeneralVotes;
  totalVotesCast: number;
  isEnded: boolean;
  totalSeats: number | null;
  lineSeries: LineSeries[];
  countryId: CountryId;
  electionType: string;
  /** Region the race is fought in, as displayed. */
  regionName: string;
  countryName: string;
  /** LARP year, null on legacy rows without one. */
  year: number | null;
  /** Deadline rows for the Clock card, built by the caller from the game clock. */
  clockRows: BlendClockRow[];
  /** Region electorate for the turnout fact, with the basis it was measured on. */
  electorate?: RegionElectorate;
  /** Party abbreviation by party id, from the response's `partyDisplayById`. */
  partyDisplayById?: Record<string, { abbr: string; color: string }>;
  /** Endorse control per candidate. Omitted when the viewer cannot endorse. */
  renderEndorse?: (candidate: CandidateDetail) => React.ReactNode;
  /** Slot rendered under the count — the persuasion drivers card. */
  afterTally?: React.ReactNode;
}

export function NonPresidentialResultsPanel({
  sorted,
  tally,
  totalVotesCast,
  isEnded,
  totalSeats,
  lineSeries,
  countryId,
  electionType,
  regionName,
  countryName,
  year,
  clockRows,
  electorate,
  partyDisplayById,
  renderEndorse,
  afterTally,
}: NonPresidentialResultsPanelProps) {
  const byId = useMemo(() => new Map(sorted.map((c) => [c.id, c])), [sorted]);

  const model = useMemo(
    () =>
      buildBlendDetail({
        candidates: sorted.map((c) => ({
          id: c.id,
          characterName: c.characterName,
          party: c.party,
          partyName: c.partyName,
          partyColor: c.partyColor,
          isYou: c.isYou,
          isNPP: c.isNPP,
        })),
        totalVotes: tally.totalVotes,
        seatsEstimate: tally.seatsEstimate,
        totalSeats,
        electionType,
        countryId,
        isEnded,
        regionName,
        // Falls back to the full party name rather than printing an empty cell
        // for a party the display map does not cover.
        partyAbbr: (partyId) =>
          partyDisplayById?.[partyId]?.abbr ||
          sorted.find((c) => c.party === partyId)?.partyName ||
          partyId,
        electorate,
        turnCount: tally.turnSnapshots.length,
      }),
    [
      sorted,
      tally,
      totalSeats,
      electionType,
      countryId,
      isEnded,
      regionName,
      electorate,
      partyDisplayById,
    ]
  );

  return (
    <div className="space-y-4">
      <BlendDetailHero
        model={model}
        countryName={countryName}
        regionName={regionName}
        year={year}
      />

      {/* The design puts the clock and the trend in a right rail. This page
          already has its own right sidebar, and the main column it hands us is
          roughly 650px — nesting a second rail inside it squeezed the count
          rows to the point of overlapping. So the column stacks, and the clock
          and trend sit side by side underneath where they still read. */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <BlendSeatAllocation model={model} regionName={regionName} />

          <BlendDetailTally
            model={model}
            hrefFor={(row) => {
              const c = byId.get(row.candidateId);
              if (!c) return null;
              return c.isNPP ? `/politicians/npp/${c.nppId}` : `/character/${c.characterId}`;
            }}
            renderEndorse={
              renderEndorse
                ? (candidateId) => {
                    const c = byId.get(candidateId);
                    return c ? renderEndorse(c) : null;
                  }
                : undefined
            }
          />

          {afterTally}
        </div>

        <div className="grid min-w-0 gap-4 md:grid-cols-3 md:items-start">
          <div className="min-w-0">
            <BlendClock rows={clockRows} />
          </div>

          <div className="min-w-0 md:col-span-2">
            <Card title="How the count moved">
              <GeneralVoteCharts
                snapshots={tally.turnSnapshots}
                series={lineSeries}
                totalSeats={totalSeats}
              />
            </Card>
          </div>
        </div>
      </div>

      {totalVotesCast <= 0 && (
        <p className="text-sm text-muted">
          No ballots have been counted in this race yet. Figures appear as the count comes in.
        </p>
      )}
    </div>
  );
}
