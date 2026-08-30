"use client";

/**
 * The wire ticker under the Blend race cards — a scrolling summary of the
 * region's headline race.
 *
 * The track carries the item list twice; the animation translates it -50%, so
 * the second copy is exactly where the first started and the loop is seamless.
 * `prefers-reduced-motion` stops the scroll (handled in globals.css), which
 * leaves the first segment readable in place rather than blanking the strip.
 */

import type { BlendWireItem } from "@/lib/elections/blendRegionViewModel";

interface WireTickerProps {
  items: BlendWireItem[];
  /** Seconds for one full loop. Scales with item count so a long wire is not faster. */
  durationSeconds?: number;
}

export function WireTicker({ items, durationSeconds }: WireTickerProps) {
  if (items.length === 0) return null;

  const duration = durationSeconds ?? Math.max(24, items.length * 6);
  // Two identical segments, so -50% lands on the start of the second.
  const segments = [...items, ...items];

  return (
    <div className="flex h-[38px] items-center overflow-hidden rounded-lg border border-card-border bg-card-muted">
      <span className="flex h-full shrink-0 items-center bg-primary px-3.5 text-[10px] font-black uppercase tracking-[0.18em] text-white">
        Wire
      </span>
      {/* min-w-0 so the max-content track cannot push the strip wider than the page. */}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className="ahd-wire-marquee-track gap-9 whitespace-nowrap pl-5"
          style={{ animationDuration: `${duration}s` }}
        >
          {segments.map((item, i) => (
            <span
              key={`${item.text}-${i}`}
              className="text-xs font-medium"
              style={{ color: item.color }}
              // The second segment is a visual duplicate of the first.
              aria-hidden={i >= items.length}
            >
              {item.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
