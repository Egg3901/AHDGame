"use client";

import Link from "next/link";
import type { OverviewViewModel, HotRaceSummary, RaceContender } from "@/lib/states/overview/types";
import { raceLabel } from "./raceLabel";

/**
 * Close races: the general-phase races in this state where the top two
 * candidates are within reach of each other (see `WATCHLIST_MARGIN_PP` in
 * `getStateOverview.ts`). Each row shows the leader and runner-up (name,
 * party, vote share) and the margin tier from the same `classifyMarginTier`
 * bands the presidential Battleground map uses, so "close" means the same
 * thing everywhere in the app.
 */
export function RaceWatchlist({ vm }: { vm: OverviewViewModel }) {
  return (
    <section
      aria-labelledby="overview-races-title"
      className="rounded-xl border border-card-border bg-card p-5 sm:p-6"
    >
      <h2 id="overview-races-title" className="text-heading-sm font-semibold text-foreground">
        Close races
      </h2>
      {vm.hotRaces.length === 0 ? (
        <p className="mt-2 text-body text-muted">
          None yet. A race shows here once its general phase begins and the top two are within 15
          points.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-card-border">
          {vm.hotRaces.map((race) => (
            <RaceRow key={race.electionId} race={race} />
          ))}
        </ul>
      )}
    </section>
  );
}

const TIER_META: Record<HotRaceSummary["status"], { label: string; className: string }> = {
  tossup: { label: "Toss-up", className: "text-error" },
  lean: { label: "Lean", className: "text-warning" },
  likely: { label: "Likely", className: "text-info" },
  // Defensive: the watchlist filters out margins at/above the "safe"
  // boundary, so this tier should not actually appear in practice.
  safe: { label: "Safe", className: "text-success" },
};

function RaceRow({ race }: { race: HotRaceSummary }) {
  return (
    <li className="py-3 first:pt-1 last:pb-0">
      <div className="flex items-baseline justify-between gap-2">
        <Link
          href={race.url}
          className="min-w-0 flex-1 truncate text-body font-medium text-foreground hover:underline underline-offset-4"
        >
          {raceLabel(race)}
        </Link>
        <span className="shrink-0 text-body-sm text-muted">
          <span className={`font-medium ${TIER_META[race.status].className}`}>
            {TIER_META[race.status].label}
          </span>
          , {race.topTwoMargin.toFixed(1)} pts
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        <ContenderRow contender={race.leader} />
        <ContenderRow contender={race.runnerUp} muted />
      </div>
      {race.contenderCount > 2 && (
        <p className="mt-1 text-body-sm text-muted">{race.contenderCount} candidates in total</p>
      )}
    </li>
  );
}

function ContenderRow({ contender, muted }: { contender: RaceContender; muted?: boolean }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 text-body-sm ${muted ? "text-muted" : "text-foreground"}`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: contender.partyColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{contender.name}</span>
      <span className="shrink-0 text-muted">{contender.partyAbbr}</span>
      <span className="w-12 shrink-0 text-right font-medium tabular-nums">
        {contender.votePct.toFixed(1)}%
      </span>
    </div>
  );
}
