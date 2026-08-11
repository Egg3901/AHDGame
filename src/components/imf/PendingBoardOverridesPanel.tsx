"use client";

import { useState } from "react";
import { Slider } from "@/components/ui";
import {
  IMF_BOARD_RATE_DELTA_BOUND,
  IMF_BOARD_CAPTURE_DELTA_BOUND,
} from "@/lib/sovereignDefault/constants";

interface Override {
  countryCode: string;
  windowEndAtRealtimeMs: number;
  windowEndAtTurn?: number | null;
  crisisChoice: string | null;
  facilityTerms: { principal: number; annualRate: number; incomeCaptureFraction: number };
}

interface Props {
  overrides: Override[];
  currentTurn: number | null;
  isBoardMember: boolean;
  onActioned: () => void;
}

export function PendingBoardOverridesPanel({
  overrides,
  currentTurn,
  isBoardMember,
  onActioned,
}: Props) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold">Pending Board Decisions</h2>
      {overrides.length === 0 ? (
        <p className="mt-2 text-xs text-zinc-500">No open override windows.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {overrides.map((o) => (
            <OverrideRow
              key={o.countryCode}
              row={o}
              currentTurn={currentTurn}
              isBoardMember={isBoardMember}
              onActioned={onActioned}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// Sourced from server-side constants so the UI clamp visualization stays
// in sync if the bounds are recalibrated. The route still re-clamps on the
// server side regardless.
const RATE_DELTA_BOUND_PP = IMF_BOARD_RATE_DELTA_BOUND * 100;
const CAPTURE_DELTA_BOUND = IMF_BOARD_CAPTURE_DELTA_BOUND;

function OverrideRow({
  row,
  currentTurn,
  isBoardMember,
  onActioned,
}: {
  row: Override;
  currentTurn: number | null;
  isBoardMember: boolean;
  onActioned: () => void;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showModifyForm, setShowModifyForm] = useState(false);
  const [rateDelta, setRateDelta] = useState(0);
  const [captureDelta, setCaptureDelta] = useState(0);

  // Turn-first countdown (freezes on pause; matches the turn-based override
  // window) with a wall-clock fallback for windows opened before `.turn` existed.
  const remainingTurns =
    typeof row.windowEndAtTurn === "number" && currentTurn != null
      ? Math.max(0, row.windowEndAtTurn - currentTurn)
      : Math.max(0, Math.round((row.windowEndAtRealtimeMs - Date.now()) / 3_600_000));

  async function submit(action: string, extras: Record<string, unknown> = {}) {
    setSubmitting(action);
    setError(null);
    try {
      const res = await fetch("/api/imf/board/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          countryCode: row.countryCode,
          action,
          ...extras,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Submission failed (${res.status})`);
        return;
      }
      onActioned();
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <li className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{row.countryCode}</span>
        <span className="text-xs text-zinc-500">
          {remainingTurns} turn{remainingTurns === 1 ? "" : "s"} remaining
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Choice: {row.crisisChoice ?? "n/a"} · Principal $
        {(row.facilityTerms.principal / 1e9).toFixed(1)}B · Rate{" "}
        {row.facilityTerms.annualRate.toFixed(1)}% · Capture{" "}
        {(row.facilityTerms.incomeCaptureFraction * 100).toFixed(0)}%
      </p>
      {isBoardMember ? (
        <>
          <div className="mt-2 grid gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() =>
                void submit("endorse", { statement: "Bailout terms endorsed by IMF Board." })
              }
              disabled={submitting !== null}
              className="rounded-md border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting === "endorse" ? "Submitting…" : "Endorse"}
            </button>
            <button
              type="button"
              onClick={() =>
                void submit("criticize", { statement: "Bailout terms criticized by IMF Board." })
              }
              disabled={submitting !== null}
              className="rounded-md border border-rose-600 bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {submitting === "criticize" ? "Submitting…" : "Criticize"}
            </button>
            <button
              type="button"
              onClick={() => setShowModifyForm((v) => !v)}
              disabled={submitting !== null}
              className="rounded-md border border-amber-600 bg-amber-600 px-2 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {showModifyForm ? "Cancel Modify" : "Modify Terms"}
            </button>
            <button
              type="button"
              onClick={() => void submit("no-action")}
              disabled={submitting !== null}
              className="rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            >
              {submitting === "no-action" ? "Submitting…" : "No Action"}
            </button>
          </div>
          {showModifyForm ? (
            <div className="mt-3 space-y-2 rounded border border-amber-300 bg-amber-50 p-2 dark:border-amber-700 dark:bg-amber-950">
              <div>
                <label className="block text-xs text-zinc-700 dark:text-zinc-300">
                  Rate Δ (pp): {rateDelta.toFixed(2)} (clamped ±{RATE_DELTA_BOUND_PP}pp)
                </label>
                <Slider
                  variant="warning"
                  min={-RATE_DELTA_BOUND_PP}
                  max={RATE_DELTA_BOUND_PP}
                  step={0.1}
                  value={rateDelta}
                  onChange={(e) => setRateDelta(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-700 dark:text-zinc-300">
                  Capture Δ: {(captureDelta * 100).toFixed(1)}pp (clamped ±
                  {(CAPTURE_DELTA_BOUND * 100).toFixed(0)}pp)
                </label>
                <Slider
                  variant="warning"
                  min={-CAPTURE_DELTA_BOUND}
                  max={CAPTURE_DELTA_BOUND}
                  step={0.005}
                  value={captureDelta}
                  onChange={(e) => setCaptureDelta(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  void submit("modify-terms", {
                    rateDelta,
                    captureDelta,
                  })
                }
                disabled={submitting !== null}
                className="rounded-md border border-amber-700 bg-amber-700 px-3 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
              >
                {submitting === "modify-terms" ? "Applying…" : "Apply Modification"}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="mt-2 text-xs text-zinc-500">Board members only.</p>
      )}
      {error ? <p className="mt-2 text-xs text-rose-600">{error}</p> : null}
    </li>
  );
}
