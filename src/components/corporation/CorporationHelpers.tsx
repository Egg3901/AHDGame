import Image from "next/image";
import { InfoTooltip } from "@/components/InfoTooltip";
import { STATE_FLAGS } from "@/lib/constants";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import type { CorporationType } from "@/lib/constants/corporations";

export function getTypeColor(type: CorporationType): string {
  const colors: Partial<Record<CorporationType, string>> = {
    financial: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    media: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    manufacturing: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    chemical_industries: "bg-green-500/15 text-green-400 border-green-500/30",
    healthcare: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    retail: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    automobiles: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    technology: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
    energy: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    agriculture: "bg-lime-500/15 text-lime-400 border-lime-500/30",
    real_estate: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    construction: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    defense: "bg-slate-500/15 text-slate-400 border-slate-500/30",
    telecommunications: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
    entertainment: "bg-pink-500/15 text-pink-400 border-pink-500/30",
    logistics: "bg-stone-500/15 text-stone-400 border-stone-500/30",
    extraction: "bg-neutral-500/15 text-neutral-400 border-neutral-500/30",
  };
  return colors[type] ?? "bg-primary/10 text-primary border-primary/30";
}

export function FinRowTip({
  label,
  value,
  perHour,
  valueClass = "text-foreground",
  bold = false,
  indent = false,
  tooltip,
}: {
  label: string;
  value: string;
  perHour?: string;
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
        {perHour && (
          <p className="text-muted mt-1 border-t border-card-border pt-1">
            Per hour: <span className="font-medium text-foreground">{perHour}</span>
          </p>
        )}
      </InfoTooltip>
      <span className={`text-sm tabular-nums ${bold ? "font-bold" : "font-medium"} ${valueClass}`}>
        {value}
        {perHour && !bold && <span className="text-xs font-normal text-muted ml-0.5">/day</span>}
        {perHour && bold && <span className="text-xs font-normal text-muted ml-0.5">/day</span>}
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
