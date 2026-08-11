"use client";

import React from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { PartyLogo } from "@/components/PartyLogo";
import { Card, ResponsiveTable, type ResponsiveTableColumn } from "@/components/ui";
import { GeneralVoteCharts, PieChart, type LineSeries } from "./ElectionDetailCharts";
import { formatVotes } from "./ElectionDetailHelpers";
import { SeatOutcomeHeadline } from "./SeatOutcomeHeadline";
import type { CandidateDetail, GeneralVotes } from "./ElectionDetailTypes";

interface PieSlice {
  label: string;
  pct: number;
  color: string;
  partyId?: string;
}

interface NonPresidentialResultsPanelProps {
  sorted: CandidateDetail[];
  colorMap: Map<string, string>;
  tally: GeneralVotes;
  grandTotal: number;
  totalVotesCast: number;
  isEnded: boolean;
  totalSeats: number | null;
  pieSlices: PieSlice[];
  lineSeries: LineSeries[];
  countryId: "US" | "UK" | "DE";
  /** Endorse control per candidate. Omitted when the viewer cannot endorse. */
  renderEndorse?: (candidate: CandidateDetail) => React.ReactNode;
  /** Slot rendered between the tally and the trend charts — the drivers card. */
  afterTally?: React.ReactNode;
}

export function NonPresidentialResultsPanel({
  sorted,
  colorMap,
  tally,
  grandTotal,
  totalVotesCast,
  isEnded,
  totalSeats,
  pieSlices,
  lineSeries,
  countryId,
  renderEndorse,
  afterTally,
}: NonPresidentialResultsPanelProps) {
  const hasTurns = tally.turnSnapshots.length > 0;
  const isMultiSeat = !!totalSeats && totalSeats > 1;
  const partyIdByCandidate = new Map(sorted.map((c, i) => [c.id, pieSlices[i]?.partyId] as const));

  const columns: ResponsiveTableColumn<CandidateDetail>[] = [
    {
      key: "candidate",
      header: "Candidate",
      render: (c) => {
        const color = colorMap.get(c.id) ?? "#888";
        const partyId = partyIdByCandidate.get(c.id);
        const href = c.isNPP ? `/politicians/npp/${c.nppId}` : `/character/${c.characterId}`;
        const seatsWon = tally.seatsEstimate?.[c.id] ?? 0;
        const isWinner = isEnded && (totalSeats ? seatsWon > 0 : sorted[0]?.id === c.id);
        return (
          <div className="flex items-center gap-2">
            {partyId ? (
              <PartyLogo
                partyId={partyId}
                partyColor={color}
                countryId={countryId}
                size="h-3 w-3"
              />
            ) : (
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
            )}
            <Avatar url={c.avatarUrl} name={c.characterName} size="h-5 w-5" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={href}
                  className="truncate font-semibold transition-colors hover:text-primary"
                >
                  {c.characterName}
                </Link>
                {c.isYou && (
                  <span className="shrink-0 rounded-full border border-primary/40 bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                    You
                  </span>
                )}
                {c.isNPP && (
                  <span className="shrink-0 rounded-full border border-purple-500/40 bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
                    NPP
                  </span>
                )}
                {isWinner && (
                  <span className="shrink-0 rounded-full border border-yellow-500/40 bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
                    Winner
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted">{c.partyName}</div>
            </div>
          </div>
        );
      },
    },
    {
      key: "votes",
      header: "Votes",
      mobileLabel: "Votes",
      render: (c) => (
        <span className="tabular-nums text-muted">
          {totalVotesCast > 0 ? formatVotes(tally.totalVotes[c.id] ?? 0) : "—"}
        </span>
      ),
    },
    {
      key: "share",
      header: "Share",
      mobileLabel: "Share",
      render: (c) => {
        const votes = tally.totalVotes[c.id] ?? 0;
        const pct = grandTotal > 0 ? (votes / grandTotal) * 100 : 0;
        const color = colorMap.get(c.id) ?? "#888";
        const isLeader = sorted[0]?.id === c.id && totalVotesCast > 0;
        return (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-card-border sm:w-24">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(0, Math.min(100, pct))}%`,
                  backgroundColor: color,
                }}
              />
            </div>
            <span
              className={`tabular-nums ${isLeader ? "font-bold" : "font-medium text-muted"}`}
              style={isLeader ? { color } : undefined}
            >
              {totalVotesCast > 0 ? `${pct.toFixed(1)}%` : "—"}
            </span>
          </div>
        );
      },
    },
  ];

  if (isMultiSeat && tally.seatsEstimate) {
    columns.push({
      key: "seats",
      header: "Seats",
      mobileLabel: "Seats",
      render: (c) => (
        <span className="font-semibold tabular-nums">{tally.seatsEstimate?.[c.id] ?? 0}</span>
      ),
    });
  }

  return (
    <div className="space-y-4">
      {/* Multi-seat races lead with the seat count — the number that decides
          the race. Single-winner races keep the share donut, where the shape
          of the split is the story. */}
      {isMultiSeat && tally.seatsEstimate ? (
        <SeatOutcomeHeadline
          sorted={sorted}
          colorMap={colorMap}
          seatsEstimate={tally.seatsEstimate}
          totalSeats={totalSeats!}
          isEnded={isEnded}
        />
      ) : null}

      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2 text-xs font-medium sm:px-5 sm:py-2.5 ${
          isEnded
            ? "border-green-500/20 bg-green-500/10 text-green-400"
            : "border-blue-500/20 bg-blue-500/10 text-blue-400"
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              isEnded ? "bg-green-400" : "animate-pulse bg-blue-400"
            }`}
          />
          {isEnded ? "Final Results" : "Live Vote Tally"}
        </span>
        {hasTurns && (
          <span className="font-normal text-muted">
            {formatVotes(totalVotesCast)} votes cast
            {" · "}
            {tally.turnSnapshots.length} turn
            {tally.turnSnapshots.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* ResponsiveTable becomes stacked cards under `md`. The old markup put a
          fixed 120px pie beside a four-column table inside a bare
          `overflow-x-auto`, so on a phone the chart ate ~40% of the width and
          the numbers scrolled sideways. */}
      <ResponsiveTable
        columns={columns}
        data={sorted}
        keyExtractor={(c) => c.id}
        emptyMessage="No candidates in this race."
        renderActions={renderEndorse}
      />

      {!isMultiSeat && pieSlices.length > 0 && (
        <Card title="Vote share">
          <div className="flex justify-center">
            <PieChart slices={pieSlices} size={160} />
          </div>
        </Card>
      )}

      {afterTally}

      <Card title="Election Trends">
        <GeneralVoteCharts
          snapshots={tally.turnSnapshots}
          series={lineSeries}
          totalSeats={totalSeats}
        />
      </Card>
    </div>
  );
}
