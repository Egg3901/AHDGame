import Image from "next/image";
import { InfoTooltip } from "@/components/InfoTooltip";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import type { CorporationType } from "@/lib/constants/corporations";

/**
 * Classes for a sector type chip. Chips are neutral on purpose: the label names
 * the type, so no type gets its own hue. Every sector type chip uses this one
 * helper.
 */
export function getTypeColor(_type: CorporationType): string {
  return "border-card-border bg-card text-foreground";
}

export function FinRowTip({
  label,
  value,
  daily,
  valueClass = "text-foreground",
  bold = false,
  indent = false,
  tooltip,
}: {
  label: string;
  /** Primary figure, shown per turn. */
  value: string;
  /** Secondary figure, the same amount expressed per financial day. */
  daily?: string;
  valueClass?: string;
  bold?: boolean;
  indent?: boolean;
  tooltip: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <InfoTooltip
        trigger={
          <span
            className={`text-sm border-b border-dotted border-muted/40 ${indent ? "pl-4 text-muted" : bold ? "font-semibold text-foreground" : "text-foreground"}`}
          >
            {label}
          </span>
        }
        width={260}
      >
        <p className="font-semibold text-foreground mb-1">{label}</p>
        <p className="text-muted">{tooltip}</p>
        {daily && (
          <p className="text-muted mt-1 border-t border-card-border pt-1">
            Per day: <span className="font-medium text-foreground">{daily}</span>
          </p>
        )}
      </InfoTooltip>
      <span className={`text-sm tabular-nums ${bold ? "font-bold" : "font-medium"} ${valueClass}`}>
        {value}
        {daily && <span className="text-xs font-normal text-muted ml-0.5">/turn</span>}
      </span>
    </div>
  );
}

export function FinRow({
  label,
  value,
  valueClass = "text-foreground",
  bold = false,
  indent = false,
  flagState,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
  indent?: boolean;
  flagState?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span
        className={`text-sm ${indent ? "pl-4 text-muted" : bold ? "font-semibold text-foreground" : "text-foreground"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${bold ? "font-bold" : "font-medium"} ${valueClass} flex items-center gap-1.5`}
      >
        {flagState && STATE_FLAGS[flagState] && (
          <Image
            src={STATE_FLAGS[flagState]}
            alt={flagState}
            width={20}
            height={14}
            className="rounded-sm object-cover"
            unoptimized={bypassNextImageOptimization(STATE_FLAGS[flagState])}
          />
        )}
        {value}
      </span>
    </div>
  );
}
