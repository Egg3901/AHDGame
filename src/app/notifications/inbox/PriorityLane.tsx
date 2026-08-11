"use client";

/**
 * PriorityLane — the inline "needs your input" card shown at the top of the
 * inbox. Surfaces the player's active PREE event (the only system with a clean
 * player-facing resolve API today). Crises and campaign actions are deferred:
 * crises use a multi-turn decision tree and treasury-level costs that don't fit
 * the one-card model, and campaign actions have no enumerable card surface.
 *
 * Flow: fetch active event → pick an option → commit (POST resolve) → collapse
 * to an inline resolution. No odds/cost are shown for events because the backend
 * does not expose per-option probabilities or costs — only an optional stat
 * adjustment per option, which we surface honestly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

interface EventOption {
  id: string;
  label: string;
  description: string;
  isDefault: boolean;
  statAdjustment?: { stat: string; label: string; delta: number };
}

interface ActiveEvent {
  instanceId: string;
  kind: string;
  title: string;
  headline: string;
  body: string;
  image?: string;
  offeredAtTurn: number;
  expiresAtRealtimeMs: number;
  options: EventOption[];
  defaultOptionId: string;
}

interface EventEffect {
  type: string;
  delta: number;
}

interface ResolveResult {
  success: true;
  optionId: string;
  tierLabel: string;
  effects: EventEffect[];
  statAdjustment?: { stat: string; label: string; delta: number };
}

function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "0:00";
  const total = Math.floor(msRemaining / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDelta(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export function PriorityLane({ onResolved }: { onResolved?: () => void }) {
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [resolved, setResolved] = useState<ResolveResult | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch the active event once on mount.
  useEffect(() => {
    let cancelled = false;
    fetchJson<{ event?: ActiveEvent } | null>("/api/events/active", {
      feature: "priority-lane",
    })
      .then((data) => {
        if (cancelled || !data?.event) return;
        setEvent(data.event as ActiveEvent);
      })
      .catch(() => {
        // Non-blocking — the lane simply doesn't render.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cosmetic countdown tick.
  useEffect(() => {
    if (!event) return;
    const update = () => setRemainingMs(event.expiresAtRealtimeMs - Date.now());
    update();
    intervalRef.current = setInterval(update, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [event]);

  const commit = useCallback(async () => {
    if (!event || !pick || committing) return;
    setCommitting(true);
    try {
      const res = await fetch(`/api/events/${event.instanceId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionId: pick }),
      });
      if (res.ok) {
        const result = (await res.json()) as ResolveResult;
        setResolved(result);
        onResolved?.();
      }
    } catch {
      // Leave the card open so the player can retry.
    } finally {
      setCommitting(false);
    }
  }, [event, pick, committing, onResolved]);

  if (!event) return null;

  // ── Resolved state — collapsed one-line confirmation ──────────────────────
  if (resolved) {
    const chosen = event.options.find((o) => o.id === resolved.optionId);
    return (
      <div className="mb-5 flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          ✓
        </span>
        <div className="min-w-0 text-sm">
          <span className="font-medium text-foreground">{chosen?.label ?? "Resolved"}</span>
          <span className="mx-1.5 text-muted opacity-40">·</span>
          <span className="text-muted">Outcome: {resolved.tierLabel}</span>
          {resolved.effects.length > 0 && (
            <span className="ml-1.5 font-mono text-xs text-muted">
              {resolved.effects.map((e) => `${e.type} ${formatDelta(e.delta)}`).join(", ")}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Active card ───────────────────────────────────────────────────────────
  const expired = remainingMs <= 0;
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-primary/40 bg-card shadow-md">
      {/* Accent flair */}
      <div className="h-[3px] bg-gradient-to-r from-primary via-primary/40 to-transparent" />
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        {/* Hero placeholder (events may carry their own image) */}
        <div
          className="hidden h-24 w-40 shrink-0 rounded-lg border border-card-border bg-cover bg-center sm:block"
          style={
            event.image
              ? { backgroundImage: `url(${event.image})` }
              : {
                  backgroundImage:
                    "repeating-linear-gradient(135deg, var(--card-elevated) 0 12px, var(--card) 12px 24px)",
                }
          }
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          {/* Top row */}
          <div className="mb-1.5 flex items-center gap-2">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
              Needs your input
            </span>
            <span className="ml-auto flex items-center gap-1 font-mono text-xs text-primary">
              <span aria-hidden>⏱</span>
              {expired ? "resolving…" : formatCountdown(remainingMs)}
            </span>
          </div>

          <h3 className="text-base font-bold leading-tight text-foreground">{event.title}</h3>
          {event.headline && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted">{event.headline}</p>
          )}

          {/* Options */}
          <div className="mt-3 flex flex-wrap gap-2">
            {event.options.map((opt) => {
              const on = pick === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPick(opt.id)}
                  disabled={committing}
                  className={[
                    "flex flex-col items-start rounded-lg border px-3 py-1.5 text-left text-sm transition-colors motion-reduce:transition-none disabled:opacity-50",
                    on
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-card-border bg-card text-muted hover:border-primary/25 hover:text-foreground",
                  ].join(" ")}
                  title={opt.description}
                >
                  <span className="font-medium">{opt.label}</span>
                  {opt.statAdjustment && opt.statAdjustment.delta !== 0 && (
                    <span className="font-mono text-[10px] text-muted">
                      Roll {formatDelta(opt.statAdjustment.delta)} ({opt.statAdjustment.label})
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Commit / footer */}
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void commit()}
              disabled={!pick || committing || expired}
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
            >
              {committing ? "Committing…" : "Commit"}
            </button>
            {!pick && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <span aria-hidden className="text-primary">
                  ⏱
                </span>
                If you do nothing, the default response is applied at turn end.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
