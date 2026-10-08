import { memo } from "react";
import { BLEND, FONT } from "@/components/blend/tokens";
import type { StateGeo } from "./usStatesGeo";
import type { PresMapState } from "./presMapModel";
import { CALLOUT_STATES } from "./usStates";
import { labelFits } from "./mapView";

/** Fill for a state the caller has no projection for (fogged, or not yet in). */
export const FOG_FILL = "#171722";

const LABEL_PX = 10;
const CALLOUT_SET = new Set(CALLOUT_STATES);

interface ShapesProps {
  geo: StateGeo[];
  states: Record<string, PresMapState>;
}

/**
 * Every state outline. Pointer handling is delegated to the svg through
 * `data-state`, so these carry no closures and a hover or a pan re-renders none
 * of them.
 */
export const StatePaths = memo(function StatePaths({ geo, states }: ShapesProps) {
  return (
    <>
      {geo.map((g) => {
        const s = states[g.id];
        return (
          <path
            key={g.id}
            d={g.d}
            fill={s?.fill ?? FOG_FILL}
            stroke={BLEND.page}
            strokeWidth={0.8}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            data-state={s ? g.id : undefined}
            role={s ? "button" : undefined}
            tabIndex={s ? 0 : undefined}
            aria-label={
              s
                ? `${s.name}, ${s.ev} electoral votes, ${s.leaderName} leads by ${s.margin.toFixed(1)} points`
                : undefined
            }
            style={{ cursor: s ? "pointer" : "default", outline: "none" }}
          />
        );
      })}
    </>
  );
});

interface LabelsProps extends ShapesProps {
  /** Zoom level. */
  k: number;
  /** Screen pixels per map unit at zoom 1. */
  scale: number;
}

/**
 * State code and electoral votes, drawn only where they fit. The font size is
 * held constant on screen by dividing out the zoom, and the callout states
 * (listed beside the map) never get one.
 */
export const StateLabels = memo(function StateLabels({ geo, states, k, scale }: LabelsProps) {
  const size = LABEL_PX / (scale * k);
  return (
    <g style={{ pointerEvents: "none" }} fontFamily={FONT.mono} textAnchor="middle">
      {geo.map((g) => {
        const s = states[g.id];
        if (!s || CALLOUT_SET.has(g.id)) return null;
        if (!labelFits(g, k, scale, LABEL_PX * 2.2)) return null;
        const showEv = labelFits(g, k, scale, LABEL_PX * 3.4);
        return (
          <text key={g.id} x={g.centroid[0]} fill={s.ink} fontSize={size} fontWeight={700}>
            <tspan x={g.centroid[0]} y={g.centroid[1] + (showEv ? -size * 0.1 : size * 0.35)}>
              {g.id}
            </tspan>
            {showEv ? (
              <tspan
                x={g.centroid[0]}
                y={g.centroid[1] + size * 1.05}
                fontSize={size * 0.86}
                fontWeight={500}
                opacity={0.8}
              >
                {s.ev}
              </tspan>
            ) : null}
          </text>
        );
      })}
    </g>
  );
});
