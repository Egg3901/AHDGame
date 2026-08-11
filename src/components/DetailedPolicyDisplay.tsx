import { Tooltip } from "@/components/Tooltip";
import { PositionLabel } from "@/components/PositionLabel";
import {
  getEconomicAxisTickLabels,
  getPolicyColor,
  getSocialAxisTickLabels,
  getSocialPolicyColor,
} from "@/lib/utils/politics";

export interface PolicyMarker {
  economic: number;
  social: number;
  label: string;
  color?: string;
}

interface AxisGroup {
  position: number;
  label: string;
  color: string;
  deltaStr: string;
}

/** Groups markers that are within MERGE_DIST of each other on a single axis. */
function groupAxisMarkers(
  markers: PolicyMarker[],
  getValue: (m: PolicyMarker) => number,
  playerValue: number,
  range: number
): AxisGroup[] {
  const MERGE_DIST = 0.4;

  const items = markers.map((m) => ({
    pos: Math.max(-range, Math.min(range, getValue(m))),
    shortLabel: m.label === "Party" ? "P" : m.label === "State" ? "R" : m.label.slice(0, 1),
    color: m.color ?? "#a1a1aa",
  }));

  const used = new Set<number>();
  const groups: AxisGroup[] = [];

  for (let i = 0; i < items.length; i++) {
    if (used.has(i)) continue;
    let pos = items[i].pos;
    let label = items[i].shortLabel;
    const color = items[i].color;
    used.add(i);

    for (let j = i + 1; j < items.length; j++) {
      if (!used.has(j) && Math.abs(items[i].pos - items[j].pos) <= MERGE_DIST) {
        pos = (pos + items[j].pos) / 2;
        label = label + "·" + items[j].shortLabel;
        used.add(j);
      }
    }

    const delta = Math.round((pos - playerValue) * 10) / 10;
    const deltaStr = delta === 0 ? "±0" : delta > 0 ? `+${delta}` : `${delta}`;
    groups.push({ position: pos, label, color, deltaStr });
  }

  return groups;
}

interface MarkerPillProps {
  group: AxisGroup;
  toPercent: (v: number) => number;
  side: "above" | "below";
  compact: boolean;
}

function MarkerPill({ group, toPercent, side, compact }: MarkerPillProps) {
  // Keep marker within visible bounds so it doesn't clip at edges
  const rawPct = toPercent(group.position);
  const leftPct = Math.max(4, Math.min(96, rawPct));
  const pillH = compact ? "h-4 min-w-[16px] text-[8px]" : "h-5 min-w-[20px] text-[9px]";
  const connH = compact ? "h-1" : "h-1.5";
  const deltaClass = compact ? "text-[8px]" : "text-[9px]";

  const pill = (
    <div
      className={`rounded-full px-1.5 ${pillH} flex items-center justify-center font-bold text-white shadow-sm ring-1 ring-black/20 leading-none`}
      style={{ backgroundColor: group.color }}
    >
      {group.label}
    </div>
  );

  const connector = (
    <div
      className={`w-px ${connH} shrink-0`}
      style={{ backgroundColor: group.color, opacity: 0.5 }}
    />
  );

  const delta = (
    <span
      className={`${deltaClass} font-mono font-semibold leading-none`}
      style={{ color: group.color }}
    >
      {group.deltaStr}
    </span>
  );

  return (
    <div
      className={`absolute flex flex-col items-center ${side === "above" ? "bottom-0" : "top-0"}`}
      style={{ left: `${leftPct}%`, transform: "translateX(-50%)" }}
    >
      {side === "above" ? (
        <>
          {delta}
          <div className="mt-0.5" />
          {pill}
          {connector}
        </>
      ) : (
        <>
          {connector}
          {pill}
          <div className="mt-0.5" />
          {delta}
        </>
      )}
    </div>
  );
}

interface DetailedPolicyDisplayProps {
  economic: number;
  social: number;
  /** Hide the "Policy Positions" heading (e.g. when inside PolicyAlignmentCard). */
  omitHeading?: boolean;
  /** No outer card border/padding (nested inside another card). */
  inset?: boolean;
  /** Smaller layout for embedding next to party strength etc. */
  compact?: boolean;
  /** Axis range: slider spans from -range to +range. Defaults to 5. */
  range?: number;
  /** Override the label shown next to "Economic". Receives the clamped value. */
  economicLabel?: (v: number) => string;
  /** Override the label shown next to "Social". Receives the clamped value. */
  socialLabel?: (v: number) => string;
  /** Reference markers to display (e.g. party, state positions). */
  markers?: PolicyMarker[];
}

export function DetailedPolicyDisplay({
  economic,
  social,
  omitHeading = false,
  inset = false,
  compact = false,
  range = 5,
  economicLabel,
  socialLabel,
  markers,
}: DetailedPolicyDisplayProps) {
  const clamp = (v: number) => Math.round(Math.max(-range, Math.min(range, v)) * 100) / 100;
  const toPercent = (v: number) => ((clamp(v) + range) / (range * 2)) * 100;

  const econ = clamp(economic);
  const soc = clamp(social);
  const econTicks = getEconomicAxisTickLabels(range);
  const socialTicks = getSocialAxisTickLabels(range);

  const econGroups = markers ? groupAxisMarkers(markers, (m) => m.economic, econ, range) : [];
  const socialGroups = markers ? groupAxisMarkers(markers, (m) => m.social, soc, range) : [];
  const hasMarkers = markers && markers.length > 0;

  const wrapperClass = inset
    ? "rounded-none border-0 bg-transparent p-0"
    : compact
      ? "rounded-lg border-0 bg-transparent p-0"
      : "rounded-2xl border border-card-border bg-card p-6";
  const titleClass = compact
    ? "text-[10px] font-semibold uppercase tracking-widest text-muted mb-2"
    : "text-[11px] font-semibold uppercase tracking-widest text-muted mb-4";
  const spaceClass = compact ? "space-y-3" : "space-y-7";
  const rowClass = compact ? "mb-2" : "mb-3";
  const trackClass = compact ? "h-2" : "h-2.5";
  const thumbSize = compact ? "h-3.5 w-3.5" : "h-5 w-5";
  const labelClass = compact ? "text-xs font-medium" : "text-sm font-medium";
  const axisClass = compact ? "text-[10px] text-muted mt-0.5" : "text-[10px] text-muted mt-1";
  const markerAreaH = compact ? "h-7" : "h-9";

  const partyMarker = markers?.find((m) => m.label === "Party");
  const stateMarker = markers?.find((m) => m.label === "State");

  return (
    <div className={wrapperClass}>
      {!compact && !omitHeading && <h3 className={titleClass}>Policy Positions</h3>}

      <div className={spaceClass}>
        {/* Economic */}
        <div>
          <div className={`flex items-center justify-between ${rowClass}`}>
            <Tooltip
              content={
                <div>
                  <p className="font-semibold text-foreground mb-1">Economic Policy</p>
                  <p className="text-muted/80">
                    Left: stronger redistribution and public-sector emphasis. Right: lower taxes and
                    market-oriented policy. Center: balanced.
                  </p>
                  <p className="mt-2 text-[11px] text-foreground/80">
                    Labels from left to right: Extremely Left, Left, Centrist, Right, Extremely
                    Right.
                  </p>
                </div>
              }
            >
              <span
                className={`${labelClass} cursor-help border-b border-dashed border-card-border/70`}
              >
                Economic
              </span>
            </Tooltip>
            {economicLabel ? (
              <span className={`${labelClass} ${getPolicyColor(econ)}`}>{economicLabel(econ)}</span>
            ) : (
              <PositionLabel value={econ} axis="economic" className={labelClass} />
            )}
          </div>

          {/* Marker area above economic track */}
          {hasMarkers && econGroups.length > 0 && (
            <div className={`relative ${markerAreaH}`}>
              {econGroups.map((group, i) => (
                <MarkerPill
                  key={i}
                  group={group}
                  toPercent={toPercent}
                  side="above"
                  compact={compact}
                />
              ))}
            </div>
          )}

          {/* Track */}
          <div
            className={`relative ${trackClass} rounded-full`}
            style={{
              background:
                "linear-gradient(to right, #1d4ed8 0%, #3b82f6 30%, #71717a 50%, #ef4444 70%, #b91c1c 100%)",
            }}
          >
            <div
              className={`absolute top-1/2 ${thumbSize} -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-lg`}
              style={{
                left: `${toPercent(econ)}%`,
                backgroundColor: econ < -0.1 ? "#3b82f6" : econ > 0.1 ? "#ef4444" : "#a1a1aa",
              }}
            />
          </div>

          <div className={`flex justify-between ${axisClass}`}>
            <span>{econTicks.negative}</span>
            <span>{econTicks.center}</span>
            <span>{econTicks.positive}</span>
          </div>
        </div>

        {/* Social */}
        <div>
          <div className={`flex items-center justify-between ${rowClass}`}>
            <Tooltip
              content={
                <div>
                  <p className="font-semibold text-foreground mb-1">Social Policy</p>
                  <p className="text-muted/80">
                    Liberal: socially progressive. Traditional: socially conservative. Moderate:
                    between the two.
                  </p>
                  <p className="mt-2 text-[11px] text-foreground/80">
                    Labels from liberal to traditional: Far Liberal, Liberal, Moderate, Traditional,
                    Far Traditional.
                  </p>
                </div>
              }
            >
              <span
                className={`${labelClass} cursor-help border-b border-dashed border-card-border/70`}
              >
                Social
              </span>
            </Tooltip>
            {socialLabel ? (
              <span className={`${labelClass} ${getSocialPolicyColor(soc)}`}>
                {socialLabel(soc)}
              </span>
            ) : (
              <PositionLabel value={soc} axis="social" className={labelClass} />
            )}
          </div>

          {/* Track */}
          <div
            className={`relative ${trackClass} rounded-full`}
            style={{
              background:
                "linear-gradient(to right, #0d9488 0%, #2dd4bf 30%, #71717a 50%, #f59e0b 70%, #d97706 100%)",
            }}
          >
            <div
              className={`absolute top-1/2 ${thumbSize} -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-lg`}
              style={{
                left: `${toPercent(soc)}%`,
                backgroundColor: soc < -0.1 ? "#2dd4bf" : soc > 0.1 ? "#f59e0b" : "#a1a1aa",
              }}
            />
          </div>

          {/* Marker area below social track */}
          {hasMarkers && socialGroups.length > 0 && (
            <div className={`relative ${markerAreaH}`}>
              {socialGroups.map((group, i) => (
                <MarkerPill
                  key={i}
                  group={group}
                  toPercent={toPercent}
                  side="below"
                  compact={compact}
                />
              ))}
            </div>
          )}

          <div className={`flex justify-between ${axisClass}`}>
            <span>{socialTicks.negative}</span>
            <span>{socialTicks.center}</span>
            <span>{socialTicks.positive}</span>
          </div>
        </div>
      </div>

      {/* Legend */}
      {hasMarkers && (partyMarker || stateMarker) && (
        <div className="mt-4 flex gap-4 justify-center">
          {partyMarker && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-black/20"
                style={{ backgroundColor: partyMarker.color ?? "#a1a1aa" }}
              >
                P
              </span>
              Party position
            </span>
          )}
          {stateMarker && (
            <span className="flex items-center gap-1.5 text-[10px] text-muted">
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-black/20"
                style={{ backgroundColor: stateMarker.color ?? "#38bdf8" }}
              >
                R
              </span>
              State lean
            </span>
          )}
        </div>
      )}
    </div>
  );
}
