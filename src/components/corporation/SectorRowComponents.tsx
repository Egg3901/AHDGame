"use client";

import { useState } from "react";
import {
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
  GROWTH_RATE_TURNS_PER_YEAR,
} from "@/lib/constants/corporations";
import { STATE_FLAGS } from "@/lib/constants";
import { InfoTooltip } from "@/components/InfoTooltip";
import { Slider } from "@/components/ui";
import { SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { SectorStrategy } from "@/lib/constants/sectorStrategies";
import type { SectorDetail } from "./CorporationPageTypes";

export const GROWTH_HORIZON_SENTENCE = `Target revenue growth is applied over ${GROWTH_RATE_TURNS_PER_YEAR} turns (one game year); each turn uses 1/${GROWTH_RATE_TURNS_PER_YEAR} of this rate (compounding). Higher growth costs more.`;

const GROWTH_STEP = 0.5;

export function StateFlag({ stateId, stateName }: { stateId: string; stateName: string }) {
  const [failed, setFailed] = useState(false);
  const src = STATE_FLAGS[stateId];

  if (!src || failed) {
    return (
      <span className="inline-flex items-center justify-center w-6 h-4 rounded-sm bg-card-elevated text-[7px] font-bold text-muted shrink-0">
        {stateId.slice(0, 3)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={stateName}
      width={24}
      height={16}
      className="rounded-sm object-cover shrink-0 w-6 h-4"
      onError={() => setFailed(true)}
    />
  );
}

export function GrowthBar({
  rate,
  disabled,
  onChange,
}: {
  rate: number;
  disabled: boolean;
  onChange: (newRate: number) => void;
}) {
  const [draft, setDraft] = useState(rate ?? 0);
  const [prevRate, setPrevRate] = useState(rate);

  // Re-sync internal draft when the authoritative rate prop changes (e.g. after
  // a server refetch following a slider commit). Without this the slider would
  // latch on its initial mount value and ignore parent updates. Uses the
  // "store previous value in state" pattern so the sync happens during render
  // rather than in an effect.
  if (rate !== prevRate) {
    setPrevRate(rate);
    setDraft(rate ?? 0);
  }

  const sliderVariant =
    draft < 0
      ? ("error" as const)
      : draft <= 3
        ? ("primary" as const)
        : draft <= 8
          ? ("success" as const)
          : ("warning" as const);
  const textColor =
    draft < 0
      ? "text-error"
      : draft <= 3
        ? "text-primary"
        : draft <= 8
          ? "text-success"
          : "text-warning";

  const commit = (value: number) => {
    if (value !== rate) onChange(value);
  };

  return (
    <div
      className="flex items-center gap-1.5 min-w-[130px]"
      title={`Growth target: ${draft}% — over ${GROWTH_RATE_TURNS_PER_YEAR} turns (1 game year); range ${MIN_GROWTH_RATE}%–${MAX_GROWTH_RATE}%`}
    >
      <Slider
        min={MIN_GROWTH_RATE}
        max={MAX_GROWTH_RATE}
        step={GROWTH_STEP}
        value={draft}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => commit(draft)}
        onKeyUp={() => commit(draft)}
        disabled={disabled}
        variant={sliderVariant}
        className="flex-1 min-w-0"
      />
      <span className={`text-[11px] font-bold tabular-nums w-9 text-right shrink-0 ${textColor}`}>
        {draft}%
      </span>
    </div>
  );
}

export function GrowthBarReadOnly({ rate }: { rate: number }) {
  const range = MAX_GROWTH_RATE - MIN_GROWTH_RATE;
  const fill = Math.max(0, Math.min(1, (rate - MIN_GROWTH_RATE) / range));
  const barColor =
    rate < 0
      ? "bg-error/60"
      : rate <= 3
        ? "bg-primary/60"
        : rate <= 8
          ? "bg-success/50"
          : "bg-warning/60";
  const textColor =
    rate < 0
      ? "text-error"
      : rate <= 3
        ? "text-primary"
        : rate <= 8
          ? "text-success"
          : "text-warning";

  return (
    <div
      className="inline-flex items-center rounded-md border border-card-border overflow-hidden h-5 min-w-[60px]"
      title={`Growth target: ${rate}% — applied over ${GROWTH_RATE_TURNS_PER_YEAR} turns (one game year)`}
    >
      <div className="relative flex-1 h-full bg-card-muted/30">
        <div
          className={`absolute top-0 bottom-0 left-0 ${barColor}`}
          style={{ width: `${fill * 100}%` }}
        />
        <span
          className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums ${textColor} z-10`}
        >
          {rate}%
        </span>
      </div>
    </div>
  );
}

export function ActiveRateDisplay({
  currentRate,
  targetRate,
  align = "right",
}: {
  currentRate: number;
  targetRate: number;
  align?: "left" | "right";
}) {
  const alignment = align === "left" ? "items-start text-left" : "items-end text-right";

  return (
    <div
      className={`flex flex-col ${alignment}`}
      title="The growth rate actually applied this turn. It trends toward the target by 0.5pp per turn."
    >
      <div className="flex items-center gap-1">
        <span className="text-sm tabular-nums font-medium text-foreground">
          {currentRate.toFixed(1)}%
        </span>
        {currentRate !== targetRate && (
          <span className="text-[10px] text-primary" title="Trending toward target">
            {currentRate < targetRate ? "↑" : "↓"}
          </span>
        )}
      </div>
      <span className="text-[10px] text-muted">/day</span>
    </div>
  );
}

export function StatusBadge({
  sector,
  strategies,
  currentId,
  transitionTurnsRemaining,
  cooldownRemaining,
  isTransitioning,
  isReversing,
  isCeo,
  onCancelTransition,
  cancelCostDisplay,
  isCancelPending,
  onCancelPendingSet,
  fmtMoney,
}: {
  sector: SectorDetail;
  strategies: SectorStrategy[] | undefined;
  currentId: string;
  transitionTurnsRemaining: number;
  cooldownRemaining: number;
  isTransitioning: boolean;
  isReversing: boolean;
  isCeo: boolean;
  onCancelTransition?: (sectorId: string) => void;
  cancelCostDisplay: number;
  isCancelPending: boolean;
  onCancelPendingSet: (sectorId: string) => void;
  fmtMoney: (val: number) => string;
}) {
  if (isTransitioning && isReversing) {
    const targetName =
      strategies?.find((s) => s.id === sector.transitionFromStrategyId)?.name ??
      sector.transitionFromStrategyId;
    return (
      <InfoTooltip
        trigger={
          <span className="inline-flex items-center gap-1 rounded border border-error/30 bg-error/10 px-2 py-0.5 text-[10px] font-medium text-error cursor-help max-w-full">
            <span className="truncate">↩ → {targetName}</span>
            <span className="tabular-nums font-bold bg-error/20 rounded px-1 py-px shrink-0">
              {transitionTurnsRemaining}t
            </span>
          </span>
        }
        width={220}
      >
        <p className="font-semibold text-foreground mb-1">Reversing Strategy</p>
        <p className="text-muted">
          Reverting back to <strong>{targetName}</strong>. {transitionTurnsRemaining} turns
          remaining.
        </p>
      </InfoTooltip>
    );
  }

  if (isTransitioning && !isReversing) {
    const fromName =
      strategies?.find((s) => s.id === sector.transitionFromStrategyId)?.name ??
      sector.transitionFromStrategyId;
    const toName = strategies?.find((s) => s.id === currentId)?.name ?? currentId;
    return (
      <span className="inline-flex items-center gap-1 max-w-full">
        <InfoTooltip
          trigger={
            <span className="inline-flex items-center gap-1 rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning cursor-help truncate">
              <span className="truncate">⟳ → {toName}</span>
              <span className="tabular-nums font-bold bg-warning/20 rounded px-1 py-px shrink-0">
                {transitionTurnsRemaining}t
              </span>
            </span>
          }
          width={240}
        >
          <p className="font-semibold text-foreground mb-1">Strategy Transition</p>
          <p className="text-muted">
            Switching from <strong>{fromName}</strong> to <strong>{toName}</strong>.{" "}
            {transitionTurnsRemaining} turns remaining.
          </p>
          <p className="text-muted mt-1 text-[10px]">-5% margin penalty during transition.</p>
        </InfoTooltip>
        {isCeo && onCancelTransition && !isCancelPending && (
          <button
            type="button"
            onClick={() => onCancelPendingSet(sector._id)}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-warning/40 text-[10px] font-bold text-warning hover:bg-warning/20 shrink-0"
            title={`Cancel transition — costs ${fmtMoney(cancelCostDisplay)}`}
            aria-label="Cancel transition"
          >
            ×
          </button>
        )}
      </span>
    );
  }

  if (!isTransitioning && cooldownRemaining > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-muted/30 bg-muted/10 px-2 py-0.5 text-[11px] font-medium text-muted">
        ⏱ Cooldown
        <span className="tabular-nums text-[10px] font-bold bg-muted/20 rounded px-1 py-px">
          {cooldownRemaining}t
        </span>
      </span>
    );
  }

  return <span className="text-[11px] text-muted/40">—</span>;
}

export { SECTOR_STRATEGIES };
