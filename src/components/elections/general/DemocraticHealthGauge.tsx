"use client";

import { useTranslations } from "next-intl";

export interface DemocraticHealthData {
  value: number;
  label: string;
  rulingPartyId?: string;
  rulingPartyName?: string;
  rulingPartyColor?: string;
  partyPenaltyPct: number;
  currentRulerPenaltyPct: number;
  currentRulerReliefPct: number;
  currentRulerInRace: boolean;
  recordedTurn: number;
}

function healthColor(value: number): string {
  if (value < 40) return "#ef4444";
  if (value < 60) return "#f59e0b";
  return "#22c55e";
}

function signedPenalty(value: number): string {
  return `-${Math.max(0, value).toFixed(1)}%`;
}

export function DemocraticHealthGauge({ data }: { data?: DemocraticHealthData | null }) {
  const t = useTranslations("elections");
  if (!data) return null;

  const value = Math.max(0, Math.min(100, data.value));
  const color = healthColor(value);
  const partyLabel = data.rulingPartyName ?? t("democraticHealth.partyFallback");

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          {t("democraticHealth.title")}
        </h3>
        <span className="tabular-nums text-sm font-bold" style={{ color }}>
          {value.toFixed(1)} / 100
        </span>
      </div>
      <p className="mb-3 text-xs leading-snug text-muted">
        {t("democraticHealth.subtitle", { party: partyLabel })}
      </p>
      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full bg-background"
        role="img"
        aria-label={t("democraticHealth.title")}
      >
        <span className="absolute top-0 h-full w-[60%] border-r border-dashed border-muted/60" />
        <span
          className="absolute left-0 top-0 h-full"
          style={{ width: `${value}%`, background: color }}
        />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">{t("democraticHealth.scaleNote")}</p>

      <div className="mt-3 flex flex-col gap-1.5 text-xs">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{t("democraticHealth.partyEffect")}</span>
          <span className="tabular-nums font-bold text-negative">
            {signedPenalty(data.partyPenaltyPct)}
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold">{t("democraticHealth.rulerEffect")}</span>
          <span className="tabular-nums font-bold text-negative">
            {signedPenalty(data.currentRulerPenaltyPct)}
          </span>
        </div>
      </div>

      {!data.currentRulerInRace ? (
        <p className="mt-2 rounded border border-card-border bg-background px-2 py-1.5 text-[11px] leading-snug text-muted">
          {t("democraticHealth.rulerNotRunning")}
        </p>
      ) : null}
      {data.currentRulerReliefPct > 0 ? (
        <p className="mt-2 rounded border border-card-border bg-background px-2 py-1.5 text-[11px] leading-snug text-muted">
          {t("democraticHealth.relief", { percent: data.currentRulerReliefPct.toFixed(0) })}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] uppercase tracking-wider text-muted">
        {t("democraticHealth.recordedTurn", { turn: data.recordedTurn })}
      </p>
    </div>
  );
}
