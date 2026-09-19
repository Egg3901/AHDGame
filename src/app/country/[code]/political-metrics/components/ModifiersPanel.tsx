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

/**
 * Player-facing names for the cabinet channels. The ids are internal; a metric
 * board should say "energy estates" rather than "energy" (ticket #1142).
 */
const CABINET_SOURCE_LABEL: Record<string, string> = {
  orders: "Ministerial orders",
  settings: "Department settings",
  military: "Military posture",
  estates: "Estates",
  energy: "Energy estates",
  infrastructure: "Infrastructure estates",
  legacy: "Older effects, fading",
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
        {/* Region scope only: the region's own enacted laws, already halved so
            these rows add up to the target below rather than to the raw ladder. */}
        {modifiers.regionalLaws.length > 0 && (
          <>
            <div className="border-t border-dashed border-card-border pt-1.5 font-mono text-body-xs uppercase tracking-wider text-muted">
              Regional programmes
            </div>
            {modifiers.regionalLaws.map((row) => (
              <div
                key={`regional-${row.lawId}`}
                className="flex items-baseline justify-between gap-3 text-body-sm"
              >
                <span className="text-foreground">
                  {row.title}
                  <span className="text-body-xs text-muted"> · {row.levelName}</span>
                </span>
                <span className="shrink-0 tabular-nums text-success">
                  +{row.points.toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </>
        )}
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
          <>
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
            {/* Ticket #1142: one aggregate label could not answer "which cabinet
                action is doing this", and on the reporter's metric the answer was
                none of them: the energy channel alone. Name the channels. */}
            {modifiers.cabinetBySource.length > 0 && (
              <ul className="mt-0.5 space-y-0.5 pl-3">
                {modifiers.cabinetBySource.map((row) => (
                  <li
                    key={row.source}
                    className="flex items-baseline justify-between gap-3 text-body-xs text-muted"
                  >
                    <span>
                      {CABINET_SOURCE_LABEL[row.source]}
                      {row.atCap && <span className="ml-1 text-warning">at ceiling</span>}
                    </span>
                    <span
                      className={`shrink-0 tabular-nums ${
                        row.value >= 0 ? "text-success" : "text-error"
                      }`}
                    >
                      {row.value >= 0 ? "+" : "−"}
                      {Math.abs(row.value).toLocaleString("en-US")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {/* The strike and settlement channel. It moves every region's target,
            and until now showed on no surface at all, so a strike wave shifted
            politics with no traceable cause. */}
        {modifiers.labour !== 0 && (
          <div className="flex items-baseline justify-between gap-3 text-body-sm">
            <span className="text-muted">Labour relations</span>
            <span
              className={`shrink-0 tabular-nums ${
                modifiers.labour >= 0 ? "text-success" : "text-error"
              }`}
            >
              {modifiers.labour >= 0 ? "+" : "−"}
              {Math.abs(modifiers.labour).toLocaleString("en-US")}
            </span>
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-baseline justify-between border-t border-card-border pt-2 text-body-xs text-muted">
        <span>
          Law and structure target{" "}
          <strong className="tabular-nums text-foreground">{modifiers.target}</strong>
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
      {/* Said plainly rather than left for a player to discover by arithmetic:
          the engine also bends this target by how the economy and the funded
          services are actually doing, and those two terms are recomputed every
          turn instead of being stored, so a read path cannot show them. */}
      <p className="mt-2 text-body-xs text-muted">
        Laws and standing conditions set this target. Economic performance and service delivery bend
        it further each turn, and those are not included in the figure above.
      </p>
    </div>
  );
}
