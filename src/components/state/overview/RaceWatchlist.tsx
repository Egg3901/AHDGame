"use client";

import Link from "next/link";
import type { OverviewViewModel, HotRaceSummary } from "@/lib/states/overview/types";
import { raceLabel } from "./raceLabel";

/**
 * Race Watchlist card — list of competitive (hot + lean) races in this
 * state. Phase 1 ships an empty state; Phase 4+ wires real data via the
 * existing election resolution pipeline.
 *
 * See plan Task 1.6.
 */
export function RaceWatchlist({ vm }: { vm: OverviewViewModel }) {
  if (vm.hotRaces.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
        <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">
          Race Watchlist
        </div>
        <div className="mt-2 text-sm opacity-70">No competitive races to watch yet.</div>
        <div className="mt-1 text-[10px] italic opacity-60">
          A race appears here once its general phase begins and the top-2 candidates&apos; vote
          share is within 15 percentage points.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Race Watchlist</div>
      <ul className="mt-2 space-y-2">
        {vm.hotRaces.map((race) => (
          <RaceRow key={race.electionId} race={race} />
        ))}
      </ul>
    </div>
  );
}

function RaceRow({ race }: { race: HotRaceSummary }) {
  const statusClasses =
    race.status === "hot"
      ? "bg-rose-500/10 text-rose-500 border-rose-500/40"
      : race.status === "lean"
        ? "bg-amber-500/10 text-amber-500 border-amber-500/40"
        : "bg-emerald-500/10 text-emerald-500 border-emerald-500/40";

  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <Link href={race.url} className="flex-1 truncate font-medium hover:underline">
        {labelFor(race)}
      </Link>
      <span
        className={
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide " +
          statusClasses
        }
      >
        {race.status.toUpperCase()}
      </span>
      <span className="shrink-0 text-xs tabular-nums opacity-70">
        {race.topTwoMargin.toFixed(1)}
      </span>
    </li>
  );
}

function labelFor(race: HotRaceSummary): string {
  return raceLabel(race);
}
