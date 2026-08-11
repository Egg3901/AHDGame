"use client";
import { positionBucketHex } from "@/lib/utils/politics";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  axis?: "economic" | "social" | "neutral";
  suffix?: string;
  onChange: (v: number) => void;
}

export function StatSlider({
  label,
  value,
  min,
  max,
  step = 0.1,
  axis = "neutral",
  suffix,
  onChange,
}: Props) {
  const accent =
    axis === "economic"
      ? positionBucketHex(value, "economic")
      : axis === "social"
        ? positionBucketHex(value, "social")
        : "var(--secondary)";
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="w-40 shrink-0 text-xs text-muted">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ahd-slider flex-1"
        style={{ "--slider-accent": accent } as React.CSSProperties}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ahd-num w-20 rounded-md border border-card-border bg-background px-2 py-1 text-right text-sm tabular-nums focus:border-primary focus:outline-none"
      />
      {suffix ? <span className="w-6 text-xs text-muted">{suffix}</span> : null}
    </div>
  );
}
