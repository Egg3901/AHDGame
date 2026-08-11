"use client";

import Link from "next/link";
import type { ChangelogEntry } from "../changelogTypes";
import { PublicEntry } from "../components/PublicEntry";
import { HeroImage } from "@/components/HeroImage";
import { HeroStatsStrip } from "@/components/ui";

export function LegacyChangelogClient({ entries }: { entries: ChangelogEntry[] }) {
  const latestVersion = entries[0]?.version ?? "—";
  const totalChanges = entries.reduce((sum, e) => sum + e.items.length, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 pb-20">
      <header className="relative mb-8 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
        <div className="relative h-[140px] w-full sm:h-[180px]">
          <HeroImage
            src="/api/images/hero/changelog"
            alt="DEC VT100 terminal"
            fill
            className="object-cover object-[center_55%]"
            sizes="(max-width: 896px) 100vw, 896px"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <h1 className="mb-1 text-2xl font-bold tracking-tight text-white">Legacy Changelog</h1>
            <p className="text-sm text-white/70">
              Player-facing updates before the v0.4.0 post-style feed.
            </p>
          </div>
        </div>
        <HeroStatsStrip>
          <div className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted">Newest here</span>
            <span className="text-base font-bold tabular-nums text-primary">{latestVersion}</span>
          </div>
          <div className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted">Versions</span>
            <span className="text-base font-bold tabular-nums text-foreground">
              {entries.length}
            </span>
          </div>
          <div className="flex flex-col px-5 py-3 min-w-max">
            <span className="text-[10px] uppercase tracking-widest text-muted">Changes</span>
            <span className="text-base font-bold tabular-nums text-foreground">{totalChanges}</span>
          </div>
        </HeroStatsStrip>
      </header>

      <div className="mb-6 rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100/90">
        This archive covers releases before v0.4.0.{" "}
        <Link href="/changelog" className="font-medium text-primary hover:underline">
          Return to the current feed
        </Link>
        .
      </div>

      <div className="relative">
        <div className="absolute bottom-3 left-[7px] top-3 w-px bg-card-border" />
        <div className="space-y-8">
          {entries.map((entry, i) => (
            <PublicEntry
              key={`${entry.version}-${i}`}
              entry={entry}
              isLatest={i === 0}
              startExpanded={i === 0}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
