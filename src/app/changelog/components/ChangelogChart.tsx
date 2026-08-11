"use client";

import { useId, useState } from "react";

/**
 * Charts for changelog dev-diary posts, authored inline in the markdown as a
 * ```chart fence containing a JSON spec. Rendered as inline SVG — no chart
 * library, no runtime dependency, and it works inside the existing
 * ReactMarkdown pipeline.
 *
 * Colour: slots come from the validated categorical palette, using the steps
 * that clear every check against BOTH a light and a dark chart surface. The app
 * ships ~10 user-selectable themes (globals.css `[data-theme=...]`), from pure
 * black OLED to cream broadsheet, so a light-set/dark-set swap would need to
 * enumerate them and would break on the next theme added. One theme-invariant
 * set avoids that entirely. Verified with the palette validator against
 * #ffffff, #1d1d2a, #000000 and #fbf8f0: all checks pass on each.
 *
 * Text never wears a series colour — identity comes from the coloured mark
 * beside the label. Every value is also directly labelled and repeated in a
 * table view, which satisfies the relief rule and keeps the chart readable
 * without colour at all.
 */

/** Categorical slots 1-3. Past three series, author a second chart or facet. */
const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70"] as const;
export const MAX_SERIES = SERIES_COLORS.length;

export interface ChartSeries {
  label: string;
  data: number[];
}

export interface ChartSpec {
  type: "bar" | "line";
  title?: string;
  caption?: string;
  /** Appended to every value label and axis tick, e.g. "%" or "ms". */
  unit?: string;
  /** Prepended to every value label, e.g. "$". */
  prefix?: string;
  categories: string[];
  series: ChartSeries[];
}

/** Narrow unknown parsed JSON to a ChartSpec, or explain why it is not one. */
export function parseChartSpec(raw: string): { spec: ChartSpec } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "Chart block is not valid JSON." };
  }
  if (typeof parsed !== "object" || parsed === null)
    return { error: "Chart spec must be an object." };
  const o = parsed as Record<string, unknown>;

  const type = o.type === "line" ? "line" : o.type === "bar" ? "bar" : null;
  if (!type) return { error: 'Chart "type" must be "bar" or "line".' };

  if (!Array.isArray(o.categories) || o.categories.some((c) => typeof c !== "string")) {
    return { error: 'Chart "categories" must be an array of strings.' };
  }
  const categories = o.categories as string[];
  if (categories.length === 0) return { error: 'Chart "categories" must not be empty.' };

  if (!Array.isArray(o.series) || o.series.length === 0) {
    return { error: 'Chart "series" must be a non-empty array.' };
  }
  if (o.series.length > MAX_SERIES) {
    return { error: `Charts support at most ${MAX_SERIES} series; split into two charts instead.` };
  }

  const series: ChartSeries[] = [];
  for (const s of o.series) {
    if (typeof s !== "object" || s === null) return { error: "Each series must be an object." };
    const so = s as Record<string, unknown>;
    if (typeof so.label !== "string") return { error: 'Each series needs a string "label".' };
    if (
      !Array.isArray(so.data) ||
      so.data.some((d) => typeof d !== "number" || !Number.isFinite(d))
    ) {
      return { error: `Series "${so.label}" needs "data" as an array of finite numbers.` };
    }
    if ((so.data as number[]).length !== categories.length) {
      return {
        error: `Series "${so.label}" has ${(so.data as number[]).length} points but there are ${categories.length} categories.`,
      };
    }
    series.push({ label: so.label, data: so.data as number[] });
  }

  return {
    spec: {
      type,
      title: typeof o.title === "string" ? o.title : undefined,
      caption: typeof o.caption === "string" ? o.caption : undefined,
      unit: typeof o.unit === "string" ? o.unit : undefined,
      prefix: typeof o.prefix === "string" ? o.prefix : undefined,
      categories,
      series,
    },
  };
}

/**
 * Compact number for a mark or an axis tick.
 *
 * The unit is deliberately NOT appended here. Suffixing every label ("221
 * seats") made grouped-bar labels wider than their 24px bars so neighbours
 * overlapped, and pushed the widest y-tick past the left padding so it rendered
 * clipped. The unit is stated once, beside the axis, where it is read once.
 */
function formatNumber(v: number, spec: ChartSpec): string {
  const abs = Math.abs(v);
  const body =
    abs >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : abs >= 1_000
        ? `${(v / 1_000).toFixed(1)}K`
        : Number.isInteger(v)
          ? v.toString()
          : v.toFixed(1);
  return `${spec.prefix ?? ""}${body}`;
}

/** Full value with its unit, for tooltips and the table view. */
function formatValue(v: number, spec: ChartSpec): string {
  return `${formatNumber(v, spec)}${spec.unit ?? ""}`;
}

/** Smallest clean step (1/2/2.5/5/10 x 10^k) not below `v`. */
function niceStep(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = [1, 2, 2.5, 5, 10].find((s) => norm <= s + 1e-9) ?? 10;
  return step * mag;
}

/**
 * Axis scale: a clean step, and a maximum that is a multiple of it.
 *
 * Deriving ticks by slicing the range into fixed quarters produced values like
 * 62.5 and 187.5 for a chart counting seats. Picking the step first and letting
 * the top of the axis fall on a multiple of it keeps every tick a round number.
 *
 * The step is also chosen finely enough that a 221-seat maximum does not round
 * the axis to 500 and leave the tallest bar under half the plot height.
 */
function buildScale(rawMin: number, rawMax: number): { min: number; max: number; ticks: number[] } {
  const lo = Math.min(0, rawMin);
  const hi = Math.max(0, rawMax);
  const step = niceStep((hi - lo) / 4 || 1);
  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step || step;
  const ticks: number[] = [];
  // Accumulate by index rather than repeated addition so float drift cannot
  // turn a clean 62.5 into 62.500000000000004.
  for (let i = 0; min + i * step <= max + 1e-9; i++) ticks.push(min + i * step);
  return { min, max, ticks };
}

const W = 720;
const H = 300;
const PAD = { top: 34, right: 24, bottom: 44, left: 58 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

export function ChangelogChart({ spec }: { spec: ChartSpec }) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();

  const allValues = spec.series.flatMap((s) => s.data);
  // Only drop the baseline below zero when the data actually goes there; bars
  // and lines otherwise grow from a single zero baseline.
  const {
    min: yMin,
    max: yMax,
    ticks,
  } = buildScale(Math.min(...allValues, 0), Math.max(...allValues, 0));
  const span = yMax - yMin || 1;

  const y = (v: number) => PAD.top + PLOT_H - ((v - yMin) / span) * PLOT_H;
  const zeroY = y(0);
  const bandW = PLOT_W / spec.categories.length;
  const multi = spec.series.length > 1;

  return (
    <figure className="my-6 not-prose">
      <div className="rounded-xl border border-card-border bg-card p-4">
        {spec.title && (
          <h4 id={titleId} className="mb-1 text-sm font-semibold text-foreground">
            {spec.title}
          </h4>
        )}

        {/* Legend — always present for two or more series; a single series is
            named by the title, so a one-swatch box would just restate it. */}
        {multi && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
            {spec.series.map((s, i) => (
              <span key={s.label} className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: SERIES_COLORS[i] }}
                />
                {s.label}
              </span>
            ))}
          </div>
        )}

        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full min-w-[520px]"
            role="img"
            aria-labelledby={spec.title ? titleId : undefined}
            aria-label={spec.title ? undefined : "Chart"}
          >
            {/* Unit, stated once at the top of the axis instead of on every
                tick. */}
            {spec.unit && (
              <text
                x={PAD.left}
                y={PAD.top - 14}
                textAnchor="start"
                className="fill-muted"
                style={{ fontSize: 10 }}
              >
                {spec.unit.trim()}
              </text>
            )}

            {/* Gridlines — hairline, solid, recessive */}
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--card-border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  className="fill-muted"
                  style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
                >
                  {formatNumber(t, spec)}
                </text>
              </g>
            ))}

            {/* Zero baseline, when the scale crosses it */}
            {yMin < 0 && (
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={zeroY}
                y2={zeroY}
                stroke="var(--muted)"
                strokeWidth={1}
              />
            )}

            {/* Category labels */}
            {spec.categories.map((c, ci) => (
              <text
                key={c}
                x={PAD.left + bandW * ci + bandW / 2}
                y={H - PAD.bottom + 18}
                textAnchor="middle"
                className="fill-muted"
                style={{ fontSize: 11 }}
              >
                {c}
              </text>
            ))}

            {spec.type === "bar"
              ? spec.series.map((s, si) => {
                  // Cap thickness so the band keeps its air, and hold a 2px
                  // surface gap between adjacent bars — white does the
                  // separating, never a stroke around the mark.
                  const GAP = 2;
                  const groupW = bandW * 0.68;
                  const barW = Math.min(
                    24,
                    (groupW - GAP * (spec.series.length - 1)) / spec.series.length
                  );
                  return (
                    <g key={s.label}>
                      {s.data.map((v, ci) => {
                        const groupStart =
                          PAD.left +
                          bandW * ci +
                          (bandW - (barW * spec.series.length + GAP * (spec.series.length - 1))) /
                            2;
                        const x = groupStart + si * (barW + GAP);
                        const top = Math.min(y(v), zeroY);
                        const h = Math.abs(y(v) - zeroY);
                        const r = Math.min(4, h);
                        const up = v >= 0;
                        // 4px rounded data-end, square at the baseline.
                        const d = up
                          ? `M${x},${top + h} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${top + h} Z`
                          : `M${x},${top} L${x},${top + h - r} Q${x},${top + h} ${x + r},${top + h} L${x + barW - r},${top + h} Q${x + barW},${top + h} ${x + barW},${top + h - r} L${x + barW},${top} Z`;
                        return (
                          <g key={ci}>
                            <path d={d} fill={SERIES_COLORS[si]}>
                              <title>{`${s.label} · ${spec.categories[ci]}: ${formatValue(v, spec)}`}</title>
                            </path>
                            <text
                              x={x + barW / 2}
                              y={up ? top - 6 : top + h + 14}
                              textAnchor="middle"
                              className="fill-foreground"
                              style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
                            >
                              {formatNumber(v, spec)}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  );
                })
              : spec.series.map((s, si) => {
                  const pts = s.data.map(
                    (v, ci) => [PAD.left + bandW * ci + bandW / 2, y(v)] as const
                  );
                  const dPath = pts
                    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px},${py}`)
                    .join(" ");
                  const [lastX, lastY] = pts[pts.length - 1];
                  return (
                    <g key={s.label}>
                      <path
                        d={dPath}
                        fill="none"
                        stroke={SERIES_COLORS[si]}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                      {pts.map(([px, py], ci) => (
                        // 2px surface ring keeps dots legible where they cross.
                        <circle
                          key={ci}
                          cx={px}
                          cy={py}
                          r={4}
                          fill={SERIES_COLORS[si]}
                          stroke="var(--card)"
                          strokeWidth={2}
                        >
                          <title>{`${s.label} · ${spec.categories[ci]}: ${formatValue(s.data[ci], spec)}`}</title>
                        </circle>
                      ))}
                      {/* Label the endpoint only — a number on every point is
                          chaos and goes unread. */}
                      <text
                        x={lastX}
                        y={lastY - 12}
                        textAnchor="end"
                        className="fill-foreground"
                        style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}
                      >
                        {formatNumber(s.data[s.data.length - 1], spec)}
                      </text>
                    </g>
                  );
                })}
          </svg>
        </div>

        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="mt-2 text-xs font-medium text-primary hover:underline"
          aria-expanded={showTable}
        >
          {showTable ? "Hide values" : "Show values as a table"}
        </button>

        {showTable && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-card-border text-left text-muted">
                  <th className="py-1 pr-3 font-semibold">Series</th>
                  {spec.categories.map((c) => (
                    <th key={c} className="px-2 py-1 text-right font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {spec.series.map((s, si) => (
                  <tr key={s.label} className="border-b border-card-border/40">
                    <td className="py-1 pr-3 text-foreground">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ background: SERIES_COLORS[si] }}
                        />
                        {s.label}
                      </span>
                    </td>
                    {s.data.map((v, ci) => (
                      <td key={ci} className="px-2 py-1 text-right tabular-nums text-muted">
                        {formatValue(v, spec)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {spec.caption && (
        <figcaption className="mt-2 text-xs leading-relaxed text-muted">{spec.caption}</figcaption>
      )}
    </figure>
  );
}
