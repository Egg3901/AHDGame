"use client";

import { USAMapPaths, type StateMapData } from "@/components/USAMapPaths";

export interface PrimaryStateData {
  /** Hex color for the state fill (candidate's party color, or grey for unvoted) */
  color: string;
  /** Actual states render solid; projected states render a blended fill. */
  phase?: "actual" | "projected";
  /** Display label — typically state name */
  label: string;
  /** Tooltip lines */
  tooltip: string[];
  /** Optional: label to show when the map is in delegate mode (e.g. "45"). */
  delegateLabel?: string;
  /** Optional: tooltip lines to show when the map is in delegate mode. */
  delegateTooltip?: string[];
}

export interface PrimaryElectoralMapProps {
  /** Per-state map data (stateId → color, label, tooltip) */
  stateData: Record<string, PrimaryStateData>;
  /** Optional: state IDs to outline (e.g. the states voting this wave) */
  waveHighlight?: string[];
  /** Optional: click handler to navigate to state detail */
  onStateClick?: (stateId: string) => void;
  /** Header content — e.g. party name + delegate tracker */
  header?: React.ReactNode;
  /** Footer — e.g. legend */
  footer?: React.ReactNode;
  /** Map display mode. `leader` colors by projected/actual winner; `delegates` overlays per-state delegate counts. */
  mode?: "leader" | "delegates";
}

/**
 * Primary election map — used on the per-party primary page. Colors each state
 * by the projected winner (pre-stagger) or the actual winner (during/after
 * stagger). Pre-stagger and pre-vote states use a neutral grey. The optional
 * `delegates` mode labels each state with its delegate count and shows a
 * per-candidate delegate breakdown in the tooltip.
 */
export function PrimaryElectoralMap({
  stateData,
  waveHighlight,
  onStateClick,
  header,
  footer,
  mode = "leader",
}: PrimaryElectoralMapProps) {
  const normalized: Record<string, StateMapData> = {};
  for (const [stateId, data] of Object.entries(stateData)) {
    normalized[stateId] = {
      color: data.color,
      phase: data.phase,
      label: mode === "delegates" && data.delegateLabel ? data.delegateLabel : data.label,
      tooltip: mode === "delegates" && data.delegateTooltip ? data.delegateTooltip : data.tooltip,
    };
  }

  const hasData = Object.keys(stateData).length > 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-3 sm:p-6 overflow-hidden shadow-panel">
      {header && <div className="mb-4">{header}</div>}
      <div
        className="w-full max-w-full rounded-lg bg-background p-2 sm:p-4 min-h-[280px] sm:min-h-[320px] overflow-hidden"
        style={{ aspectRatio: "960/600", boxShadow: "inset 0 2px 8px 0 rgb(0 0 0 / 0.4)" }}
      >
        <USAMapPaths
          stateData={normalized}
          highlightedStates={waveHighlight}
          onStateClick={onStateClick}
        />
      </div>
      {!hasData && (
        <div className="mt-4 px-2 text-sm text-muted">
          No primary data yet. State colors appear as the stagger window progresses.
        </div>
      )}
      {footer && <div className="mt-4">{footer}</div>}
    </div>
  );
}
