"use client";

import { Slider, Label } from "@/components/ui";
import { PLATFORM_AXIS_MAX, PLATFORM_AXIS_MIN } from "@/lib/charters/overtonGuardrails";

/**
 * Phase 6 minimal-MVP platform editor (D6). Renders a slider per charter
 * platform axis — economic and social — each clamped to `[-60, +60]`. No
 * fancy Overton-window visualization; just the labels at each pole and the
 * current numeric value.
 *
 * Foreign-policy and culture sliders were removed in ticket #1032: they
 * were recorded on the charter but no gameplay mechanic ever read them.
 *
 * Used in `/charters/new` for drafting and (read-only) on `/charters/[id]`
 * to display the proposed platform.
 */
export interface PlatformValue {
  economic: number;
  social: number;
}

interface AxisDef {
  key: keyof PlatformValue;
  label: string;
  leftPole: string;
  rightPole: string;
}

const AXES: AxisDef[] = [
  { key: "economic", label: "Economic", leftPole: "Left", rightPole: "Right" },
  { key: "social", label: "Social", leftPole: "Progressive", rightPole: "Conservative" },
];

interface PlatformSlidersProps {
  value: PlatformValue;
  onChange?: (axis: keyof PlatformValue, value: number) => void;
  /** When true, sliders are read-only (used on detail page). */
  readOnly?: boolean;
}

export function PlatformSliders({ value, onChange, readOnly = false }: PlatformSlidersProps) {
  return (
    <div className="space-y-4">
      {AXES.map((axis) => (
        <div key={axis.key} className="space-y-1">
          <div className="flex items-baseline justify-between">
            <Label htmlFor={`platform-${axis.key}`} className="text-sm font-medium">
              {axis.label}
            </Label>
            <span className="font-mono text-xs text-muted">{value[axis.key]}</span>
          </div>
          <Slider
            id={`platform-${axis.key}`}
            min={PLATFORM_AXIS_MIN}
            max={PLATFORM_AXIS_MAX}
            step={1}
            value={value[axis.key]}
            onChange={(e) => onChange?.(axis.key, Number(e.target.value))}
            disabled={readOnly}
          />
          <div className="flex justify-between text-[11px] text-muted">
            <span>{axis.leftPole}</span>
            <span>{axis.rightPole}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
