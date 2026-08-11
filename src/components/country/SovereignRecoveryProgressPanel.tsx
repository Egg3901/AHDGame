"use client";

import { useEffect, useState } from "react";

const RECOVERY_FLOOR_TURNS = 48;
const RECOVERY_DISCIPLINE_REQUIRED_STREAK = 5;

interface RecoveryStatus {
  crisisState: string;
  currentTurn: number;
  recoveryStartedAt: { turn: number } | null;
  recoveryFiscalDisciplineStreak: number;
  marketAccessLockedUntilTurn: number | null;
  recoveryGdpPenaltyPercent: number | null;
  recoveryGdpPenaltyTurnsRemaining: number | null;
  imfSovereignBailoutActive: boolean;
}

interface Props {
  countryCode: string;
}

export function SovereignRecoveryProgressPanel({ countryCode }: Props) {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/country/${countryCode}/sovereign-status`);
        if (!res.ok) return;
        const data = (await res.json()) as RecoveryStatus & Record<string, unknown>;
        if (!cancelled) setStatus(data);
      } catch {
        // ignore
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [countryCode]);

  if (!status || status.crisisState !== "recovering" || !status.recoveryStartedAt) return null;

  const turnsSinceStart = status.currentTurn - status.recoveryStartedAt.turn;
  const floorPct = Math.min(100, Math.round((turnsSinceStart / RECOVERY_FLOOR_TURNS) * 100));
  const streakPct = Math.min(
    100,
    Math.round((status.recoveryFiscalDisciplineStreak / RECOVERY_DISCIPLINE_REQUIRED_STREAK) * 100)
  );

  return (
    <div className="rounded-lg border border-amber-500 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950">
      <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">
        Sovereign Recovery — In Progress
      </h3>
      <div className="mt-3 space-y-3 text-xs">
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-amber-700 dark:text-amber-300">Recovery floor</span>
            <span className="tabular-nums text-amber-800 dark:text-amber-200">
              {Math.min(turnsSinceStart, RECOVERY_FLOOR_TURNS)} / {RECOVERY_FLOOR_TURNS} turns
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-amber-200 dark:bg-amber-900">
            <div
              className="h-full bg-amber-600 dark:bg-amber-400"
              style={{ width: `${floorPct}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-amber-700 dark:text-amber-300">Fiscal-discipline streak</span>
            <span className="tabular-nums text-amber-800 dark:text-amber-200">
              {status.recoveryFiscalDisciplineStreak} / {RECOVERY_DISCIPLINE_REQUIRED_STREAK}{" "}
              required
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-amber-200 dark:bg-amber-900">
            <div
              className="h-full bg-amber-600 dark:bg-amber-400"
              style={{ width: `${streakPct}%` }}
            />
          </div>
        </div>

        {status.marketAccessLockedUntilTurn !== null ? (
          <p className="text-amber-700 dark:text-amber-300">
            Bond market access locked for{" "}
            <span className="font-medium tabular-nums">
              {Math.max(0, status.marketAccessLockedUntilTurn - status.currentTurn)}
            </span>{" "}
            more turns (until turn {status.marketAccessLockedUntilTurn}).
          </p>
        ) : null}

        {status.recoveryGdpPenaltyPercent !== null &&
        status.recoveryGdpPenaltyTurnsRemaining !== null &&
        status.recoveryGdpPenaltyTurnsRemaining > 0 ? (
          <p className="text-amber-700 dark:text-amber-300">
            GDP penalty: {(status.recoveryGdpPenaltyPercent * 100).toFixed(1)}% over{" "}
            {status.recoveryGdpPenaltyTurnsRemaining} turns remaining.
          </p>
        ) : null}

        {status.imfSovereignBailoutActive ? (
          <span className="inline-block rounded border border-emerald-600 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:border-emerald-400 dark:bg-emerald-950 dark:text-emerald-200">
            IMF bailout facility active
          </span>
        ) : null}
      </div>
    </div>
  );
}
