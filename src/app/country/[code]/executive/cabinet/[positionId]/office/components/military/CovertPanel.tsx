"use client";

import { useState } from "react";
import type { CovertFunding, CovertStage } from "@/lib/military/covertNuclear";
import { AggTile, fmtMoneyAbs } from "./militaryUi";

/** The covert GET route's payload, as the flagship fetches it. */
export interface CovertStatusView {
  eligible: boolean;
  state: {
    stage: number;
    progress: number;
    funding: CovertFunding;
    suspicion: number;
    exposureCount: number;
    startedTurn: number | null;
    completed: boolean;
    brokenOutTurn: number | null;
  };
  stages: CovertStage[];
  stageProgress: number;
  discoveryChance: number;
  fundingOptions: Array<{ key: CovertFunding; cost: number; progress: number }>;
}

const FUNDING_LABEL: Record<CovertFunding, string> = {
  none: "None",
  trickle: "Trickle",
  steady: "Steady",
  crash: "Crash",
};

/** Qualitative suspicion band: what the seat sees instead of Moscow's ledger. */
export function suspicionLabel(suspicion: number): "COLD" | "WARM" | "HOT" {
  if (suspicion < 20) return "COLD";
  if (suspicion < 50) return "WARM";
  return "HOT";
}

const SUSPICION_TONE: Record<string, "gov" | "warning" | undefined> = {
  COLD: "gov",
  WARM: undefined,
  HOT: "warning",
};

/**
 * The covert programme: the hidden stage ladder, the funding dial, and when
 * the device is banked, the breakout decision. Presentational; fetching and
 * mutations live in MilitaryFlagship, like the overt tab. SECRET: composed
 * only inside the defence seat's own panel, never anywhere else.
 */
export function CovertPanel({
  status,
  currencySymbol,
  canAct,
  busy,
  onSetFunding,
  onBreakout,
}: {
  /** Undefined while the flagship's fetch is still in flight. */
  status?: CovertStatusView;
  currencySymbol: string;
  canAct: boolean;
  busy: boolean;
  onSetFunding: (funding: CovertFunding) => Promise<boolean>;
  onBreakout: () => Promise<boolean>;
}) {
  // Breakout is once and cannot be taken back, so it takes two clicks.
  const [confirmingBreakout, setConfirmingBreakout] = useState(false);

  if (!status) {
    return (
      <div className="rounded-xl border border-card-border bg-card px-4 py-6 text-center text-[13px] text-muted">
        Loading the special programme...
      </div>
    );
  }

  const { state, stages, stageProgress } = status;
  const band = suspicionLabel(state.suspicion);
  const brokenOut = state.brokenOutTurn != null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AggTile
          label="Soviet suspicion"
          value={band}
          tone={SUSPICION_TONE[band]}
          ring={state.suspicion}
        />
        <AggTile
          label="Discovery risk per turn"
          value={`${(status.discoveryChance * 100).toFixed(1)}%`}
          tone={status.discoveryChance > 0.01 ? "warning" : undefined}
        />
        <AggTile
          label="Crackdowns suffered"
          value={state.exposureCount.toLocaleString("en-US")}
          tone={state.exposureCount > 0 ? "warning" : undefined}
        />
      </div>

      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Special construction programme</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Off the books. Nothing here appears on any budget line or public surface. Funding harder
            moves faster and burns brighter; the Soviets are watching.
          </p>
        </div>
        <div className="space-y-2 px-4 py-3">
          {stages.map((stage, i) => {
            const done = i < state.stage || state.completed;
            const current = !state.completed && i === state.stage;
            return (
              <div
                key={stage.key}
                className={`rounded-lg border px-3 py-2.5 ${
                  done
                    ? "border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[color-mix(in_srgb,var(--success)_6%,transparent)]"
                    : current
                      ? "border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_6%,transparent)]"
                      : "border-card-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background: done
                        ? "var(--success, #4ea87a)"
                        : current
                          ? "var(--gov)"
                          : "#4a4a58",
                    }}
                  />
                  <span
                    className={`text-[13px] font-semibold ${
                      done || current ? "text-foreground" : "text-muted"
                    }`}
                  >
                    {stage.name}
                  </span>
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wider text-muted">
                    {done ? "Complete" : current ? "In progress" : "Locked"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">{stage.desc}</p>
                {current && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#2a2a36]">
                    <div
                      className="h-full rounded-full bg-[var(--gov)]"
                      style={{ width: `${Math.round((state.progress / stageProgress) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!state.completed && (
        <div className="rounded-xl border border-card-border bg-card">
          <div className="border-b border-card-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">Funding level</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              Drawn quietly from the defence appropriation each turn. A turn the treasury cannot
              cover makes no progress. An idle programme cools.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {status.fundingOptions.map((opt) => (
              <button
                key={opt.key}
                disabled={busy || !canAct || state.funding === opt.key}
                onClick={() => void onSetFunding(opt.key)}
                className={`rounded-lg border px-3 py-2 text-[12px] font-semibold disabled:opacity-50 ${
                  state.funding === opt.key
                    ? "border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] text-gov-soft"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                {FUNDING_LABEL[opt.key]}
                <span className="tabular ml-1.5 text-[10px] font-normal">
                  {opt.cost > 0 ? `${fmtMoneyAbs(currencySymbol, opt.cost)}/turn` : "no cost"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {state.completed && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_6%,transparent)]">
          <div className="border-b border-card-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-foreground">The device is assembled</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              {brokenOut
                ? `The breakout test was conducted on turn ${state.brokenOutTurn}. The programme is public.`
                : "A working bomb waits on a political decision. A breakout test announces it to every capital at once: the sharpest tension spike in the system, a Soviet reckoning, and no way back."}
            </p>
          </div>
          {!brokenOut && canAct && (
            <div className="flex items-center gap-3 px-4 py-3">
              {confirmingBreakout ? (
                <button
                  disabled={busy}
                  onClick={() => {
                    setConfirmingBreakout(false);
                    void onBreakout();
                  }}
                  className="rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] px-3 py-2 text-[12px] font-semibold text-[var(--error)] disabled:opacity-50"
                >
                  Confirm breakout test
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => setConfirmingBreakout(true)}
                  className="rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] bg-[color-mix(in_srgb,var(--error)_15%,transparent)] px-3 py-2 text-[12px] font-semibold text-[var(--error)] disabled:opacity-50"
                >
                  Breakout test
                </button>
              )}
              <span className="text-[11px] text-muted">This cannot be undone.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
