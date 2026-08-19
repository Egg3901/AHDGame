"use client";

/**
 * SP2 §6 — the Active-modifiers decomposition: each law contributing to the
 * metric's target, the structural-conditions residual, the standing cabinet
 * term, and the composed target with the current drift direction. Pure
 * presentation of the dynamics engine's own arithmetic — the rows sum
 * (pre-clamp) to the target.
 *
 * Ticket #1129: players reported that built estates did nothing. The cabinet
 * term was real and stored, but no surface showed it, the served target left it
 * out, and the channel was capped as one lump so a saturated order book made the
 * next estate worth exactly zero. The cap is now per channel, and the warning
 * only fires when every channel is full.
 */

import type { MetricModifiersInfo } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";

const DIRECTION_GLYPH: Record<MetricModifiersInfo["direction"], string> = {
  up: "▲ rising",
  down: "▼ falling",
  flat: "— steady",
};

export function ModifiersPanel({ modifiers }: { modifiers: MetricModifiersInfo }) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
      <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
        Active modifiers
      </div>
      <div className="flex flex-col gap-1.5">
        {modifiers.laws.map((row) => (
          <div key={row.lawId} className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className="text-foreground">
              {row.title}
              <span className="text-body-xs text-muted"> · {row.levelName}</span>
            </span>
            <span className="shrink-0 tabular-nums text-success">
              +{row.points.toLocaleString("en-US")}
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-dashed border-card-border pt-1.5 text-body-sm">
          <span className="text-muted">Structural conditions</span>
          <span
            className={`shrink-0 tabular-nums ${
              modifiers.residual >= 0 ? "text-success" : "text-error"
            }`}
          >
            {modifiers.residual >= 0 ? "+" : "−"}
            {Math.abs(modifiers.residual).toLocaleString("en-US")}
          </span>
        </div>
        {modifiers.cabinet !== 0 && (
          <div className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className="text-muted">Cabinet, orders and estates</span>
            <span
              className={`shrink-0 tabular-nums ${
                modifiers.cabinet >= 0 ? "text-success" : "text-error"
              }`}
            >
              {modifiers.cabinet >= 0 ? "+" : "−"}
              {Math.abs(modifiers.cabinet).toLocaleString("en-US")}
            </span>
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-baseline justify-between border-t border-card-border pt-2 text-body-xs text-muted">
        <span>
          Target <strong className="tabular-nums text-foreground">{modifiers.target}</strong>
        </span>
        <span>{DIRECTION_GLYPH[modifiers.direction]}</span>
      </div>
      {modifiers.cabinetAtCap && (
        <p className="mt-2 text-body-xs text-warning">
          Every cabinet channel for this metric is at its {modifiers.cabinetCap} point ceiling in
          most of the country. Orders, tier settings, estates, energy and infrastructure each carry
          their own ceiling, and all of them are full, so more of any of them adds nothing here
          until something pulls one back below its ceiling.
        </p>
      )}
      {modifiers.driftHalfLifeTurns > 0 && (
        <p className="mt-2 text-body-xs text-muted">
          The value moves toward the target slowly: about {modifiers.driftHalfLifeTurns} turns to
          close half the remaining gap.
        </p>
      )}
    </div>
  );
}
