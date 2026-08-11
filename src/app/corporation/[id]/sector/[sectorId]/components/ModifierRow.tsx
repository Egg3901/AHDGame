"use client";

import type { LucideIcon } from "lucide-react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { InfoTooltip } from "@/components/InfoTooltip";

function modColor(val: number): string {
  if (val > 0) return "text-success";
  if (val < 0) return "text-error";
  return "text-muted";
}

function modSign(val: number): string {
  if (val > 0) return `+${val}`;
  return `${val}`;
}

interface ModifierRowProps {
  label: string;
  modifier: number;
  rawValue: number | null;
  rawUnit: string;
  tooltip: string;
  icon: LucideIcon;
}

export default function ModifierRow({
  label,
  modifier,
  rawValue,
  rawUnit,
  tooltip,
  icon: Icon,
}: ModifierRowProps) {
  return (
    <div className="flex items-center justify-between text-sm">
      <InfoTooltip
        trigger={
          <span className="flex items-center gap-2 cursor-default">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-card-elevated border border-card-border text-muted">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="text-foreground border-b border-dotted border-muted/40">{label}</span>
          </span>
        }
        width={260}
      >
        <p className="font-semibold text-foreground mb-1">{label}</p>
        <p className="text-muted">{tooltip}</p>
        {rawValue != null && (
          <p className="text-muted mt-1 border-t border-card-border pt-1">
            Current:{" "}
            <span className="font-medium text-foreground">
              {rawValue}
              {rawUnit}
            </span>
          </p>
        )}
      </InfoTooltip>
      <div className="flex items-center gap-2">
        {rawValue != null && (
          <span className="text-xs text-muted tabular-nums">
            ({rawValue}
            {rawUnit})
          </span>
        )}
        <div className="flex items-center gap-1.5">
          {modifier > 0 ? (
            <TrendingUp className="h-3 w-3 text-success shrink-0" />
          ) : modifier < 0 ? (
            <TrendingDown className="h-3 w-3 text-error shrink-0" />
          ) : (
            <Minus className="h-3 w-3 text-muted shrink-0" />
          )}
          <span className={`font-semibold tabular-nums text-sm ${modColor(modifier)}`}>
            {modSign(modifier)}%
          </span>
        </div>
      </div>
    </div>
  );
}
