import {
  getEconomicAxisTickLabels,
  getSocialAxisTickLabels,
  POLICY_INTEGER_AXIS_RANGE,
} from "@/lib/utils/politics";
import { PositionLabel } from "@/components/PositionLabel";

interface PolicyDisplayProps {
  label: string;
  value: number;
  axis?: "economic" | "social";
  showCenterLabel?: boolean;
  size?: "sm" | "md";
}

export function PolicyDisplay({
  label,
  value,
  axis,
  showCenterLabel = false,
  size = "sm",
}: PolicyDisplayProps) {
  const markerSize = size === "md" ? "h-5 w-5" : "h-4 w-4";
  const trackHeight = size === "md" ? "h-3" : "h-2";
  const range = POLICY_INTEGER_AXIS_RANGE;

  const econTicks = getEconomicAxisTickLabels(range);
  const socialTicks = getSocialAxisTickLabels(range);
  const isSocial = axis === "social";
  const ticks = isSocial ? socialTicks : econTicks;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <PositionLabel value={value} axis={axis ?? "economic"} className="text-sm font-medium" />
      </div>
      <div
        className={`relative ${trackHeight} rounded-full ${
          isSocial
            ? "bg-gradient-to-r from-teal-700 via-muted to-amber-600"
            : "bg-gradient-to-r from-blue-600 via-muted to-red-600"
        }`}
      >
        <div
          className={`absolute top-1/2 ${markerSize} -translate-y-1/2 rounded-full border-2 border-white shadow-md`}
          style={{
            left: `${((value + range) / (range * 2)) * 100}%`,
            transform: "translate(-50%, -50%)",
            backgroundColor:
              axis === "social"
                ? value < -0.1
                  ? "#2dd4bf"
                  : value > 0.1
                    ? "#f59e0b"
                    : "#a1a1aa"
                : value < 0
                  ? "#3b82f6"
                  : value > 0
                    ? "#ef4444"
                    : "#a1a1aa",
          }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span className={isSocial ? "text-teal-400/90" : "text-blue-400/90"}>{ticks.negative}</span>
        {showCenterLabel ? <span className="text-muted/80">{ticks.center}</span> : null}
        <span className={isSocial ? "text-amber-400/90" : "text-red-400/90"}>{ticks.positive}</span>
      </div>
    </div>
  );
}
