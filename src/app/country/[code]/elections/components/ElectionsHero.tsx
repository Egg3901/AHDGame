"use client";

/**
 * Page hero: image band, title, and the three numbers that frame the page.
 *
 * "Contested" is deliberately prominent. At the start of an iteration every race
 * has zero candidates, and a player needs to see that as open ground rather than
 * as an empty page.
 */

import { HeroImage } from "@/components/HeroImage";
import { HeroStatsStrip } from "@/components/ui";
import { useGameClock } from "@/contexts/useGameClock";
import type { ElectionsSummary } from "../electionsSelectors";

const HERO_SRC =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Women_practice_voting_in_Dayton_Oct._27%2C_1920.jpg/960px-Women_practice_voting_in_Dayton_Oct._27%2C_1920.jpg";

export function ElectionsHero({
  countryName,
  summary,
  showStats,
}: {
  countryName: string;
  summary: ElectionsSummary;
  showStats: boolean;
}) {
  const clock = useGameClock();
  const nextClose =
    summary.nextDeadlineTurn != null
      ? clock.formatRemainingTurns(summary.nextDeadlineTurn).text
      : null;

  return (
    <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
      <div className="relative h-[175px] w-full sm:h-[220px]">
        <HeroImage
          src={HERO_SRC}
          alt="Women practicing voting in Dayton, Ohio (1920)"
          fill
          className="object-cover object-center"
          sizes="(max-width: 1280px) 100vw, 1280px"
          priority
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-0 flex flex-col justify-end px-5 py-4 sm:px-6 sm:py-5">
          <h1
            data-coach="nav-elections"
            className="text-3xl font-bold text-white drop-shadow-md sm:text-4xl"
          >
            {countryName} Elections
          </h1>
          <p className="mt-1 text-sm text-white/80 drop-shadow sm:text-base">
            Pick an office, find your seat, and file to stand.
          </p>
        </div>
      </div>

      {showStats && (
        <HeroStatsStrip layout="grid">
          <Stat label="Races" value={String(summary.total)} />
          <Stat label="Contested" value={`${summary.contested} of ${summary.total}`} />
          <Stat label="Next to close" value={nextClose ?? "No deadline"} />
        </HeroStatsStrip>
      )}
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-max flex-col px-5 py-3">
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted">{label}</span>
      <span className="mt-0.5 text-base font-bold tabular-nums">{value}</span>
    </div>
  );
}
