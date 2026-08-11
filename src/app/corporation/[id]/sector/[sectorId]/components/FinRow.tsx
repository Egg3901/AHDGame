"use client";

import { InfoTooltip } from "@/components/InfoTooltip";

interface FinRowProps {
  label: string;
  value: string;
  perHour?: string;
  valueClass?: string;
  bold?: boolean;
  indent?: boolean;
  tooltip: string;
}

export default function FinRow({
  label,
  value,
  perHour,
  valueClass = "text-foreground",
  bold = false,
  indent = false,
  tooltip,
}: FinRowProps) {
  return (
    <div className="flex items-center justify-between">
      <InfoTooltip
        trigger={
          <span
            className={`text-sm border-b border-dotted border-muted/40 ${indent ? "pl-4 text-muted" : bold ? "font-semibold text-foreground" : "text-foreground"}`}
          >
            {indent && "+ "}
            {label}
          </span>
        }
        width={260}
      >
        <p className="font-semibold text-foreground mb-1">{label}</p>
        <p className="text-muted">{tooltip}</p>
        {perHour && (
          <p className="text-muted mt-1 border-t border-card-border pt-1">
            Per hour: <span className="font-medium text-foreground">{perHour}</span>
          </p>
        )}
      </InfoTooltip>
      <span className={`text-sm tabular-nums ${bold ? "font-bold" : "font-medium"} ${valueClass}`}>
        {value}
        {perHour && <span className="text-xs font-normal text-muted ml-0.5">/day</span>}
      </span>
    </div>
  );
}
