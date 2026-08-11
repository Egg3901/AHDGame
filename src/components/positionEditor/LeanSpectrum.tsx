"use client";
import { positionBucketHex } from "@/lib/utils/politics";

interface Props {
  value: number; // -5..+5
  axis: "economic" | "social";
}

export function LeanSpectrum({ value, axis }: Props) {
  const pct = ((Math.max(-5, Math.min(5, value)) + 5) / 10) * 100;
  const gradient =
    axis === "economic"
      ? "linear-gradient(90deg,#1d4ed8,#94a3b8,#b91c1c)"
      : "linear-gradient(90deg,#0d9488,#94a3b8,#b45309)";
  return (
    <div className="relative h-2 w-full rounded-full" style={{ background: gradient }}>
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow"
        style={{ left: `${pct}%`, background: positionBucketHex(value, axis) }}
      />
    </div>
  );
}
