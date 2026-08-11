import React from "react";

export function BarMeter({
  pct,
  fillStyle,
  segments = 5,
}: {
  pct: number;
  fillStyle: React.CSSProperties;
  segments?: number;
}) {
  return (
    <div className="relative h-2.5 w-full bg-card-elevated rounded-full overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, ...fillStyle }}
      />
      {Array.from({ length: segments - 1 }).map((_, i) => (
        <div
          key={i}
          className="absolute inset-y-0 w-px bg-card/20"
          style={{ left: `${((i + 1) / segments) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function StatMeter({
  value,
  max = 100,
  color,
}: {
  value: number;
  max?: number;
  color: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <BarMeter
      pct={pct}
      fillStyle={{
        backgroundColor: color,
        boxShadow: `0 0 10px -2px ${color}88`,
      }}
    />
  );
}

export function HeatMeter({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const t = pct / 100;
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(34 + s * 221); // from emerald-800 to yellow-500
    g = Math.round(197 + s * 0);
    b = Math.round(94 - s * 94);
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(255 + s * 0); // from yellow-500 to red-600
    g = Math.round(197 - s * 197);
    b = Math.round(0 + s * 0);
  }
  const color = `rgb(${r},${g},${b})`;
  return (
    <BarMeter
      pct={pct}
      fillStyle={{
        backgroundColor: color,
        boxShadow: `0 0 10px -2px ${color}88`,
      }}
    />
  );
}

export function SectionHeader({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4 pb-2 border-b border-card-border">
      <h2 className="text-sm font-bold uppercase tracking-widest text-muted">{children}</h2>
      {action}
    </div>
  );
}
