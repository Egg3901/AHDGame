"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import {
  MAX_RATE_CHANGE_DELTA,
  MAX_RATE_CUT_DELTA,
  AGGRESSIVE_CUT_SCRUTINY,
  RATE_CHANGE_COOLDOWN_TURNS,
  PRIME_RATE_STEP,
  snapToPrimeRateGrid,
} from "@/lib/db/types/centralBank";

export interface RateGovernance {
  allowedActions: Array<{ action: string; allowed: boolean; reason?: string }>;
  nextDeadline: { turn: number; kind: string } | null;
}

export function PrimeRateCard({
  primeRate,
  isChair,
  chairControlsLocked,
  governmentControlled = false,
  viewerSetsRate = false,
  committeeSeated = false,
  committeeDead = false,
  onOpenCommittee,
  lastRateChangeTurn,
  currentTurn,
  bankApiBasePath,
  onChanged,
  governance,
  governanceEndpoint,
}: {
  primeRate: number;
  isChair: boolean;
  chairControlsLocked: boolean;
  /** The government, not the bank, sets the rate (pre-1997 Bank of England). */
  governmentControlled?: boolean;
  /** Viewer is the head of government or finance minister under government control. */
  viewerSetsRate?: boolean;
  /** A committee is seated, so the rate moves by vote and this card cannot set it. */
  committeeSeated?: boolean;
  /** A committee exists but cannot carry a motion; the chair holds the rate directly. */
  committeeDead?: boolean;
  /** Jump to the committee tab; rendered as the call to action when seated. */
  onOpenCommittee?: () => void;
  lastRateChangeTurn: number | null;
  currentTurn: number;
  bankApiBasePath: string;
  onChanged: () => void;
  /** Server-driven eligibility; when present it owns the control's disabled state. */
  governance?: RateGovernance | null;
  /** FOMC panel endpoint to load governance from when no prop is passed. */
  governanceEndpoint?: string;
}) {
  const [pendingRate, setPendingRate] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rateError, setRateError] = useState<string | null>(null);
  const [fetchedGovernance, setFetchedGovernance] = useState<RateGovernance | null>(null);

  useEffect(() => {
    if (governance !== undefined || !governanceEndpoint) return;
    let cancelled = false;
    fetchJson<{ governance?: RateGovernance }>(governanceEndpoint, {
      feature: "prime-rate-governance",
    })
      .then((body) => {
        if (!cancelled && body?.governance) setFetchedGovernance(body.governance);
      })
      .catch((_error: unknown) => {
        // fetchJson already reports genuine faults; a rejection explicitly
        // keeps the prop fallback below.
        if (!cancelled) setFetchedGovernance(null);
      });
    return () => {
      cancelled = true;
    };
  }, [governance, governanceEndpoint]);

  // Server-driven eligibility owns the control when available; the prop
  // derivation below is only the fallback for banks without a committee.
  const effectiveGovernance = governance ?? fetchedGovernance;
  const setRateAction = effectiveGovernance?.allowedActions.find((a) => a.action === "set_rate");
  const governedRefusal = setRateAction && !setRateAction.allowed ? setRateAction.reason : null;

  const currentRate = pendingRate ?? primeRate;

  const handleSubmit = async () => {
    if (pendingRate === null) return;
    setSubmitting(true);
    setRateError(null);
    try {
      const res = await fetch(`${bankApiBasePath}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rate: pendingRate,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error((json as { error?: string }).error || "Failed to update rate");
      }
      setPendingRate(null);
      setReason("");
      setRateError(null);
      onChanged();
    } catch (err) {
      setRateError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const turnsSinceLast = lastRateChangeTurn !== null ? currentTurn - lastRateChangeTurn : Infinity;
  const cooldownRemaining = Math.max(0, RATE_CHANGE_COOLDOWN_TURNS - turnsSinceLast);
  const onCooldown = cooldownRemaining > 0;
  // The stored rate can sit off the quarter-point grid, because an autonomous
  // chair sets a continuous Taylor-rule value. The API only accepts grid rates,
  // so step from the nearest grid point rather than from the raw rate: from an
  // off-grid base every offer would be off-grid too and the chair could never
  // move the rate at all (ticket #1238). The floor and ceiling still key off
  // the real current rate, since that is what the delta limits are measured
  // against.
  const gridBase = snapToPrimeRateGrid(primeRate);
  const rateFloor = Math.max(0, primeRate - MAX_RATE_CUT_DELTA);
  const rateCeiling = Math.min(25, primeRate + MAX_RATE_CHANGE_DELTA);
  const aggressiveCutThreshold = primeRate - MAX_RATE_CHANGE_DELTA;
  const isAggressiveCut = pendingRate !== null && pendingRate < aggressiveCutThreshold - 1e-9;

  return (
    <div className="min-w-0 rounded-xl border border-card-border bg-card p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted">
        Prime Rate
      </h2>
      <p className="text-4xl font-bold text-foreground">{(primeRate ?? 0).toFixed(2)}%</p>

      <div className="mt-4 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-xs text-muted space-y-1">
        <div className="font-semibold uppercase tracking-wider text-[10px] text-foreground/80">
          Policy Targets
        </div>
        <div className="flex min-w-0 justify-between gap-3">
          <span className="min-w-0">Inflation target</span>
          <span className="shrink-0 tabular-nums font-medium text-foreground">2.00%</span>
        </div>
        <div className="flex min-w-0 justify-between gap-3">
          <span className="min-w-0">GDP growth target</span>
          <span className="shrink-0 tabular-nums font-medium text-foreground">3.00%</span>
        </div>
        <div className="flex min-w-0 justify-between gap-3">
          <span className="min-w-0">Neutral prime rate</span>
          <span className="shrink-0 tabular-nums font-medium text-foreground">3.00%</span>
        </div>
        <p className="pt-1 text-[11px] leading-snug text-muted">
          Raise rates when inflation runs above 2% to cool demand; cut rates when GDP growth sags
          below 3% to stimulate the economy. Rates near 3% are roughly neutral.
        </p>
      </div>

      {governmentControlled && (
        <div className="mt-4 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-xs text-muted">
          This bank has no operational independence: the rate is set by the head of government or
          the finance minister, not by the bank. Independence would take an act of the legislature.
        </div>
      )}

      {!governmentControlled && isChair && chairControlsLocked && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Chair rate controls are locked by an administrator.
        </div>
      )}

      {committeeSeated && !governmentControlled && (
        <div className="mt-4 rounded-lg border border-card-border bg-card-elevated px-3 py-2 text-xs text-muted">
          A committee is seated: the rate moves by committee vote, not by chair decree.
          {onOpenCommittee && (
            <>
              {" "}
              <button
                type="button"
                onClick={onOpenCommittee}
                className="font-semibold text-foreground underline underline-offset-2"
              >
                Open the committee room
              </button>
              .
            </>
          )}
        </div>
      )}

      {committeeDead && !governmentControlled && (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          The committee board is understaffed: with too few seated members it cannot carry a rate
          motion, so the chair is setting the rate directly.
          {onOpenCommittee && (
            <>
              {" "}
              <button
                type="button"
                onClick={onOpenCommittee}
                className="font-semibold text-foreground underline underline-offset-2"
              >
                Nominate governors
              </button>{" "}
              to restore the committee&apos;s vote.
            </>
          )}
        </div>
      )}

      {(setRateAction
        ? true
        : !committeeSeated &&
          (governmentControlled ? viewerSetsRate : isChair && !chairControlsLocked)) && (
        <div className="mt-4 space-y-3 border-t border-card-border pt-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <label className="shrink-0 text-xs font-medium text-muted">Adjust Rate</label>
            <span className="text-[11px] leading-snug text-muted">
              Hike max +{MAX_RATE_CHANGE_DELTA.toFixed(2)}% · Cut max -
              {MAX_RATE_CUT_DELTA.toFixed(2)}% · one change per {RATE_CHANGE_COOLDOWN_TURNS} turns
            </span>
          </div>
          {onCooldown && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              On cooldown - {cooldownRemaining} more turn
              {cooldownRemaining === 1 ? "" : "s"} before the next rate change.
            </div>
          )}
          {governedRefusal && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {governedRefusal}
            </div>
          )}
          {effectiveGovernance?.nextDeadline && (
            <p className="text-[11px] text-muted">
              Next deadline: turn {effectiveGovernance.nextDeadline.turn} (
              {effectiveGovernance.nextDeadline.kind === "meeting_deadline"
                ? "the vote closes"
                : "next session opens"}
              ).
            </p>
          )}
          {isAggressiveCut && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Aggressive cut - this move exceeds the normal ±{MAX_RATE_CHANGE_DELTA.toFixed(2)}%
              threshold and will add{" "}
              <span className="font-semibold">+{AGGRESSIVE_CUT_SCRUTINY} scrutiny</span> to the
              chair immediately.
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setPendingRate(Math.max(rateFloor, (pendingRate ?? gridBase) - PRIME_RATE_STEP))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-card-elevated text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors disabled:opacity-40"
              disabled={
                submitting ||
                onCooldown ||
                governedRefusal !== null ||
                (pendingRate ?? gridBase) - PRIME_RATE_STEP < rateFloor - 1e-9
              }
            >
              -
            </button>
            <span className="min-w-[4rem] text-center text-lg font-semibold text-foreground">
              {currentRate.toFixed(2)}%
            </span>
            <button
              onClick={() =>
                setPendingRate(Math.min(rateCeiling, (pendingRate ?? gridBase) + PRIME_RATE_STEP))
              }
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-card-border bg-card-elevated text-foreground hover:bg-primary/10 hover:border-primary/30 transition-colors disabled:opacity-40"
              disabled={
                submitting ||
                onCooldown ||
                governedRefusal !== null ||
                (pendingRate ?? gridBase) + PRIME_RATE_STEP > rateCeiling + 1e-9
              }
            >
              +
            </button>
          </div>
          <p className="text-[11px] text-muted">
            Allowed range this change: {rateFloor.toFixed(2)}% - {rateCeiling.toFixed(2)}%
            {aggressiveCutThreshold > rateFloor && (
              <>
                {" "}
                · cuts below {aggressiveCutThreshold.toFixed(2)}% add {AGGRESSIVE_CUT_SCRUTINY}{" "}
                scrutiny
              </>
            )}
          </p>
          <input
            type="text"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            disabled={onCooldown || governedRefusal !== null}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-primary/50 focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={handleSubmit}
            disabled={
              submitting ||
              onCooldown ||
              governedRefusal !== null ||
              pendingRate === null ||
              pendingRate === primeRate
            }
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "Updating..." : "Confirm Rate Change"}
          </button>
          {rateError && <p className="text-xs text-error">{rateError}</p>}
        </div>
      )}
    </div>
  );
}
