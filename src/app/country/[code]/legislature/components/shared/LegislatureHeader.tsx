"use client";

import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { HeroStatsStrip } from "@/components/ui";
import type { CountryId } from "@/lib/constants/countries";

interface LegislatureHeaderProps {
  countryId: CountryId;
  title: string;
  subtitle: string;
  heroImage: string;
  heroAlt: string;

  stats: {
    majorityParty: { name: string; color: string; seats: number };
    totalSeats: number;
    leader: { label: string; name: string; id: string; sequentialId?: number | null } | null;
    /**
     * Opposition/minority leader. `null` renders the cell as Vacant;
     * `undefined` omits the cell entirely (one-party legislatures where the
     * office does not exist — RU, DD).
     */
    minorityLeader?: {
      label: string;
      name: string;
      id: string;
      sequentialId?: number | null;
    } | null;
  };

  chamberSwitcher?: {
    active: string;
    onSwitch: (chamber: string) => void;
    options: Array<{ key: string; label: string; disabled?: boolean; title?: string }>;
  };
}

/**
 * Shared header component for legislature pages (US Congress & UK Parliament)
 * Displays hero image with title/subtitle and a stats strip showing:
 * - Majority party (with color)
 * - Total seats count
 * - Leader (PM/Speaker/Senate Majority Leader)
 * - Minority/Opposition Leader
 *
 * Optionally includes a chamber switcher for bicameral systems (US only).
 */
export default function LegislatureHeader({
  countryId: _countryId,
  title,
  subtitle,
  heroImage,
  heroAlt,
  stats,
  chamberSwitcher,
}: LegislatureHeaderProps) {
  return (
    <header className="relative mb-5 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
      {/* Hero image */}
      <div className="relative h-[175px] w-full sm:h-[220px]">
        <HeroImage
          src={heroImage}
          alt={heroAlt}
          fill
          className="object-cover object-center"
          sizes="(max-width: 1280px) 100vw, 1280px"
          priority
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
          {/* Top: chamber switcher (US only) */}
          {chamberSwitcher && (
            <div
              className="flex rounded-lg overflow-hidden w-fit border border-white/30 backdrop-blur-sm"
              role="tablist"
              aria-label="Chamber"
            >
              {chamberSwitcher.options.map((opt) => (
                <button
                  key={opt.key}
                  role="tab"
                  id={`chamber-tab-${opt.key}`}
                  aria-selected={chamberSwitcher.active === opt.key}
                  aria-controls="legislature-content"
                  aria-disabled={opt.disabled}
                  onClick={() => !opt.disabled && chamberSwitcher.onSwitch(opt.key)}
                  className={`px-4 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    opt.disabled
                      ? "bg-transparent text-white/30 cursor-not-allowed"
                      : chamberSwitcher.active === opt.key
                        ? "bg-white/20 text-white"
                        : "bg-transparent text-white/70 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          {/* Bottom: title + subtitle */}
          <div>
            <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-2xl">
              {title}
            </h2>
            <p className="mt-1 text-sm text-white/90 drop-shadow sm:text-base">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <HeroStatsStrip>
        {/* Majority party */}
        <div className="flex flex-col px-5 py-3 min-w-[140px]">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            Majority Party
          </span>
          <span
            className="text-base font-bold tabular-nums"
            style={{ color: stats.majorityParty.color }}
          >
            {stats.majorityParty.name}
          </span>
        </div>

        {/* Seats */}
        <div className="flex flex-col px-5 py-3 min-w-[100px]">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            Seats
          </span>
          <span className="text-base font-bold tabular-nums">
            {stats.majorityParty.seats} / {stats.totalSeats}
          </span>
        </div>

        {/* Leader (PM/Speaker/Senate Majority Leader) */}
        <div className="flex flex-col px-5 py-3 min-w-[160px]">
          <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
            {stats.leader?.label ?? "Leader"}
          </span>
          {stats.leader ? (
            <Link
              href={`/character/${stats.leader.sequentialId ?? stats.leader.id}`}
              className="text-base font-bold text-primary hover:underline truncate"
            >
              {stats.leader.name}
            </Link>
          ) : (
            <span className="text-base font-bold text-muted">Vacant</span>
          )}
        </div>

        {/* Minority/Opposition Leader — omitted where the office does not exist */}
        {stats.minorityLeader !== undefined && (
          <div className="flex flex-col px-5 py-3 min-w-[160px]">
            <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
              {stats.minorityLeader?.label ?? "Minority Leader"}
            </span>
            {stats.minorityLeader ? (
              <Link
                href={`/character/${stats.minorityLeader.sequentialId ?? stats.minorityLeader.id}`}
                className="text-base font-bold text-primary hover:underline truncate"
              >
                {stats.minorityLeader.name}
              </Link>
            ) : (
              <span className="text-base font-bold text-muted">Vacant</span>
            )}
          </div>
        )}
      </HeroStatsStrip>
    </header>
  );
}
