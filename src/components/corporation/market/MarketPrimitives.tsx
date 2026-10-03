"use client";

/**
 * Market-identity primitives for the player-corporation surface.
 *
 * Ported from the approved design prototype
 * (docs/superpowers/specs/2026-05-31-player-corp-prototype/src/pcomponents.jsx),
 * translated to project semantic tokens so all themes keep working:
 *  - prototype `up`/`down`   → `success`/`error`
 *  - prototype `brand-*`     → the scoped `--brand` CSS var (set from the corp's
 *                              brandColor by the masthead) for accents
 *  - SVG strokes use `currentColor` driven by a text-color class (theme-safe)
 */

/* Progress / composite meter. */
export function Meter({
  value,
  max = 100,
  tone = "brand",
  height = 8,
}: {
  value: number;
  max?: number;
  tone?: "brand" | "up" | "down" | "warning";
  height?: number;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const toneClass =
    tone === "up"
      ? "bg-success"
      : tone === "down"
        ? "bg-error"
        : tone === "warning"
          ? "bg-warning"
          : "";
  return (
    <div
      className="overflow-hidden rounded-full border border-card-border bg-card-muted"
      style={{ height }}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${toneClass}`}
        style={{
          width: pct + "%",
          ...(tone === "brand"
            ? {
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--brand, #3b82f6) 65%, black), var(--brand, #3b82f6))",
              }
            : {}),
        }}
      />
    </div>
  );
}

/* Estimated / fog-of-war chip, sourced from the last quarterly snapshot turn. */
export function EstChip({ turn }: { turn: number | null }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning"
      title={
        turn != null
          ? `Estimated from the last quarterly report (turn ${turn})`
          : "Estimated from the last quarterly report"
      }
    >
      <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 011-1h.01a1 1 0 011 1v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        />
      </svg>
      Est.
    </span>
  );
}
