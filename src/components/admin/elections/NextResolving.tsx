"use client";

import { useMemo } from "react";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import type { CountrySelection, ElectionData } from "./electionsAdminTypes";

interface NextResolvingProps {
  elections: ElectionData[];
  selectedCountry: CountrySelection;
  expanded: boolean;
  nowMs: number;
  currentTurn: number | null;
  onToggle: () => void;
}

const TYPE_SHORT: Record<string, string> = {
  house: "House",
  senate: "Senate",
  governor: "Governor",
  stateSenate: "St. Senate",
  president: "President",
  commons: "Commons",
  snap_commons: "Snap Commons",
  regionalCouncil: "Reg. Council",
  shugiin: "Shūgiin",
  sangiin: "Sangiin",
  snap_shugiin: "Snap Shūgiin",
};

export function NextResolving({
  elections,
  selectedCountry,
  expanded,
  nowMs,
  currentTurn,
  onToggle,
}: NextResolvingProps) {
  const isGlobal = selectedCountry === "global";

  // Find the next deadline for each election (primary closing or general
  // closing, whichever is soonest and still in the future).
  const upcoming = useMemo(() => {
    const now = nowMs;
    return (
      elections
        .filter((e) => e.status === "active" && (e.endTurn != null || e.endTime))
        .map((e) => {
          // Turn-first: order/label by turns-to-resolution so the list reflects
          // the turn-based engine and doesn't drift when the cron lags behind
          // wall-clock. Wall-clock hours is a fallback only for legacy rows
          // missing the turn fields.
          if (currentTurn != null && e.endTurn != null) {
            const endT = e.endTurn;
            const priT = e.primaryEndTurn ?? null;
            const isPrimaryNext = priT != null && priT > currentTurn && priT < endT;
            const nextT = isPrimaryNext ? priT : endT;
            const unitsLeft = Math.max(0, nextT - currentTurn);
            return { election: e, isPrimaryNext, unitsLeft, unit: "t" as const };
          }
          const endMs = new Date(e.endTime!).getTime();
          const priEndMs = e.primaryEndTime ? new Date(e.primaryEndTime).getTime() : 0;
          const isPrimaryNext = priEndMs > now && priEndMs < endMs;
          const nextMs = isPrimaryNext ? priEndMs : endMs;
          const unitsLeft = Math.max(0, Math.round((nextMs - now) / (60 * 60 * 1000)));
          return { election: e, isPrimaryNext, unitsLeft, unit: "h" as const };
        })
        // unitsLeft is turns when available, hours for legacy fallback — both
        // sort soonest-first within a single game era.
        .sort((a, b) => a.unitsLeft - b.unitsLeft)
    );
  }, [elections, nowMs, currentTurn]);

  const INITIAL_COUNT = 5;
  const visible = expanded ? upcoming : upcoming.slice(0, INITIAL_COUNT);
  const hasMore = upcoming.length > INITIAL_COUNT;

  return (
    <div className="rounded-lg border border-card-border bg-card p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
        Next Resolving
      </div>
      <div className="text-[11px]">
        {visible.map(({ election: e, isPrimaryNext, unitsLeft, unit }) => {
          const flagCountry =
            isGlobal && e.countryId ? (e.countryId as keyof typeof COUNTRY_CONFIGS) : null;
          const classLabel =
            e.electionType === "senate" && e.senateClass
              ? ` Cls ${e.senateClass}`
              : e.electionType === "sangiin" && e.chamberClass
                ? ` Cls ${e.chamberClass}`
                : "";
          return (
            <div
              key={e._id}
              className="flex items-center justify-between border-b border-card-border/50 py-1"
            >
              <span className="truncate">
                {flagCountry && (
                  <CountryFlag country={flagCountry as string} size="sm" className="mr-1" />
                )}
                {e.state} {TYPE_SHORT[e.electionType] ?? e.electionType}
                {classLabel && <span className="text-muted">{classLabel}</span>}
              </span>
              <span className="ml-2 flex shrink-0 items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                    isPrimaryNext
                      ? "bg-amber-500/15 text-amber-500"
                      : "bg-green-500/15 text-green-500"
                  }`}
                >
                  {isPrimaryNext ? "Pri" : "Gen"}
                </span>
                <span
                  className={`tabular-nums ${unitsLeft <= 12 ? "text-amber-500" : "text-muted"}`}
                  title={unit === "t" ? "turns remaining" : "hours remaining (legacy)"}
                >
                  {unitsLeft}
                  {unit}
                </span>
              </span>
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="py-2 text-center text-muted">No upcoming elections</div>
        )}
        {hasMore && (
          <button
            onClick={onToggle}
            className="mt-1 w-full text-center text-[10px] text-primary hover:underline"
          >
            {expanded ? "Show less" : `Show ${upcoming.length - INITIAL_COUNT} more`}
          </button>
        )}
      </div>
    </div>
  );
}
