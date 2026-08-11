"use client";

import { InfoTooltip } from "@/components/InfoTooltip";
import type { PlantIdleCause } from "../types";
import { idleCauseMeta, TONE_FILL, fmtUnits, fmtPct } from "../lib/plants";
import type { CorporationType } from "@/lib/constants/corporations";
import { facilityPlural } from "@/lib/constants/facilityVocabulary";

interface RunMeterProps {
  /** Installed capacity, units/day. The whole bar. */
  capacityUnits: number;
  /** Units made this turn. */
  producedUnits: number;
  /** Units that found a buyer. */
  soldUnits: number;
  /** Named reasons the rest of the capacity did not run. Sums to the idle slice. */
  idleCauses: PlantIdleCause[];
  /** Drives the facility noun in the segment help text. */
  sectorType: CorporationType;
  /** Dim the whole meter (mothballed plants). */
  dimmed?: boolean;
}

interface Segment {
  key: string;
  label: string;
  units: number;
  fill: string;
  help: string;
}

/**
 * THE SIGNATURE ELEMENT of the plants sector page: one bar showing today's run
 * across the whole of the sector's installed capacity, split into sold, made
 * but unsold, and idle by named reason.
 *
 * Every segment is drawn from the persisted turn factors and the segments sum
 * to capacity exactly, so the picture and the numbers beside it can never
 * disagree. The legend beneath is the teaching surface: it names WHY capacity
 * did not run, which is the one question the old capacity panel could not
 * answer.
 */
export default function RunMeter({
  capacityUnits,
  producedUnits,
  soldUnits,
  idleCauses,
  sectorType,
  dimmed = false,
}: RunMeterProps) {
  const sites = facilityPlural(sectorType);
  const causeMeta = idleCauseMeta(sectorType);
  const capacity = capacityUnits > 0 ? capacityUnits : 0;
  const sold = Math.max(0, Math.min(producedUnits, soldUnits));
  const unsold = Math.max(0, producedUnits - sold);

  const segments: Segment[] = [
    {
      key: "sold",
      label: "Made and sold",
      units: sold,
      fill: TONE_FILL.sold,
      help: `Units your ${sites} made and buyers took. This is the only part that earns revenue.`,
    },
    {
      key: "unsold",
      label: "Made, not sold",
      units: unsold,
      fill: TONE_FILL.unsold,
      help: "Units you made that nobody bought at your posted price. You paid to make them. Lower your price or build less.",
    },
    ...idleCauses.map((c) => {
      const meta = causeMeta[c.cause];
      return {
        key: `idle-${c.cause}`,
        label: meta.label,
        units: c.units,
        fill: TONE_FILL[meta.tone],
        help: meta.help,
      };
    }),
  ];

  const share = (units: number) => (capacity > 0 ? units / capacity : 0);

  /**
   * Drop slices too small to say anything. A cause carrying 0.4 of 693 units
   * passed a bare `units > 0` filter and then rendered as "Waiting on inputs
   * 0 0%" — a legend row naming a cause that visibly did nothing, and a bar
   * segment under a pixel wide. A slice earns a row when it rounds to at least
   * one unit or to at least one percent.
   */
  const visible = segments.filter((s) => s.units >= 0.5 || share(s.units) >= 0.005);

  /** Whole percent, except a real-but-tiny share reads "<1%" rather than "0%". */
  const shareLabel = (units: number) => {
    const value = share(units);
    return value > 0 && value < 0.005 ? "<1%" : fmtPct(value);
  };

  if (capacity <= 0) {
    return (
      <p className="rounded-lg border border-dashed border-card-border px-3 py-4 text-center text-body-sm text-muted">
        This sector has no capacity yet. Build some to start making things.
      </p>
    );
  }

  return (
    <div className={dimmed ? "opacity-60" : undefined}>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-track"
        role="img"
        aria-label={`Today's run: ${fmtUnits(sold)} of ${fmtUnits(capacity)} capacity units sold`}
      >
        {visible.map((s) => (
          <div
            key={s.key}
            className={`h-full ${s.fill} transition-[width] duration-500`}
            style={{ width: `${share(s.units) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {visible.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <InfoTooltip
              width={260}
              trigger={
                <span className="flex min-w-0 items-center gap-2 text-body-sm">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.fill}`} aria-hidden />
                  <span className="truncate border-b border-dotted border-muted/40 text-foreground">
                    {s.label}
                  </span>
                </span>
              }
            >
              <p className="mb-1 font-semibold text-foreground">{s.label}</p>
              <p className="text-muted">{s.help}</p>
            </InfoTooltip>
            <span className="shrink-0 text-body-sm tabular-nums text-muted">
              <span className="font-semibold text-foreground">{fmtUnits(s.units)}</span>{" "}
              {shareLabel(s.units)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
