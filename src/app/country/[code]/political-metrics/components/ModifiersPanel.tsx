"use client";

/**
 * SP2 §6, the active-modifiers decomposition: each law contributing to the
 * metric's target, the structural-conditions residual, the standing cabinet
 * term, and the composed target with the current drift direction. Pure
 * presentation of the dynamics engine's own arithmetic: the rows sum
 * (pre-clamp) to the target.
 *
 * Ticket #1129: players reported that built estates did nothing. The cabinet
 * term was real and stored, but no surface showed it, the served target left it
 * out, and the channel was capped as one lump so a saturated order book made the
 * next estate worth exactly zero. The cap is now per channel, and the warning
 * only fires when every channel is full.
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { MetricModifiersInfo } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";

const MINUS = "−";

const DIRECTION_GLYPH: Record<MetricModifiersInfo["direction"], string> = {
  up: "▲ rising",
  down: "▼ falling",
  flat: "steady",
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

/** "+4" or "−1.5", in one text node so it reads and searches as one figure. */
function signed(value: number): string {
  return `${value >= 0 ? "+" : MINUS}${Math.abs(value).toLocaleString("en-US")}`;
}

/** Gains green, losses red, nothing neutral. */
function signTone(value: number): string {
  if (value > 0) return "text-success";
  if (value < 0) return "text-error";
  return "text-foreground";
}

/** One contribution: what it is, and the signed points it adds to the target. */
function SignedRow({
  label,
  value,
  sub = false,
}: {
  label: ReactNode;
  value: number;
  /** A breakdown line under the row above it: indented and smaller. */
  sub?: boolean;
}) {
  return (
    <tr>
      <th
        scope="row"
        className={`text-left font-normal ${sub ? "py-0.5 pl-4 text-body-sm text-muted" : "py-1.5 text-body text-muted"}`}
      >
        {label}
      </th>
      <td
        className={`whitespace-nowrap pl-3 text-right font-mono tabular-nums ${sub ? "py-0.5 text-body-sm" : "py-1.5 text-body"} ${signTone(value)}`}
      >
        {signed(value)}
      </td>
    </tr>
  );
}

function LawRow({ row }: { row: MetricModifiersInfo["laws"][number] }) {
  return (
    <tr>
      <th scope="row" className="py-1.5 text-left text-body font-normal text-foreground">
        {row.title}
        <span className="text-body-sm text-muted"> · {row.levelName}</span>
      </th>
      <td className="whitespace-nowrap py-1.5 pl-3 text-right font-mono text-body tabular-nums text-success">
        +{row.points.toLocaleString("en-US")}
      </td>
    </tr>
  );
}

export function ModifiersPanel({ modifiers }: { modifiers: MetricModifiersInfo }) {
  return (
    <section aria-labelledby="pm-metric-modifiers">
      <h3 id="pm-metric-modifiers" className="text-heading-sm font-semibold text-foreground">
        Active modifiers
      </h3>
      <table
        aria-labelledby="pm-metric-modifiers"
        className="mt-3 w-full max-w-2xl border-collapse"
      >
        <tbody>
          {modifiers.laws.map((row) => (
            <LawRow key={row.lawId} row={row} />
          ))}
        </tbody>
        {/* Region scope only: the region's own enacted laws, already halved so
            these rows add up to the target below rather than to the raw ladder. */}
        {modifiers.regionalLaws.length > 0 && (
          <tbody>
            <tr>
              <th
                colSpan={2}
                scope="rowgroup"
                className="pb-1 pt-4 text-left text-body-sm font-medium text-muted"
              >
                Regional programmes
              </th>
            </tr>
            {modifiers.regionalLaws.map((row) => (
              <LawRow key={`regional-${row.lawId}`} row={row} />
            ))}
          </tbody>
        )}
        <tbody>
          <SignedRow label="Structural conditions" value={modifiers.residual} />
          {modifiers.cabinet !== 0 && (
            <>
              <SignedRow label="Cabinet, orders and estates" value={modifiers.cabinet} />
              {/* Ticket #1142: one aggregate label could not answer "which cabinet
                  action is doing this", and on the reporter's metric the answer was
                  none of them: the energy channel alone. Name the channels. */}
              {modifiers.cabinetBySource.map((row) => (
                <SignedRow
                  key={row.source}
                  sub
                  value={row.value}
                  label={
                    <>
                      {CABINET_SOURCE_LABEL[row.source]}
                      {row.atCap && <span className="ml-1.5 text-warning">near ceiling</span>}
                    </>
                  }
                />
              ))}
            </>
          )}
          {/* The strike and settlement channel. It moves every region's target,
              and until now showed on no surface at all, so a strike wave shifted
              politics with no traceable cause. */}
          {(modifiers.livingConflict ?? 0) !== 0 && (
            <ConflictModifier value={modifiers.livingConflict!} />
          )}
          {modifiers.labour !== 0 && (
            <SignedRow label="Labour relations" value={modifiers.labour} />
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-card-border">
            <th scope="row" className="pt-2 text-left text-body font-medium text-foreground">
              Law and structure target
            </th>
            <td className="whitespace-nowrap pl-3 pt-2 text-right text-body">
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {modifiers.target}
              </span>
              <span className="ml-2 text-body-sm text-muted">
                {DIRECTION_GLYPH[modifiers.direction]}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
      {modifiers.cabinetAtCap && (
        <p className="mt-3 max-w-2xl text-body text-warning">
          Every cabinet channel for this metric is effectively at its {modifiers.cabinetCap} point
          ceiling in most of the country. Orders, tier settings, estates, energy and infrastructure
          each carry their own ceiling, and all of them are effectively full, so more of any of them
          buys only a little here until something pulls one back below its ceiling.
        </p>
      )}
      {modifiers.driftHalfLifeTurns > 0 && (
        <p className="mt-3 max-w-2xl text-body text-muted">
          The value moves toward the target slowly: about {modifiers.driftHalfLifeTurns} turns to
          close half the remaining gap.
        </p>
      )}
      {/* Said plainly rather than left for a player to discover by arithmetic:
          the engine also bends this target by how the economy and the funded
          services are actually doing, and those two terms are recomputed every
          turn instead of being stored, so a read path cannot show them. */}
      <p className="mt-2 max-w-2xl text-body text-muted">
        Laws and standing conditions set this target. Economic performance and service delivery bend
        it further each turn, and those are not included in the figure above.
      </p>
    </section>
  );
}

function ConflictModifier({ value }: { value: number }) {
  const t = useTranslations("worldConflicts.livingCrises");
  return <SignedRow label={t("politicalEffect")} value={value} />;
}
