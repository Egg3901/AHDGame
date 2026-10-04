import { Tooltip } from "@/components/Tooltip";
import { getEconomicPositionName, getSocialPositionName } from "@/lib/utils/politics";
import { formatLeanValue } from "@/lib/utils/demographics";

export interface PlainPositionLabelProps {
  value: number;
  axis: "economic" | "social";
  className?: string;
}

/**
 * The party pages' version of PositionLabel: the same bucket word and the same
 * exact-score tooltip, but in the surrounding text color. A party's lean is a
 * plain word here, so the page does not paint every party a left or right hue.
 */
export function PlainPositionLabel({ value, axis, className = "" }: PlainPositionLabelProps) {
  const label = axis === "economic" ? getEconomicPositionName(value) : getSocialPositionName(value);
  const score = formatLeanValue(value);
  const axisName = axis === "economic" ? "Economic" : "Social";

  return (
    <Tooltip content={<span className="text-body-sm tabular-nums">{`${axisName}: ${score}`}</span>}>
      <span data-score={score} className={`cursor-help ${className}`.trim()}>
        {label}
      </span>
    </Tooltip>
  );
}
