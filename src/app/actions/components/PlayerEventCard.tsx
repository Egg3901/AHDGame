"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { EventEffect } from "@/lib/db/types/events";
import { fetchJson } from "@/lib/observability/fetchJson";

interface StatAdjustment {
  stat: string;
  label: string;
  delta: number;
}

interface ActiveEventOption {
  id: string;
  label: string;
  description: string;
  isDefault: boolean;
  statAdjustment?: StatAdjustment;
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
  options: ActiveEventOption[];
  defaultOptionId: string;
}

interface ResolveResult {
  tierLabel: string;
  effects: EventEffect[];
  optionId: string;
  statAdjustment?: StatAdjustment | null;
}

interface ResolvedEvent {
  instanceId: string;
  kind: string;
  title: string;
  optionLabel: string;
  tierLabel: string;
  effects: EventEffect[];
  resolvedAt: string;
  reason: "player" | "timeout";
}

function formatTimeAgo(iso: string, nowMs: number): string {
  const elapsed = nowMs - new Date(iso).getTime();
  if (elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "expired";
  const totalMinutes = Math.floor(msLeft / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

function describeEffect(effect: EventEffect): string | null {
  const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US")}`;
  switch (effect.type) {
    case "favorability":
      return `${signed(effect.delta)} favorability`;
    case "infamy":
      return `${signed(effect.delta)} infamy`;
    case "politicalInfluence":
      return `${signed(effect.delta)} political influence`;
    case "personalWealth":
      return `${signed(effect.deltaAnchor)} personal wealth`;
    case "campaignFunds":
      return `${signed(effect.deltaLocal)} campaign funds`;
    case "campaignSupport":
      return `${signed(effect.delta)} campaign support`;
    case "corpSentiment":
      return `${signed(effect.delta)} corporate sentiment`;
    default:
      return null;
  }
}

/**
 * Random-event card on the Actions page. Renders nothing unless the player
 * has a pending event instance; deep-linked from notifications via
 * /actions#event-card.
 */
export default function PlayerEventCard() {
  const [event, setEvent] = useState<ActiveEvent | null>(null);
  const [lastResolved, setLastResolved] = useState<ResolvedEvent | null>(null);
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOptionId, setExpandedOptionId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{
      event?: ActiveEvent;
      lastResolved?: ResolvedEvent;
    } | null>("/api/events/active", { feature: "player-event-active" })
      .then((data) => {
        if (cancelled || !data) return;
        if (data.event) setEvent(data.event);
        else if (data.lastResolved) setLastResolved(data.lastResolved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the countdown fresh without a per-second re-render.
  useEffect(() => {
    if (!event || result) return;
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, [event, result]);

  // Notification deep-link: the card mounts after fetch, so the browser's
  // native anchor jump misses it — scroll manually once it exists.
  useEffect(() => {
    if (event && typeof window !== "undefined" && window.location.hash === "#event-card") {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [event]);

  const resolve = useCallback(
    async (optionId: string) => {
      if (!event || resolving || result) return;
      setResolving(true);
      setError(null);
      try {
        const res = await fetch(`/api/events/${event.instanceId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ optionId }),
        });
        const data = await res.json();
        if (res.ok) {
          setResult({
            tierLabel: data.tierLabel,
            effects: data.effects ?? [],
            optionId,
            statAdjustment: data.statAdjustment ?? null,
          });
        } else {
          setError(data.error ?? "Failed to resolve the event.");
        }
      } catch {
        setError("Network error.");
      } finally {
        setResolving(false);
      }
    },
    [event, resolving, result]
  );

  // No pending event — surface the latest outcome ("done already") instead of
  // disappearing entirely, so the system stays visible on the actions page.
  if (!event) {
    if (!lastResolved) return null;
    const resolvedEffects = lastResolved.effects
      .map(describeEffect)
      .filter((s): s is string => s !== null);
    return (
      <div
        id="event-card"
        ref={cardRef}
        className="relative overflow-hidden rounded-xl border border-card-border bg-card"
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">
                Latest event — {lastResolved.tierLabel}
              </div>
              <p className="text-sm font-semibold text-foreground">{lastResolved.title}</p>
              <p className="mt-0.5 text-xs text-muted">
                {lastResolved.reason === "timeout"
                  ? `Time ran out — "${lastResolved.optionLabel}" was applied automatically.`
                  : `You chose "${lastResolved.optionLabel}".`}
                {resolvedEffects.length > 0 && <> {resolvedEffects.join(" · ")}</>}
              </p>
            </div>
          </div>
          <span className="text-[11px] text-muted">
            {formatTimeAgo(lastResolved.resolvedAt, now)}
          </span>
        </div>
      </div>
    );
  }

  const msLeft = event.expiresAtRealtimeMs - now;
  // Expired and unresolved → the sweep owns it now; don't show dead buttons.
  if (msLeft <= 0 && !result) return null;

  const effectSummary = result
    ? result.effects.map(describeEffect).filter((s): s is string => s !== null)
    : [];

  return (
    <div
      id="event-card"
      ref={cardRef}
      className="relative overflow-hidden rounded-xl border-2 border-amber-500/40 bg-card shadow-lg"
    >
      {event.image && (
        <div className="relative h-40 w-full bg-card sm:h-48">
          <Image src={event.image} alt={event.title} fill className="object-cover" unoptimized />
        </div>
      )}
      <div className="border-b border-card-border bg-gradient-to-r from-amber-500/10 to-transparent px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-600">
                Event
              </div>
              <h2 className="text-base font-bold text-foreground">{event.title}</h2>
            </div>
          </div>
          {!result && (
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-600">
              Respond within {formatCountdown(msLeft)}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        <div>
          <p className="text-sm font-semibold text-foreground">{event.headline}</p>
          <p className="mt-1 text-sm text-muted">{event.body}</p>
        </div>

        {result ? (
          <div className="rounded-lg border border-card-border bg-background/40 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-600">
              Outcome — {result.tierLabel}
            </div>
            <p className="mt-1 text-sm text-foreground">
              You chose &ldquo;
              {event.options.find((o) => o.id === result.optionId)?.label ?? result.optionId}
              &rdquo;.
            </p>
            {effectSummary.length > 0 && (
              <p className="mt-1 text-xs text-muted">{effectSummary.join(" · ")}</p>
            )}
            {result.statAdjustment && result.statAdjustment.delta !== 0 && (
              <p
                className={[
                  "mt-1.5 text-xs font-medium",
                  result.statAdjustment.delta > 0 ? "text-emerald-600" : "text-rose-500",
                ].join(" ")}
              >
                {"Your "}
                {result.statAdjustment.label}
                {result.statAdjustment.delta > 0 ? " boosted" : " hurt"}
                {" the roll ("}
                {result.statAdjustment.delta > 0 ? "+" : "−"}
                {Math.abs(result.statAdjustment.delta)}
                {")"}
              </p>
            )}
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs font-semibold text-amber-600">
              Clicking an option confirms that decision immediately — it&apos;s applied and
              can&apos;t be undone. Use the arrow (▾) to preview an option before committing.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {event.options.map((option) => {
                const expanded = expandedOptionId === option.id;
                const adj = option.statAdjustment;
                return (
                  <div
                    key={option.id}
                    className="rounded-lg border border-card-border bg-background/40"
                  >
                    <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <button
                          onClick={() => resolve(option.id)}
                          disabled={resolving}
                          title="Click to confirm this choice"
                          className="w-full text-left text-sm font-semibold text-foreground transition-colors hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {option.label}
                          {option.isDefault && (
                            <span className="ml-2 rounded-full bg-muted/15 px-2 py-0.5 text-[10px] font-medium text-muted">
                              Default
                            </span>
                          )}
                        </button>
                        {adj && adj.delta !== 0 && (
                          <span
                            className={[
                              "mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium",
                              adj.delta > 0 ? "text-emerald-600" : "text-rose-500",
                            ].join(" ")}
                          >
                            Roll {adj.delta > 0 ? "+" : "−"}
                            {Math.abs(adj.delta)} ({adj.label})
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setExpandedOptionId(expanded ? null : option.id)}
                        className="shrink-0 text-muted transition-colors hover:text-foreground"
                        aria-label={expanded ? "Hide details" : "Show details"}
                      >
                        <svg
                          className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </button>
                    </div>
                    {expanded && (
                      <p className="border-t border-card-border px-3 py-2 text-xs text-muted">
                        {option.description}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {error && <p className="text-sm font-medium text-error">{error}</p>}
        {!result && (
          <p className="text-[11px] text-muted">
            No action points required. If you don&apos;t respond in time, &ldquo;
            {event.options.find((o) => o.id === event.defaultOptionId)?.label ?? "the default"}
            &rdquo; is applied automatically.
          </p>
        )}
      </div>
    </div>
  );
}
