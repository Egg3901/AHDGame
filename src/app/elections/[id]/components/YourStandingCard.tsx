"use client";

import React from "react";
import { Card } from "@/components/ui";
import type { PartyGroup } from "./ElectionDetailTypes";

interface YourStandingCardProps {
  activeParties: PartyGroup[];
  advancingCount: number;
}

/**
 * Answers the one question a candidate opens this page to ask during a
 * primary: am I advancing, and by how much? Nothing on the page said this
 * before — the player had to find their own row in a party card, count
 * positions, and subtract two percentages by eye.
 *
 * Renders nothing for spectators and for anyone not in the race.
 */
export function YourStandingCard({ activeParties, advancingCount }: YourStandingCardProps) {
  const group = activeParties.find((g) => g.candidates.some((c) => c.isYou));
  if (!group) return null;

  // `candidates` arrives sorted by share, best first — the same order the
  // party list and the "Projected to Advance" badges rely on.
  const index = group.candidates.findIndex((c) => c.isYou);
  const me = group.candidates[index];
  const rank = index + 1;
  const total = group.candidates.length;
  const isAdvancing = index < advancingCount;
  const share = me.sharePct ?? 0;

  // Uncontested and all-advance races have no cut line to measure against.
  const guaranteed = total <= advancingCount;

  // The cut line is the last advancing slot. If you are in, your margin is
  // over the first candidate who misses out; if you are out, your gap is to
  // the candidate currently holding the last slot.
  const lastIn = group.candidates[advancingCount - 1];
  const firstOut = group.candidates[advancingCount];
  const margin = isAdvancing
    ? firstOut
      ? share - (firstOut.sharePct ?? 0)
      : null
    : lastIn
      ? (lastIn.sharePct ?? 0) - share
      : null;

  const statusLabel = guaranteed
    ? total === 1
      ? "Uncontested"
      : "Advancing"
    : isAdvancing
      ? "Projected to advance"
      : "Not advancing";

  const statusTone = guaranteed || isAdvancing ? "text-success" : "text-error";
  const accent = me.campaignColor ?? group.partyColor;

  return (
    <Card title="Your standing" accentColor={accent} className="mb-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted">Share</div>
          <div className="text-3xl font-bold tabular-nums" style={{ color: accent }}>
            {share.toFixed(1)}%
          </div>
        </div>

        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted">
            Rank in {group.partyName}
          </div>
          <div className="text-3xl font-bold tabular-nums">
            {rank}
            <span className="text-base font-medium text-muted"> of {total}</span>
          </div>
        </div>

        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted">Status</div>
          <div className={`text-lg font-semibold ${statusTone}`}>{statusLabel}</div>
        </div>
      </div>

      <p className="mt-3 border-t border-card-border pt-3 text-xs text-muted">
        {guaranteed ? (
          total === 1 ? (
            <>You are the only candidate filed in this primary. You advance to the general.</>
          ) : (
            <>
              This party has {total} candidate{total === 1 ? "" : "s"} for {advancingCount} slot
              {advancingCount === 1 ? "" : "s"}. Everyone advances.
            </>
          )
        ) : margin === null ? (
          <>
            Top {advancingCount} of {total} advance to the general.
          </>
        ) : isAdvancing ? (
          <>
            You hold slot {rank} of {advancingCount}. You are{" "}
            <span className="font-semibold text-success tabular-nums">
              {margin.toFixed(1)} points
            </span>{" "}
            clear of {firstOut?.characterName}, the first candidate to miss out.
          </>
        ) : (
          <>
            You need{" "}
            <span className="font-semibold text-error tabular-nums">
              {margin.toFixed(1)} more points
            </span>{" "}
            to pass {lastIn?.characterName} and take the last advancing slot.
          </>
        )}
      </p>
    </Card>
  );
}
