"use client";

import {
  ALIGNMENT_META,
  alignmentBand,
  compassDistance,
  type CompassPoint,
} from "@/lib/registration/alignment";
import type { CompassParty } from "./CompassPicker";

interface CompassLegendProps {
  position: CompassPoint;
  parties: CompassParty[];
  electorate: (CompassPoint & { label: string }) | null;
  /** Region wording, used when no home region has been chosen yet. */
  regionNoun: string;
}

/**
 * Reads the plot back in words: every marker, how far it sits from the
 * candidate, and what that distance means. This carries the identity of each
 * dot, which is why the plot itself stays uncaptioned — six abbreviations in a
 * small square collide far more often than they inform.
 */
export function CompassLegend({ position, parties, electorate, regionNoun }: CompassLegendProps) {
  const rows = parties
    .map((party) => ({
      key: party.id,
      color: party.color,
      abbreviation: party.abbreviation,
      name: party.name,
      distance: compassDistance(position, party),
      hollow: false,
    }))
    .sort((a, b) => a.distance - b.distance);

  return (
    <div className="border-t border-card-border pt-3">
      <p className="mb-1.5 font-mono text-body-xs uppercase tracking-[0.16em] text-muted">
        Distance from your pin
      </p>
      <ul className="space-y-1">
        <li className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-foreground/70"
          />
          <span className="min-w-0 flex-1 truncate text-body-sm">
            {electorate ? (
              electorate.label
            ) : (
              <span className="text-muted">Pick a home {regionNoun} to plot its electorate</span>
            )}
          </span>
          {electorate && <DistanceChip distance={compassDistance(position, electorate)} />}
        </li>

        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-foreground/50"
              style={{ backgroundColor: row.color }}
            />
            <span className="min-w-0 flex-1 truncate text-body-sm">
              <span className="font-mono font-semibold">{row.abbreviation}</span>{" "}
              <span className="text-muted">{row.name}</span>
            </span>
            <DistanceChip distance={row.distance} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DistanceChip({ distance }: { distance: number }) {
  const meta = ALIGNMENT_META[alignmentBand(distance)];
  return (
    <span
      className={`shrink-0 rounded border px-1.5 font-mono text-body-xs font-semibold ${meta.toneClass}`}
      title={meta.label}
    >
      {distance.toFixed(1)}
    </span>
  );
}
