"use client";

import Link from "next/link";
import type { OverviewViewModel, HotRaceSummary, RaceContender } from "@/lib/states/overview/types";
import { raceLabel } from "./raceLabel";

/**
 * Race Watchlist card — the general-phase races in this state where the
 * top-2 candidates are genuinely close (see `WATCHLIST_MARGIN_PP` in
 * `getStateOverview.ts`). Each row shows the leader and runner-up (name,
 * party, vote share), the margin between them, and a margin-tier badge
 * reused from the same `classifyMarginTier` bands the presidential
 * Battleground map uses — so "close" means the same thing everywhere in
 * the app.
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
          share is under 15 percentage points apart.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">Race Watchlist</div>
      <ul className="mt-2 divide-y divide-[var(--card-border)]">
        {vm.hotRaces.map((race) => (
          <RaceRow key={race.electionId} race={race} />
        ))}
      </ul>
    </div>
  );
}

const TIER_META: Record<HotRaceSummary["status"], { label: string; className: string }> = {
  tossup: {
    label: "TOSS-UP",
    className: "bg-rose-500/10 text-rose-500 border-rose-500/40",
  },
  lean: {
    label: "LEAN",
    className: "bg-amber-500/10 text-amber-500 border-amber-500/40",
  },
  likely: {
    label: "LIKELY",
    className: "bg-sky-500/10 text-sky-500 border-sky-500/40",
  },
  // Defensive: the watchlist filters out margins at/above the "safe"
  // boundary, so this tier should not actually appear in practice.
  safe: {
    label: "SAFE",
    className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/40",
  },
};

function RaceRow({ race }: { race: HotRaceSummary }) {
  const tier = TIER_META[race.status];

  return (
    <li className="flex flex-col gap-1 py-2 text-sm first:pt-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <Link href={race.url} className="flex-1 truncate font-medium hover:underline">
          {raceLabel(race)}
        </Link>
        <span
          className={
            "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide " +
            tier.className
          }
        >
          {tier.label}
        </span>
      </div>
      <ContenderRow contender={race.leader} />
      <div className="flex items-center justify-between gap-2 text-xs opacity-70">
        <ContenderRow contender={race.runnerUp} muted />
        <span className="shrink-0 tabular-nums">
          {race.contenderCount > 2 ? `${race.contenderCount}-way, ` : ""}
          {race.topTwoMargin.toFixed(1)}pp margin
        </span>
      </div>
    </li>
  );
}

function ContenderRow({ contender, muted }: { contender: RaceContender; muted?: boolean }) {
  return (
    <div className={"flex min-w-0 items-center gap-1.5 text-xs " + (muted ? "" : "font-medium")}>
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: contender.partyColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{contender.name}</span>
      <span className="shrink-0 text-[var(--muted)]">{contender.partyAbbr}</span>
      <span className="shrink-0 tabular-nums">{contender.votePct.toFixed(1)}%</span>
    </div>
  );
}
