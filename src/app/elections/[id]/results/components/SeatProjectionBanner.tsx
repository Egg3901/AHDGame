"use client";

import type { NationalResults } from "@/lib/elections/liveResults/types";

interface SeatProjectionBannerProps {
  national: NationalResults;
  isLive: boolean;
}

/**
 * The projection call. Westminster style gets the classic broadcast wording —
 * "LABOUR MAJORITY of 24" / "HUNG PARLIAMENT" — generic chambers get
 * largest-party phrasing. Copy is a projection until the count completes.
 */
export function SeatProjectionBanner({ national, isLive }: SeatProjectionBannerProps) {
  const { projection, style, chamberLabel, regionsDeclared, totalRegions } = national;
  if (projection.kind === "tooEarly") return null;

  const prefix = isLive
    ? regionsDeclared === 0
      ? "Exit poll projection"
      : "Projection"
    : "Result";

  const topParty = national.parties.find((p) => p.party === projection.partyId);
  const accent = topParty?.color ?? "var(--primary)";

  let headline: string;
  if (projection.kind === "majority") {
    headline =
      style === "westminster"
        ? `${projection.partyName?.toUpperCase()} MAJORITY of ${projection.margin}`
        : `${projection.partyName} wins a ${chamberLabel} majority`;
  } else if (projection.kind === "hung") {
    headline = `HUNG PARLIAMENT — ${projection.partyName} largest party`;
  } else {
    headline = `${projection.partyName} largest party${
      projection.margin ? ` (+${projection.margin} seats)` : ""
    }`;
  }

  return (
    <div
      className="results-card-in rounded-xl border p-4"
      style={{
        borderColor: `${accent}55`,
        background: `linear-gradient(90deg, ${accent}1f, transparent 65%)`,
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {prefix} · {chamberLabel}
        {isLive ? ` · ${regionsDeclared}/${totalRegions} regions declared` : ""}
      </div>
      <div className="mt-0.5 flex items-center gap-2.5">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: accent }} />
        <span className="text-lg font-bold sm:text-xl">{headline}</span>
      </div>
    </div>
  );
}
