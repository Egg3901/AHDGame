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

  // Colour only says whether the target shrinks the sector; the figure says
  // how much.
  const sliderVariant = draft < 0 ? ("error" as const) : ("primary" as const);
  const textColor = draft < 0 ? "text-error" : "text-foreground";

  const commit = (value: number) => {
    if (value !== rate) onChange(value);
  };

  return (
    <div
      className="flex min-w-[130px] items-center gap-1.5"
      title={`Growth target: ${draft}%, over ${GROWTH_RATE_TURNS_PER_YEAR} turns (1 game year); range ${MIN_GROWTH_RATE}% to ${MAX_GROWTH_RATE}%`}
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
      <span
        className={`w-10 shrink-0 text-right font-mono text-[12px] font-medium tabular-nums ${textColor}`}
      >
        {draft}%
      </span>
    </div>
  );
}

export function GrowthBarReadOnly({ rate }: { rate: number }) {
  const textColor = rate < 0 ? "text-error" : "text-foreground";
  return (
    <span
      className={`font-mono text-[13px] tabular-nums ${textColor}`}
      title={`Growth target: ${rate}%, applied over ${GROWTH_RATE_TURNS_PER_YEAR} turns (one game year)`}
    >
      {rate}%
    </span>
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
  return (
    <span
      className={`inline-flex items-center gap-1 ${align === "left" ? "" : "justify-end"}`}
      title="The growth rate actually applied this turn, per day. It trends toward the target by 0.5pp per turn."
    >
      <span className="font-mono text-[13px] tabular-nums text-foreground">
        {currentRate.toFixed(1)}%
      </span>
      {currentRate !== targetRate && (
        <span className="text-[10px] text-muted" title="Trending toward target">
          {currentRate < targetRate ? "↑" : "↓"}
        </span>
      )}
    </span>
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
          <span className="inline-flex max-w-full cursor-help items-center gap-1 text-xs text-error">
            <span className="truncate">Reverting to {targetName}</span>
            <span className="shrink-0 font-mono tabular-nums">{transitionTurnsRemaining}t</span>
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
            <span className="inline-flex max-w-full cursor-help items-center gap-1 truncate text-xs text-warning">
              <span className="truncate">To {toName}</span>
              <span className="shrink-0 font-mono tabular-nums">{transitionTurnsRemaining}t</span>
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
            className="shrink-0 text-[11px] text-muted underline decoration-card-border underline-offset-2 hover:text-foreground"
            title={`Cancel transition, costs ${fmtMoney(cancelCostDisplay)}`}
            aria-label="Cancel transition"
          >
            Cancel
          </button>
        )}
      </span>
    );
  }

  if (!isTransitioning && cooldownRemaining > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        Cooldown
        <span className="font-mono tabular-nums">{cooldownRemaining}t</span>
      </span>
    );
  }

  return null;
}

export { SECTOR_STRATEGIES };
