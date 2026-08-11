"use client";

import React from "react";
import { Card } from "@/components/ui";
import type { CandidateDetail } from "./ElectionDetailTypes";

interface SeatOutcomeHeadlineProps {
  sorted: CandidateDetail[];
  colorMap: Map<string, string>;
  seatsEstimate: Record<string, number>;
  totalSeats: number;
  isEnded: boolean;
}

/**
 * The seat result, stated first and stated plainly. A multi-seat race is about
 * the seat count, not the vote share — but the seat numbers used to sit in a
 * small panel below the pie chart and the trend graph, so the page led with
 * the least decisive figure.
 *
 * A stacked block bar reads faster than a pie here: each block is one seat, so
 * "8 of 15" is countable rather than estimated from an angle.
 */
export function SeatOutcomeHeadline({
  sorted,
  colorMap,
  seatsEstimate,
  totalSeats,
  isEnded,
}: SeatOutcomeHeadlineProps) {
  const withSeats = sorted
    .map((c) => ({ candidate: c, seats: seatsEstimate[c.id] ?? 0 }))
    .filter((row) => row.seats > 0);

  const you = sorted.find((c) => c.isYou);
  const yourSeats = you ? (seatsEstimate[you.id] ?? 0) : null;
  const leader = withSeats[0];

  // One block per seat, in finishing order. Any seat not yet allocated stays
  // as an empty block rather than silently shrinking the bar.
  const blocks: { color: string; key: string }[] = [];
  for (const { candidate, seats } of withSeats) {
    for (let i = 0; i < seats; i++) {
      blocks.push({ color: colorMap.get(candidate.id) ?? "#888", key: `${candidate.id}-${i}` });
    }
  }
  const unallocated = Math.max(0, totalSeats - blocks.length);

  const headline =
    yourSeats !== null
      ? `${isEnded ? "You won" : "You are projected"} ${yourSeats} of ${totalSeats} seat${totalSeats === 1 ? "" : "s"}`
      : leader
        ? `${leader.candidate.characterName} ${isEnded ? "won" : "leads with"} ${leader.seats} of ${totalSeats} seat${totalSeats === 1 ? "" : "s"}`
        : `${totalSeats} seat${totalSeats === 1 ? "" : "s"} up for election`;

  const accent = you
    ? (colorMap.get(you.id) ?? "#888")
    : leader
      ? (colorMap.get(leader.candidate.id) ?? "#888")
      : undefined;

  return (
    <Card className="mb-4" accentColor={accent}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
        {isEnded ? "Final seat allocation" : "Projected seat allocation"}
      </div>
      <div
        className="mt-1 text-2xl font-bold sm:text-3xl"
        style={accent ? { color: accent } : undefined}
      >
        {headline}
      </div>

      <div className="mt-4 flex gap-0.5" role="img" aria-label={headline}>
        {blocks.map((b) => (
          <div
            key={b.key}
            className="h-6 min-w-0 flex-1 rounded-[2px]"
            style={{ backgroundColor: b.color }}
          />
        ))}
        {Array.from({ length: unallocated }, (_, i) => (
          <div key={`empty-${i}`} className="h-6 min-w-0 flex-1 rounded-[2px] bg-card-border" />
        ))}
      </div>

      <div className="mt-3 space-y-1.5 border-t border-card-border pt-3">
        {withSeats.length === 0 ? (
          <p className="text-xs text-muted">
            No candidate has cleared the minimum vote share for a seat yet.
          </p>
        ) : (
          withSeats.map(({ candidate, seats }) => (
            <div key={candidate.id} className="flex items-center gap-2 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: colorMap.get(candidate.id) }}
              />
              <span className="min-w-0 flex-1 truncate">
                {candidate.characterName}
                {candidate.isYou && <span className="ml-1 text-xs text-primary">(you)</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {seats} seat{seats === 1 ? "" : "s"}
              </span>
            </div>
          ))
        )}
      </div>

      {!isEnded && (
        <p className="mt-3 text-xs text-muted/60">
          Seats update each turn from the current vote count, using largest-remainder allocation.
          Final allocation is set when the election closes.
        </p>
      )}
    </Card>
  );
}
