import { Tooltip } from "@/components/Tooltip";
import {
  getEconomicPositionName,
  getSocialPositionName,
  positionBucketColorClass,
} from "@/lib/utils/politics";
import { formatLeanValue } from "@/lib/utils/demographics";

const EUROPEAN_COLOUR_COUNTRIES = new Set(["UK", "DE"]);

export interface PositionLabelProps {
  value: number;
  axis: "economic" | "social";
  /** Country id — drives the UK/DE economic red/blue swap. */
  countryId?: string;
  className?: string;
}

/**
 * Renders an ideology value's bucket label (candidate scale) in the bucket
 * colour, with a hover tooltip revealing the exact score. One component for
 * candidate, party, and region leans so every surface reads the same words.
 */
export function PositionLabel({ value, axis, countryId, className = "" }: PositionLabelProps) {
  const european = axis === "economic" && !!countryId && EUROPEAN_COLOUR_COUNTRIES.has(countryId);
  const label = axis === "economic" ? getEconomicPositionName(value) : getSocialPositionName(value);
  const colorClass = positionBucketColorClass(value, axis, european);
  const score = formatLeanValue(value);
  const axisName = axis === "economic" ? "Economic" : "Social";

  return (
    <Tooltip content={<span className="font-mono text-xs">{`${axisName}: ${score}`}</span>}>
      <span data-score={score} className={`cursor-help ${colorClass} ${className}`}>
        {label}
      </span>
    </Tooltip>
  );
}
