"use client";

import { PositionLabel } from "@/components/PositionLabel";

export function AppealBar({ appeal, max = 50 }: { appeal: number; max?: number }) {
  const pct = Math.min(100, (appeal / max) * 100);
  const color =
    appeal >= 35
      ? "bg-green-500"
      : appeal >= 20
        ? "bg-yellow-500"
        : appeal >= 10
          ? "bg-orange-500"
          : "bg-red-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-card-border overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Display a player/opponent economic position using canonical labels */
export function EconomicPositionPip({ value }: { value: number }) {
  return <PositionLabel value={value} axis="economic" className="text-xs font-medium" />;
}

/** Display a player/opponent social position using canonical labels */
export function SocialPositionPip({ value }: { value: number }) {
  return <PositionLabel value={value} axis="social" className="text-xs font-medium" />;
}

/** Display a demographic group's continuous lean (−5 to +5) with color */
export function LeanPip({ lean }: { lean: number }) {
  return <PositionLabel value={lean} axis="economic" className="text-xs font-medium" />;
}
